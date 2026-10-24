import type { INestApplication } from '@nestjs/common';
import { api, createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

describe('invites API (FR-02)', () => {
  let ctx: TestCtx;
  let app: INestApplication;
  let orgId: string;
  let manager: { membershipId: string; cookie?: string };
  let n = 0;
  const email = () => `Invitee-${Date.now()}-${n++}@Shiftswap.test`;
  const tokenOf = (link: string) => /\/invites\/([A-Za-z0-9_-]{43})/.exec(link)![1];
  // A distinct client IP per request keeps the per-IP throttle out of unrelated tests.
  const ip = () => `10.1.${Math.floor(n / 250)}.${n++ % 250}`;
  const get = (token: string, xff = ip()) =>
    api(app).get(`/api/v1/invites/${token}`).set('X-Forwarded-For', xff);
  const accept = (token: string, cookie?: string) =>
    api(app, cookie).post(`/api/v1/invites/${token}/accept`).set('X-Forwarded-For', ip());

  /** Manager invites a new placeholder; returns raw token + ids. */
  const invite = async (addr = email()) => {
    const res = await api(app, manager.cookie)
      .post(`/api/v1/orgs/${orgId}/members`)
      .send({ displayName: 'Typed Name', email: addr });
    expect(res.status).toBe(201);
    return { token: tokenOf(res.body.inviteLink), membershipId: res.body.member.id as string, addr };
  };
  /** A signed-in user with an arbitrary email (own org membership not needed). */
  const user = async (addr: string) => {
    const { orgId: other } = await makeOrg(ctx.prisma);
    const m = await makeMember(ctx, other, { accessLevel: 'EMPLOYEE' });
    await ctx.prisma.user.update({ where: { id: m.userId! }, data: { email: addr } });
    // Re-sign-in not needed: session lookup reads the user row.
    return { ...m, otherOrgId: other };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    ({ orgId } = await makeOrg(ctx.prisma, { name: 'Cafe Sued' }));
    manager = await makeMember(ctx, orgId, { accessLevel: 'MANAGER' });
  });
  afterAll(async () => {
    await app?.close();
  });

  describe('preview', () => {
    it('VALID: org name, email, expiry; never echoes the token', async () => {
      const { token, addr } = await invite();
      const res = await get(token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        organizationName: 'Cafe Sued',
        email: addr.toLowerCase(),
        state: 'VALID',
      });
      expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(JSON.stringify(res.body)).not.toContain(token);
    });

    it('unknown token -> 404 NOT_FOUND', async () => {
      const res = await get('A'.repeat(43));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('EXPIRED, USED, REVOKED; REVOKED beats USED beats EXPIRED', async () => {
      const a = await invite();
      await ctx.prisma.invite.updateMany({
        where: { membershipId: a.membershipId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await get(a.token)).body.state).toBe('EXPIRED');

      await ctx.prisma.invite.updateMany({
        where: { membershipId: a.membershipId },
        data: { acceptedAt: new Date() },
      });
      expect((await get(a.token)).body.state).toBe('USED');

      await ctx.prisma.invite.updateMany({
        where: { membershipId: a.membershipId },
        data: { revokedAt: new Date() },
      });
      expect((await get(a.token)).body.state).toBe('REVOKED');
    });

    it('a re-sent invite revokes the old token', async () => {
      const a = await invite();
      const res = await api(app, manager.cookie)
        .post(`/api/v1/orgs/${orgId}/members/${a.membershipId}/invite`)
        .send({});
      expect(res.status).toBe(201);
      expect((await get(a.token)).body.state).toBe('REVOKED');
      expect((await get(tokenOf(res.body.inviteLink))).body.state).toBe('VALID');
    });

    it('is throttled to 20/min per client IP (429 on the 21st), other IPs unaffected', async () => {
      const { token } = await invite();
      const fixed = '203.0.113.77';
      for (let i = 0; i < 20; i++) expect((await get(token, fixed)).status).toBe(200);
      expect((await get(token, fixed)).status).toBe(429);
      expect((await get(token, '203.0.113.78')).status).toBe(200);
    });

    it('does not throttle other routes', async () => {
      const fixed = '203.0.113.99';
      for (let i = 0; i < 25; i++) {
        const res = await api(app, manager.cookie).get('/api/v1/me').set('X-Forwarded-For', fixed);
        expect(res.status).toBe(200);
      }
    });
  });

  describe('accept', () => {
    it('requires a session', async () => {
      const { token } = await invite();
      expect((await accept(token)).status).toBe(401);
    });

    it('happy path binds the user, keeps the typed name, lowercases email, audits; /me lists the org', async () => {
      const { token, membershipId, addr } = await invite();
      const u = await user(addr); // mixed-case invite vs session email handled below
      const res = await accept(token, u.cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ organizationId: orgId });

      const m = await ctx.prisma.membership.findUniqueOrThrow({ where: { id: membershipId } });
      expect(m.userId).toBe(u.userId);
      expect(m.displayName).toBe('Typed Name');
      expect(m.email).toBe(addr.toLowerCase());
      const inv = await ctx.prisma.invite.findFirstOrThrow({ where: { membershipId } });
      expect(inv.acceptedAt).not.toBeNull();
      const audit = await ctx.prisma.auditLog.findFirst({
        where: { organizationId: orgId, action: 'invite.accepted', entityId: inv.id },
      });
      expect(audit?.metadata).toEqual({ membershipId });
      expect(JSON.stringify(audit?.metadata)).not.toContain(token);

      const me = await api(app, u.cookie).get('/api/v1/me');
      expect(me.body.memberships.map((x: { organizationId: string }) => x.organizationId)).toEqual(
        expect.arrayContaining([orgId, u.otherOrgId]),
      );
    });

    it('email compare is case-insensitive in both directions', async () => {
      const { token, addr } = await invite();
      const u = await user(addr.toUpperCase());
      expect((await accept(token, u.cookie)).status).toBe(200);
    });

    it('second accept -> 410 INVITE_INVALID with state USED', async () => {
      const { token, addr } = await invite();
      const u = await user(addr);
      expect((await accept(token, u.cookie)).status).toBe(200);
      const res = await accept(token, u.cookie);
      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe('INVITE_INVALID');
      expect(res.body.error.details).toEqual({ state: 'USED' });
    });

    it('two parallel accepts -> one 200 and one 410', async () => {
      const { token, addr } = await invite();
      const u = await user(addr);
      const res = await Promise.all([accept(token, u.cookie), accept(token, u.cookie)]);
      expect(res.map((r) => r.status).sort()).toEqual([200, 410]);
    });

    it('wrong-email session -> 403 EMAIL_MISMATCH and nothing is bound', async () => {
      const { token, membershipId } = await invite();
      const other = await user(email());
      const res = await accept(token, other.cookie);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('EMAIL_MISMATCH');
      const m = await ctx.prisma.membership.findUniqueOrThrow({ where: { id: membershipId } });
      expect(m.userId).toBeNull();
      const inv = await ctx.prisma.invite.findFirstOrThrow({ where: { membershipId } });
      expect(inv.acceptedAt).toBeNull();
    });

    it('expired -> 410 with state EXPIRED; revoked -> REVOKED; unknown -> 404', async () => {
      const a = await invite();
      const u = await user(a.addr);
      await ctx.prisma.invite.updateMany({
        where: { membershipId: a.membershipId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await accept(a.token, u.cookie);
      expect(res.status).toBe(410);
      expect(res.body.error.details).toEqual({ state: 'EXPIRED' });

      await ctx.prisma.invite.updateMany({
        where: { membershipId: a.membershipId },
        data: { revokedAt: new Date() },
      });
      expect((await accept(a.token, u.cookie)).body.error.details).toEqual({ state: 'REVOKED' });
      expect((await accept('B'.repeat(43), u.cookie)).status).toBe(404);
    });

    it('a deactivated placeholder cannot be claimed (410 REVOKED)', async () => {
      const a = await invite();
      const u = await user(a.addr);
      await ctx.prisma.membership.update({
        where: { id: a.membershipId },
        data: { status: 'DEACTIVATED' },
      });
      const res = await accept(a.token, u.cookie);
      expect(res.status).toBe(410);
      expect(res.body.error.details).toEqual({ state: 'REVOKED' });
    });

    it('user already a member of that org -> 409 ALREADY_MEMBER, invite stays unused', async () => {
      const a = await invite();
      const u = await user(a.addr);
      await ctx.prisma.membership.create({
        data: { organizationId: orgId, userId: u.userId, displayName: 'Existing', accessLevel: 'EMPLOYEE' },
      });
      const res = await accept(a.token, u.cookie);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ALREADY_MEMBER');
      const inv = await ctx.prisma.invite.findFirstOrThrow({ where: { membershipId: a.membershipId } });
      expect(inv.acceptedAt).toBeNull();
    });

    it('existing user of another org gets a second membership, no duplicate user', async () => {
      const a = await invite();
      const u = await user(a.addr);
      const usersBefore = await ctx.prisma.user.count();
      expect((await accept(a.token, u.cookie)).status).toBe(200);
      expect(await ctx.prisma.user.count()).toBe(usersBefore);
      expect(await ctx.prisma.membership.count({ where: { userId: u.userId } })).toBe(2);
    });
  });
});
