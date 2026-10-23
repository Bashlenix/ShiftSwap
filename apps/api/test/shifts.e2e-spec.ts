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

  it('PATCH/DELETE of a real shift in another org -> 404', async () => {
    const foreign = await ctx.prisma.shift.create({
      data: {
        organizationId: otherOrgId,
        startAt: new Date('2027-03-12T08:00:00Z'),
        endAt: new Date('2027-03-12T12:00:00Z'),
      },
    });
    const p = await api(app, manager.cookie)
      .patch(url(`/${foreign.id}`))
      .send({ version: 1, notes: 'x' });
    expect(p.status).toBe(404);
    expect(p.body.error.code).toBe('NOT_FOUND');
    const d = await api(app, manager.cookie).delete(url(`/${foreign.id}?version=1`));
    expect(d.status).toBe(404);
    expect(d.body.error.code).toBe('NOT_FOUND');
    const still = await ctx.prisma.shift.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(still.version).toBe(1);
    expect(still.deletedAt).toBeNull();
  });

  it('PATCH requiredSkillIds replaces the set; stale PATCH leaves skills alone', async () => {
    const other = await ctx.prisma.skill.create({
      data: { organizationId: orgId, name: 'Kitchen' },
    });
    const c = await create({
      startAt: iso('2027-03-13T08:00:00Z'),
      endAt: iso('2027-03-13T12:00:00Z'),
      requiredSkillIds: [barSkillId],
    });
    const id = c.body.shift.id;
    const ok = await api(app, manager.cookie)
      .patch(url(`/${id}`))
      .send({ version: 1, requiredSkillIds: [other.id] });
    expect(ok.status).toBe(200);
    const get = await api(app, manager.cookie).get(
      url(`?from=${iso('2027-03-13T00:00:00Z')}&to=${iso('2027-03-14T00:00:00Z')}`),
    );
    expect(get.body[0].requiredSkillIds).toEqual([other.id]);
    const stale = await api(app, manager.cookie)
      .patch(url(`/${id}`))
      .send({ version: 1, requiredSkillIds: [barSkillId] });
    expect(stale.status).toBe(409);
    const rows = await ctx.prisma.shiftSkill.findMany({ where: { shiftId: id } });
    expect(rows.map((r) => r.skillId)).toEqual([other.id]);
  });

  it('PATCH with a foreign-org skill -> 404 and nothing changes', async () => {
    const c = await create({
      startAt: iso('2027-03-14T08:00:00Z'),
      endAt: iso('2027-03-14T12:00:00Z'),
    });
    const id = c.body.shift.id;
    const res = await api(app, manager.cookie)
      .patch(url(`/${id}`))
      .send({ version: 1, requiredSkillIds: [foreignSkillId] });
    expect(res.status).toBe(404);
    const row = await ctx.prisma.shift.findUniqueOrThrow({ where: { id } });
    expect(row.version).toBe(1);
  });

  it('PATCH assigning an unqualified member -> MISSING_SKILL warning', async () => {
    const c = await create({
      startAt: iso('2027-03-15T08:00:00Z'),
      endAt: iso('2027-03-15T12:00:00Z'),
      requiredSkillIds: [barSkillId],
    });
    const res = await api(app, manager.cookie)
      .patch(url(`/${c.body.shift.id}`))
      .send({ version: 1, assignedMembershipId: ben.membershipId });
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual(['MISSING_SKILL']);
  });

  it('employee PATCH/DELETE -> 403', async () => {
    const c = await create({
      startAt: iso('2027-03-16T08:00:00Z'),
      endAt: iso('2027-03-16T12:00:00Z'),
    });
    const id = c.body.shift.id;
    await api(app, anna.cookie)
      .patch(url(`/${id}`))
      .send({ version: 1, notes: 'x' })
      .expect(403);
    await api(app, anna.cookie)
      .delete(url(`/${id}?version=1`))
      .expect(403);
  });

  it('list returns a shift that starts before from and ends inside the window', async () => {
    await create({ startAt: iso('2027-03-17T20:00:00Z'), endAt: iso('2027-03-18T04:00:00Z') });
    const res = await api(app, manager.cookie).get(
      url(`?from=${iso('2027-03-18T00:00:00Z')}&to=${iso('2027-03-19T00:00:00Z')}`),
    );
    expect(res.body.length).toBe(1);
    expect(res.body[0].startAt).toBe(iso('2027-03-17T20:00:00Z'));
  });

  it('soft-deleted neighbour does not cause an OVERLAP warning', async () => {
    const first = await create({
      startAt: iso('2027-03-20T08:00:00Z'),
      endAt: iso('2027-03-20T12:00:00Z'),
      assignedMembershipId: anna.membershipId,
    });
    await api(app, manager.cookie)
      .delete(url(`/${first.body.shift.id}?version=1`))
      .expect(204);
    const second = await create({
      startAt: iso('2027-03-20T09:00:00Z'),
      endAt: iso('2027-03-20T11:00:00Z'),
      assignedMembershipId: anna.membershipId,
    });
    expect(second.body.warnings).toEqual([]);
    const third = await create({
      startAt: iso('2027-03-20T10:00:00Z'),
      endAt: iso('2027-03-20T11:30:00Z'),
      assignedMembershipId: anna.membershipId,
    });
    expect(third.body.warnings).toEqual(['OVERLAP']);
  });

  it('free-text date range is 400', async () => {
    const res = await api(app, manager.cookie).get(url(`?from=March 1&to=${base}`));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('writes one audit row per write, scheduling fields only', async () => {
    const rows = await ctx.prisma.auditLog.findMany({
      where: { organizationId: orgId, entityType: 'shift' },
    });
    const keys = new Set(rows.map((r) => `${r.entityId}:${r.action}`));
    expect(keys.size).toBe(rows.length);
    const actions = new Set(rows.map((r) => r.action));
    expect(actions).toEqual(new Set(['shift.created', 'shift.updated', 'shift.deleted']));
    const allowed = ['assignedMembershipId', 'endAt', 'requiredSkillIds', 'startAt'];
    for (const r of rows) {
      for (const snap of [r.before, r.after]) {
        if (snap !== null) expect(Object.keys(snap as object).sort()).toEqual(allowed);
      }
      expect(r.metadata).toBeNull();
    }
    const nulls = await ctx.prisma.$queryRaw<{ action: string; b: boolean; a: boolean }[]>`
      SELECT action, before IS NULL AS b, after IS NULL AS a
      FROM audit_logs WHERE organization_id = ${orgId}`;
    for (const n of nulls) {
      if (n.action === 'shift.created') expect(n).toMatchObject({ b: true, a: false });
      if (n.action === 'shift.updated') expect(n).toMatchObject({ b: false, a: false });
      if (n.action === 'shift.deleted') expect(n).toMatchObject({ b: false, a: true });
    }
    expect(JSON.stringify(rows.map((r) => [r.before, r.after]))).not.toMatch(/@shiftswap\.test/);
  });
});
