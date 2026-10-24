import type { INestApplication } from '@nestjs/common';
import { api, createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

describe('preferences API', () => {
  let ctx: TestCtx;
  let app: INestApplication;
  let orgId: string;
  let anna: { membershipId: string; cookie?: string };
  let ben: { membershipId: string; cookie?: string };

  const url = (org = orgId) => `/api/v1/orgs/${org}/me/preferences`;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    orgId = (await makeOrg(ctx.prisma)).orgId;
    anna = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
    ben = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('a new member gets an empty grid', async () => {
    const res = await api(app, ben.cookie).get(url());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ entries: [] });
  });

  it('PUT stores entries; GET returns them sorted by weekday then slot', async () => {
    const entries = [
      { weekday: 4, slot: 'EVENING', value: 'AVOID' },
      { weekday: 0, slot: 'AFTERNOON', value: 'PREFERRED' },
      { weekday: 0, slot: 'MORNING', value: 'AVOID' },
    ];
    const put = await api(app, anna.cookie).put(url()).send({ entries });
    expect(put.status).toBe(200);
    const sorted = [
      { weekday: 0, slot: 'MORNING', value: 'AVOID' },
      { weekday: 0, slot: 'AFTERNOON', value: 'PREFERRED' },
      { weekday: 4, slot: 'EVENING', value: 'AVOID' },
    ];
    expect(put.body).toEqual({ entries: sorted });
    const get = await api(app, anna.cookie).get(url());
    expect(get.body).toEqual({ entries: sorted });
  });

  it("a second PUT replaces all earlier entries; other members' grids are untouched", async () => {
    const res = await api(app, anna.cookie)
      .put(url())
      .send({ entries: [{ weekday: 6, slot: 'MORNING', value: 'PREFERRED' }] });
    expect(res.status).toBe(200);
    const get = await api(app, anna.cookie).get(url());
    expect(get.body).toEqual({
      entries: [{ weekday: 6, slot: 'MORNING', value: 'PREFERRED' }],
    });
  });

  it("member A's grid is not visible to member B", async () => {
    const res = await api(app, ben.cookie).get(url());
    expect(res.body).toEqual({ entries: [] });
  });

  it('invalid body -> 400 VALIDATION_FAILED', async () => {
    const res = await api(app, anna.cookie)
      .put(url())
      .send({ entries: [{ weekday: 9, slot: 'MORNING', value: 'AVOID' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('writes one audit row per PUT with before/after entries', async () => {
    const m = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
    const entries = [{ weekday: 2, slot: 'EVENING', value: 'AVOID' }];
    await api(app, m.cookie).put(url()).send({ entries });
    const logs = await ctx.prisma.auditLog.findMany({
      where: { entityType: 'membership', entityId: m.membershipId, action: 'preferences.updated' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].actorMembershipId).toBe(m.membershipId);
    expect(logs[0].before).toEqual({ entries: [] });
    expect(logs[0].after).toEqual({ entries });
  });
});
