import type { INestApplication } from '@nestjs/common';
import { api, createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

describe('organisations (FR-01)', () => {
  let ctx: TestCtx;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });
  afterAll(async () => {
    await app?.close();
  });

  // A user with a login but no membership anywhere.
  const newUser = async () => {
    const { orgId } = await makeOrg(ctx.prisma);
    const m = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', name: 'Nora Newcomer' });
    await ctx.prisma.membership.delete({ where: { id: m.membershipId } });
    return m;
  };

  it('creates the org and an ACTIVE ADMIN membership for the caller', async () => {
    const u = await newUser();
    const res = await api(app, u.cookie).post('/api/v1/orgs').send({ name: '  Cafe Nord  ' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      name: 'Cafe Nord',
      timezone: 'Europe/Berlin',
      defaultWeeklyLimitMin: 2400,
      minRestMin: 660,
      maxDailyMin: 600,
      offerLeadTimeMin: 120,
    });

    const me = await api(app, u.cookie).get('/api/v1/me');
    expect(me.body.memberships).toEqual([
      expect.objectContaining({
        organizationId: res.body.id,
        organizationName: 'Cafe Nord',
        accessLevel: 'ADMIN',
      }),
    ]);
    const m = await ctx.prisma.membership.findFirstOrThrow({
      where: { organizationId: res.body.id },
    });
    expect(m).toMatchObject({
      userId: u.userId,
      displayName: 'Nora Newcomer',
      status: 'ACTIVE',
      accessLevel: 'ADMIN',
    });
    expect(m.email).toMatch(/@shiftswap\.test$/);

    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { organizationId: res.body.id, action: 'org.created' },
    });
    expect(audit.actorMembershipId).toBe(m.id);
    expect(audit.metadata).toEqual({ name: 'Cafe Nord', timezone: 'Europe/Berlin' });
  });

  it('canonicalises the time zone before storing it', async () => {
    const u = await newUser();
    const res = await api(app, u.cookie)
      .post('/api/v1/orgs')
      .send({ name: 'Bar', timezone: 'europe/london' });
    expect(res.status).toBe(201);
    expect(res.body.timezone).toBe('Europe/London');
  });

  it('400 for an invalid time zone', async () => {
    const u = await newUser();
    const res = await api(app, u.cookie)
      .post('/api/v1/orgs')
      .send({ name: 'Bar', timezone: 'Mars/Olympus' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('400 for an offset-style time zone', async () => {
    const u = await newUser();
    const res = await api(app, u.cookie)
      .post('/api/v1/orgs')
      .send({ name: 'Bar', timezone: '+01:00' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.message).toBe('Choose a time zone like Europe/Berlin');
  });

  it('400 for a blank name', async () => {
    const u = await newUser();
    const res = await api(app, u.cookie).post('/api/v1/orgs').send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  it('401 without a session', async () => {
    const res = await api(app).post('/api/v1/orgs').send({ name: 'Bar' });
    expect(res.status).toBe(401);
  });

  it('GET returns the org for a member; 404 for another org', async () => {
    const u = await newUser();
    const created = await api(app, u.cookie).post('/api/v1/orgs').send({ name: 'Mine' });
    const ok = await api(app, u.cookie).get(`/api/v1/orgs/${created.body.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual(created.body);

    const other = await makeOrg(ctx.prisma);
    const res = await api(app, u.cookie).get(`/api/v1/orgs/${other.orgId}`);
    expect(res.status).toBe(404);
    expect((await api(app).get(`/api/v1/orgs/${created.body.id}`)).status).toBe(401);
  });
});
