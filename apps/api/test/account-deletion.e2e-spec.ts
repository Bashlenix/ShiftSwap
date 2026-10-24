import type { INestApplication } from '@nestjs/common';
import { api, createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

type Member = { membershipId: string; userId?: string; cookie?: string };

const LEAD_MIN = 120;
const PASSWORD = 'correct-horse-battery';

let dayCounter = 0;
/** A fresh future 4h slot per call, far enough apart that no two collide on the hard rules. */
function nextSlot() {
  const start = new Date(Date.now() + (3 + dayCounter++ * 2) * 24 * 3600_000);
  start.setUTCHours(8, 0, 0, 0);
  return { startAt: start, endAt: new Date(start.getTime() + 4 * 3600_000) };
}

describe('DELETE /api/v1/me (account deletion, FR-23, SDD §27/§35)', () => {
  let ctx: TestCtx;
  let app: INestApplication;

  const deleteMe = (cookie: string | undefined, body: unknown = { confirm: 'DELETE' }) =>
    api(app, cookie)
      .delete('/api/v1/me')
      .send(body as object);

  const makeShift = async (orgId: string, assignee: string | null) =>
    (
      await ctx.prisma.shift.create({
        data: { organizationId: orgId, assignedMembershipId: assignee, ...nextSlot() },
      })
    ).id;

  /** A second login for the member's user in another org (same cookie works in both). */
  const joinOrg = (orgId: string, m: Member, accessLevel: 'EMPLOYEE' | 'ADMIN' = 'EMPLOYEE') =>
    ctx.prisma.membership.create({
      data: {
        organizationId: orgId,
        userId: m.userId!,
        displayName: 'Other Org Name',
        accessLevel,
      },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });
  afterAll(async () => {
    await app?.close();
  });

  it('anonymises the user, deactivates every membership and signs the user out', async () => {
    const { orgId: orgA } = await makeOrg(ctx.prisma, { offerLeadTimeMin: LEAD_MIN });
    const { orgId: orgB } = await makeOrg(ctx.prisma, { offerLeadTimeMin: LEAD_MIN });
    await makeMember(ctx, orgA, { accessLevel: 'ADMIN', name: 'Ada' });
    await makeMember(ctx, orgB, { accessLevel: 'ADMIN', name: 'Bea' });
    const lukas = await makeMember(ctx, orgA, { accessLevel: 'EMPLOYEE', name: 'Lukas' });
    const jonas = await makeMember(ctx, orgA, { accessLevel: 'EMPLOYEE', name: 'Jonas' });
    const lukasB = await joinOrg(orgB, lukas);
    const userId = lukas.userId!;

    // An OPEN give-away with Jonas PENDING, and another future shift.
    const gaShift = await makeShift(orgA, lukas.membershipId);
    const created = await api(app, lukas.cookie)
      .post(`/api/v1/orgs/${orgA}/offers`)
      .send({ shiftId: gaShift, kind: 'GIVE_AWAY' });
    expect(created.status).toBe(201);
    const accepted = await api(app, jonas.cookie).post(
      `/api/v1/orgs/${orgA}/offers/${created.body.id}/acceptances`,
    );
    expect(accepted.status).toBe(201);
    const futureShift = await makeShift(orgA, lukas.membershipId);
    // An open invite on the second membership.
    const invite = await ctx.prisma.invite.create({
      data: {
        organizationId: orgB,
        membershipId: lukasB.id,
        email: `lukas-invite-${Date.now()}@shiftswap.test`,
        tokenHash: `del${Date.now()}`.padEnd(64, '0'),
        expiresAt: new Date(Date.now() + 24 * 3600_000),
        createdByMembershipId: lukasB.id,
      },
    });
    const auditBefore = await ctx.prisma.auditLog.findMany({
      where: { actorMembershipId: lukas.membershipId },
      select: { id: true },
    });
    expect(auditBefore.length).toBeGreaterThan(0);

    const res = await deleteMe(lukas.cookie);
    expect(res.status).toBe(204);

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user).toMatchObject({
      name: 'Deleted user',
      email: `deleted-${userId}@deleted.invalid`,
      emailVerified: false,
      image: null,
    });
    expect(user.deletedAt).toBeInstanceOf(Date);
    expect(await ctx.prisma.session.count({ where: { userId } })).toBe(0);
    expect(await ctx.prisma.account.count({ where: { userId } })).toBe(0);
    expect((await api(app, lukas.cookie).get('/api/v1/me')).status).toBe(401);

    const memberships = await ctx.prisma.membership.findMany({ where: { userId } });
    expect(memberships).toHaveLength(2);
    for (const m of memberships) {
      expect(m).toMatchObject({ status: 'DEACTIVATED', displayName: 'Deleted user', email: null });
    }
    const updatedInvite = await ctx.prisma.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(updatedInvite.email).toBe(`deleted-${userId}@deleted.invalid`);

    const ga = await ctx.prisma.offer.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(ga).toMatchObject({ status: 'CANCELLED', cancelReason: 'OWNER_DEACTIVATED' });
    expect(
      await ctx.prisma.offer.count({
        where: { shiftId: futureShift, kind: 'OPEN_SHIFT', status: 'OPEN' },
      }),
    ).toBe(1);

    const auditAfter = await ctx.prisma.auditLog.count({
      where: { id: { in: auditBefore.map((a) => a.id) } },
    });
    expect(auditAfter).toBe(auditBefore.length);
    const anonymised = await ctx.prisma.auditLog.findMany({
      where: { action: 'member.anonymised', entityId: { in: memberships.map((m) => m.id) } },
    });
    expect(anonymised).toHaveLength(2);
    for (const a of anonymised) {
      expect(a).toMatchObject({ entityType: 'membership', actorMembershipId: a.entityId });
      expect(a.before).toBeNull();
      expect(a.after).toBeNull();
    }
  });

  it('lets the old email sign up again as a new user', async () => {
    const { orgId } = await makeOrg(ctx.prisma);
    await makeMember(ctx, orgId, { accessLevel: 'ADMIN' });
    const m = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
    const { email } = await ctx.prisma.user.findUniqueOrThrow({ where: { id: m.userId! } });

    expect((await deleteMe(m.cookie)).status).toBe(204);

    const again = await ctx.auth.api.signUpEmail({
      body: { name: 'Lukas Again', email, password: PASSWORD },
    });
    expect(again.user.id).not.toBe(m.userId);
    expect(again.user.email).toBe(email);
  });

  it('409 LAST_ADMIN when the user is the last active admin of an org; nothing changes', async () => {
    const { orgId: orgA } = await makeOrg(ctx.prisma);
    const { orgId: orgB } = await makeOrg(ctx.prisma, { offerLeadTimeMin: LEAD_MIN });
    const ada = await makeMember(ctx, orgA, { accessLevel: 'ADMIN', name: 'Ada' });
    await makeMember(ctx, orgB, { accessLevel: 'ADMIN', name: 'Bea' });
    const adaB = await joinOrg(orgB, ada);
    const userId = ada.userId!;
    const shiftB = await makeShift(orgB, adaB.id);
    const offer = await api(app, ada.cookie)
      .post(`/api/v1/orgs/${orgB}/offers`)
      .send({ shiftId: shiftB, kind: 'GIVE_AWAY' });
    expect(offer.status).toBe(201);
    const userBefore = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const sessionsBefore = await ctx.prisma.session.count({ where: { userId } });

    const res = await deleteMe(ada.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_ADMIN');
    expect(res.body.error.details).toEqual({ organizationIds: [orgA] });

    const memberships = await ctx.prisma.membership.findMany({ where: { userId } });
    expect(memberships.map((m) => m.status)).toEqual(['ACTIVE', 'ACTIVE']);
    expect(await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } })).toEqual(userBefore);
    expect(await ctx.prisma.session.count({ where: { userId } })).toBe(sessionsBefore);
    expect(sessionsBefore).toBeGreaterThan(0);
    expect(await ctx.prisma.shift.findUniqueOrThrow({ where: { id: shiftB } })).toMatchObject({
      assignedMembershipId: adaB.id,
    });
    expect(
      await ctx.prisma.offer.findUniqueOrThrow({ where: { id: offer.body.id } }),
    ).toMatchObject({ status: 'OPEN' });
    expect((await api(app, ada.cookie).get('/api/v1/me')).status).toBe(200);
  });

  it('204 for an admin when the org has another active admin', async () => {
    const { orgId } = await makeOrg(ctx.prisma);
    await makeMember(ctx, orgId, { accessLevel: 'ADMIN' });
    const admin = await makeMember(ctx, orgId, { accessLevel: 'ADMIN' });

    expect((await deleteMe(admin.cookie)).status).toBe(204);
    const m = await ctx.prisma.membership.findUniqueOrThrow({
      where: { id: admin.membershipId },
    });
    expect(m).toMatchObject({ status: 'DEACTIVATED', displayName: 'Deleted user', email: null });
  });

  it('completes when repeated after a partial failure (already deactivated memberships skipped)', async () => {
    const { orgId: orgA } = await makeOrg(ctx.prisma);
    const { orgId: orgB } = await makeOrg(ctx.prisma);
    await makeMember(ctx, orgA, { accessLevel: 'ADMIN' });
    await makeMember(ctx, orgB, { accessLevel: 'ADMIN' });
    const m = await makeMember(ctx, orgA, { accessLevel: 'EMPLOYEE' });
    const mB = await joinOrg(orgB, m);
    // Simulates a run that deactivated org A and then failed before the final transaction.
    await ctx.prisma.membership.update({
      where: { id: m.membershipId },
      data: { status: 'DEACTIVATED' },
    });

    expect((await deleteMe(m.cookie)).status).toBe(204);
    const rows = await ctx.prisma.membership.findMany({
      where: { id: { in: [m.membershipId, mB.id] } },
    });
    for (const r of rows) {
      expect(r).toMatchObject({ status: 'DEACTIVATED', displayName: 'Deleted user', email: null });
    }
  });

  it('400 for a missing or wrong confirmation, 401 without a session', async () => {
    const { orgId } = await makeOrg(ctx.prisma);
    const m = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });

    const empty = await deleteMe(m.cookie, {});
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_FAILED');
    expect((await deleteMe(m.cookie, { confirm: 'delete' })).status).toBe(400);
    expect((await deleteMe(undefined)).status).toBe(401);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: m.userId! } });
    expect(user.deletedAt).toBeNull();
  });
});
