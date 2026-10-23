import type { INestApplication } from '@nestjs/common';
import { api, createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

const iso = (d: string) => new Date(d).toISOString();

describe('shifts API', () => {
  let ctx: TestCtx;
  let app: INestApplication;
  let orgId: string;
  let otherOrgId: string;
  let manager: { membershipId: string; cookie?: string };
  let anna: { membershipId: string; cookie?: string };
  let ben: { membershipId: string; cookie?: string };
  let barSkillId: string;
  let foreignSkillId: string;
  let base: string;

  const url = (p = '') => `/api/v1/orgs/${orgId}/shifts${p}`;
  const body = (over: Record<string, unknown> = {}) => ({
    startAt: iso('2027-03-01T08:00:00Z'),
    endAt: iso('2027-03-01T16:00:00Z'),
    requiredSkillIds: [],
    assignedMembershipId: null,
    ...over,
  });
  const auditCount = (action: string) =>
    ctx.prisma.auditLog.count({ where: { organizationId: orgId, action } });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    orgId = (await makeOrg(ctx.prisma)).orgId;
    otherOrgId = (await makeOrg(ctx.prisma)).orgId;
    manager = await makeMember(ctx, orgId, { accessLevel: 'MANAGER' });
    anna = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', skillNames: ['Bar'] });
    ben = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
    barSkillId = (
      await ctx.prisma.skill.findFirstOrThrow({ where: { organizationId: orgId, name: 'Bar' } })
    ).id;
    foreignSkillId = (
      await ctx.prisma.skill.create({ data: { organizationId: otherOrgId, name: 'X' } })
    ).id;
    base = iso('2027-03-01T00:00:00Z');
  });
  afterAll(async () => {
    await app?.close();
  });

  const create = async (over: Record<string, unknown> = {}) =>
    api(app, manager.cookie).post(url()).send(body(over));

  it('creates an overnight shift -> 201', async () => {
    const res = await create({
      startAt: iso('2027-03-10T22:00:00Z'),
      endAt: iso('2027-03-11T06:00:00Z'),
    });
    expect(res.status).toBe(201);
    expect(res.body.shift.version).toBe(1);
    expect(res.body.shift.openOfferId).toBeNull();
    expect(res.body.warnings).toEqual([]);
  });

  it('employee create -> 403', async () => {
    const res = await api(app, anna.cookie).post(url()).send(body());
    expect(res.status).toBe(403);
  });

  it('employee list without mine -> 403', async () => {
    const res = await api(app, anna.cookie).get(
      url(`?from=${base}&to=${iso('2027-03-08T00:00:00Z')}`),
    );
    expect(res.status).toBe(403);
  });

  it('mine=true returns only own shifts', async () => {
    await create({
      startAt: iso('2027-03-02T08:00:00Z'),
      endAt: iso('2027-03-02T12:00:00Z'),
      assignedMembershipId: anna.membershipId,
    });
    await create({
      startAt: iso('2027-03-02T13:00:00Z'),
      endAt: iso('2027-03-02T14:00:00Z'),
      assignedMembershipId: ben.membershipId,
    });
    const res = await api(app, anna.cookie).get(
      url(`?from=${base}&to=${iso('2027-03-08T00:00:00Z')}&mine=true`),
    );
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].assignedMembershipId).toBe(anna.membershipId);
  });

  it('manager list is sorted by startAt', async () => {
    const res = await api(app, manager.cookie).get(
      url(`?from=${base}&to=${iso('2027-03-08T00:00:00Z')}`),
    );
    expect(res.status).toBe(200);
    const starts = res.body.map((s: { startAt: string }) => s.startAt);
    expect(starts).toEqual([...starts].sort());
    expect(starts.length).toBeGreaterThanOrEqual(2);
  });

  it('36-day range -> 400; missing from -> 400', async () => {
    const r1 = await api(app, manager.cookie).get(
      url(`?from=${base}&to=${iso('2027-04-06T00:00:00Z')}`),
    );
    expect(r1.status).toBe(400);
    expect(r1.body.error.code).toBe('VALIDATION_FAILED');
    const r2 = await api(app, manager.cookie).get(url(`?to=${base}`));
    expect(r2.status).toBe(400);
  });

  it('assignee lacking skill -> 201 with MISSING_SKILL warning', async () => {
    const res = await create({
      startAt: iso('2027-03-03T08:00:00Z'),
      endAt: iso('2027-03-03T12:00:00Z'),
      requiredSkillIds: [barSkillId],
      assignedMembershipId: ben.membershipId,
    });
    expect(res.status).toBe(201);
    expect(res.body.warnings).toEqual(['MISSING_SKILL']);
  });

  it('skill or assignee from another org -> 404', async () => {
    const r1 = await create({ requiredSkillIds: [foreignSkillId] });
    expect(r1.status).toBe(404);
    const foreign = await makeMember(ctx, otherOrgId, { accessLevel: 'EMPLOYEE' });
    const r2 = await create({ assignedMembershipId: foreign.membershipId });
    expect(r2.status).toBe(404);
  });

  it('PATCH increments version; stale version -> 409; null clears location', async () => {
    const c = await create({
      location: 'Bar',
      startAt: iso('2027-03-04T08:00:00Z'),
      endAt: iso('2027-03-04T12:00:00Z'),
    });
    const id = c.body.shift.id;
    const ok = await api(app, manager.cookie)
      .patch(url(`/${id}`))
      .send({ version: 1, location: null, notes: 'n' });
    expect(ok.status).toBe(200);
    expect(ok.body.shift.version).toBe(2);
    expect(ok.body.shift.location).toBeNull();
    expect(ok.body.shift.notes).toBe('n');
    const stale = await api(app, manager.cookie)
      .patch(url(`/${id}`))
      .send({ version: 1, notes: 'x' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('PATCH re-validates merged times -> 400', async () => {
    const c = await create({
      startAt: iso('2027-03-05T08:00:00Z'),
      endAt: iso('2027-03-05T12:00:00Z'),
    });
    const id = c.body.shift.id;
    const r1 = await api(app, manager.cookie)
      .patch(url(`/${id}`))
      .send({ version: 1, endAt: iso('2027-03-05T07:00:00Z') });
    expect(r1.status).toBe(400);
    expect(r1.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(r1.body.error.details)).toContain('End must be after start');
    const r2 = await api(app, manager.cookie)
      .patch(url(`/${id}`))
      .send({ version: 1, endAt: iso('2027-03-06T01:00:00Z') });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(r2.body.error.details)).toContain('A shift can be at most 16 hours');
  });

  it('PATCH of unknown / other-org shift -> 404', async () => {
    const res = await api(app, manager.cookie)
      .patch(url('/00000000-0000-4000-8000-000000000000'))
      .send({ version: 1, notes: 'x' });
    expect(res.status).toBe(404);
  });

  it('two parallel PATCH with same version: one 200, one 409', async () => {
    const c = await create({
      startAt: iso('2027-03-06T08:00:00Z'),
      endAt: iso('2027-03-06T12:00:00Z'),
    });
    const id = c.body.shift.id;
    const [a, b] = await Promise.all([
      api(app, manager.cookie)
        .patch(url(`/${id}`))
        .send({ version: 1, notes: 'a' }),
      api(app, manager.cookie)
        .patch(url(`/${id}`))
        .send({ version: 1, notes: 'b' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('DELETE soft-deletes; list excludes; stale version -> 409; second delete -> 404', async () => {
    const c = await create({
      startAt: iso('2027-03-07T08:00:00Z'),
      endAt: iso('2027-03-07T09:00:00Z'),
    });
    const id = c.body.shift.id;
    const stale = await api(app, manager.cookie).delete(url(`/${id}?version=9`));
    expect(stale.status).toBe(409);
    await api(app, manager.cookie)
      .delete(url(`/${id}?version=1`))
      .expect(204);
    const list = await api(app, manager.cookie).get(
      url(`?from=${base}&to=${iso('2027-03-08T00:00:00Z')}`),
    );
    expect(list.body.map((s: { id: string }) => s.id)).not.toContain(id);
    await api(app, manager.cookie)
      .delete(url(`/${id}?version=2`))
      .expect(404);
  });

  it('openOfferId reflects the open offer', async () => {
    const c = await create({
      startAt: iso('2027-03-09T08:00:00Z'),
      endAt: iso('2027-03-09T12:00:00Z'),
      assignedMembershipId: anna.membershipId,
    });
    const offer = await ctx.prisma.offer.create({
      data: {
        organizationId: orgId,
        shiftId: c.body.shift.id,
        kind: 'GIVE_AWAY',
        originalOwnerMembershipId: anna.membershipId,
        createdByMembershipId: anna.membershipId,
        expiresAt: new Date('2027-03-09T00:00:00Z'),
      },
    });
    const res = await api(app, manager.cookie).get(
      url(`?from=${iso('2027-03-09T00:00:00Z')}&to=${iso('2027-03-10T00:00:00Z')}`),
    );
    expect(res.body[0].openOfferId).toBe(offer.id);
  });

  it('other org member gets 404', async () => {
    const res = await api(app, manager.cookie).get(
      `/api/v1/orgs/${otherOrgId}/shifts?from=${base}&to=${iso('2027-03-08T00:00:00Z')}`,
    );
    expect(res.status).toBe(404);
  });

  it('writes audit rows with scheduling fields only', async () => {
    const created = await auditCount('shift.created');
    const updated = await auditCount('shift.updated');
    const deleted = await auditCount('shift.deleted');
    expect(created).toBeGreaterThanOrEqual(8);
    expect(updated).toBeGreaterThanOrEqual(2);
    expect(deleted).toBe(1);
    const row = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { organizationId: orgId, action: 'shift.updated' },
    });
    expect(Object.keys(row.before as object).sort()).toEqual(
      expect.arrayContaining(['assignedMembershipId', 'endAt', 'requiredSkillIds', 'startAt']),
    );
    expect(JSON.stringify({ b: row.before, a: row.after, m: row.metadata })).not.toMatch(
      /@shiftswap\.test/,
    );
  });
});
