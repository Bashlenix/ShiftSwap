import type { INestApplication } from '@nestjs/common';
import { api, createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

const DAY = 24 * 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

describe('unavailability API', () => {
  let ctx: TestCtx;
  let app: INestApplication;
  let orgId: string;
  let otherOrgId: string;
  let anna: { membershipId: string; cookie?: string };
  let ben: { membershipId: string; cookie?: string };
  let manager: { membershipId: string; cookie?: string };
  let outsider: { membershipId: string; cookie?: string };

  const url = (p = '', org = orgId) => `/api/v1/orgs/${org}/me/unavailability${p}`;
  const body = (over: Record<string, unknown> = {}) => ({
    startAt: at(2 * DAY),
    endAt: at(3 * DAY),
    ...over,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    orgId = (await makeOrg(ctx.prisma)).orgId;
    otherOrgId = (await makeOrg(ctx.prisma)).orgId;
    anna = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
    ben = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
    manager = await makeMember(ctx, orgId, { accessLevel: 'MANAGER' });
    outsider = await makeMember(ctx, otherOrgId, { accessLevel: 'EMPLOYEE' });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('employee creates -> 201, lists, deletes -> 204; audit rows written', async () => {
    const created = await api(app, anna.cookie).post(url()).send(body());
    expect(created.status).toBe(201);
    expect(Object.keys(created.body).sort()).toEqual(['endAt', 'id', 'startAt']);

    const list = await api(app, anna.cookie).get(url());
    expect(list.status).toBe(200);
    expect(list.body.map((u: { id: string }) => u.id)).toContain(created.body.id);

    const del = await api(app, anna.cookie).delete(url(`/${created.body.id}`));
    expect(del.status).toBe(204);
    const after = await api(app, anna.cookie).get(url());
    expect(after.body.map((u: { id: string }) => u.id)).not.toContain(created.body.id);

    const logs = await ctx.prisma.auditLog.findMany({
      where: { entityType: 'unavailability', entityId: created.body.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((l) => l.action)).toEqual(['unavailability.created', 'unavailability.deleted']);
    expect(logs[0].actorMembershipId).toBe(anna.membershipId);
    expect(Object.keys(logs[0].after as object).sort()).toEqual(['endAt', 'startAt']);
    expect(Object.keys(logs[1].before as object).sort()).toEqual(['endAt', 'startAt']);
  });

  it('manager can use the routes too', async () => {
    const created = await api(app, manager.cookie).post(url()).send(body());
    expect(created.status).toBe(201);
    expect((await api(app, manager.cookie).get(url())).status).toBe(200);
    expect((await api(app, manager.cookie).delete(url(`/${created.body.id}`))).status).toBe(204);
  });

  it('list is own only, ending in the future, sorted by startAt', async () => {
    await ctx.prisma.unavailability.create({
      data: {
        organizationId: orgId,
        membershipId: ben.membershipId,
        startAt: new Date(Date.now() - 3 * DAY),
        endAt: new Date(Date.now() - 2 * DAY),
      },
    });
    const late = await api(app, ben.cookie)
      .post(url())
      .send(body({ startAt: at(10 * DAY), endAt: at(11 * DAY) }));
    const early = await api(app, ben.cookie)
      .post(url())
      .send(body({ startAt: at(4 * DAY), endAt: at(5 * DAY) }));
    // currently running entry still listed
    const running = await api(app, ben.cookie)
      .post(url())
      .send(body({ startAt: at(-DAY), endAt: at(DAY) }));
    await api(app, anna.cookie).post(url()).send(body());

    const res = await api(app, ben.cookie).get(url());
    expect(res.status).toBe(200);
    expect(res.body.map((u: { id: string }) => u.id)).toEqual([
      running.body.id,
      early.body.id,
      late.body.id,
    ]);
  });

  it('end before start -> 400', async () => {
    const res = await api(app, anna.cookie)
      .post(url())
      .send(body({ startAt: at(3 * DAY), endAt: at(2 * DAY) }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it("deleting another member's id -> 404 and row survives", async () => {
    const mine = await api(app, ben.cookie).post(url()).send(body());
    const res = await api(app, anna.cookie).delete(url(`/${mine.body.id}`));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(await ctx.prisma.unavailability.count({ where: { id: mine.body.id } })).toBe(1);
  });

  it("deleting another org's id -> 404", async () => {
    const theirs = await api(app, outsider.cookie).post(url('', otherOrgId)).send(body());
    expect(theirs.status).toBe(201);
    const res = await api(app, anna.cookie).delete(url(`/${theirs.body.id}`));
    expect(res.status).toBe(404);
    expect(await ctx.prisma.unavailability.count({ where: { id: theirs.body.id } })).toBe(1);
  });

  it('two parallel deletes of the same id -> [204, 404], one audit row', async () => {
    const mine = await api(app, anna.cookie).post(url()).send(body());
    const results = await Promise.all([
      api(app, anna.cookie).delete(url(`/${mine.body.id}`)),
      api(app, anna.cookie).delete(url(`/${mine.body.id}`)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 404]);
    expect(
      await ctx.prisma.auditLog.count({
        where: {
          entityType: 'unavailability',
          entityId: mine.body.id,
          action: 'unavailability.deleted',
        },
      }),
    ).toBe(1);
  });

  it('malformed or unknown id -> 404', async () => {
    expect((await api(app, anna.cookie).delete(url('/nope'))).status).toBe(404);
    expect(
      (await api(app, anna.cookie).delete(url('/00000000-0000-4000-8000-000000000000'))).status,
    ).toBe(404);
  });

  it('unauthenticated -> 401', async () => {
    expect((await api(app).get(url())).status).toBe(401);
  });
});
