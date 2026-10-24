import type { INestApplication } from '@nestjs/common';
import { AccountModule } from '../src/account/account.module';
import type { Prisma } from '../src/generated/prisma/client';
import { InvitesService } from '../src/invites/invites.service';
import { MailService } from '../src/mail/mail.service';
import { NotificationMailer } from '../src/notifications/notification-mailer';
import { DeactivationService } from '../src/members/deactivation.service';
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
    const ada = await makeMember(ctx, orgA, { accessLevel: 'ADMIN', name: 'Ada' });
    const bea = await makeMember(ctx, orgB, { accessLevel: 'ADMIN', name: 'Bea' });
    const lukas = await makeMember(ctx, orgA, { accessLevel: 'EMPLOYEE', name: 'Lukas Deletable' });
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
    const oldEmail = (await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } })).email;
    const mailer = app.get(NotificationMailer);
    const mail = app.get(MailService);
    const undispatched = () =>
      ctx.prisma.notification.count({ where: { emailDispatchedAt: null } });
    while ((await undispatched()) > 0) await mailer.dispatchPending(1000);
    mail.sent.length = 0;
    const t0 = new Date();

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

    // The give-away shift was reposted as an open shift too.
    expect(
      await ctx.prisma.offer.count({
        where: { shiftId: gaShift, kind: 'OPEN_SHIFT', status: 'OPEN' },
      }),
    ).toBe(1);

    const rows = await ctx.prisma.notification.findMany({
      where: { organizationId: { in: [orgA, orgB] }, createdAt: { gte: t0 } },
    });
    const of = (type: string) => rows.filter((r) => r.type === type);
    const role = (r: (typeof rows)[number]) => (r.payload as { role?: string }).role;
    // The pending candidate learns the give-away is gone.
    expect(of('ACCEPTANCE_INVALIDATED').map((r) => r.recipientMembershipId)).toEqual([
      jonas.membershipId,
    ]);
    // Both reposts reach the eligible members (Jonas), never the deleted user.
    const eligible = of('OFFER_CREATED').filter((r) => role(r) === 'eligible');
    expect(eligible.filter((r) => r.recipientMembershipId === jonas.membershipId)).toHaveLength(2);
    // MEMBER_DEACTIVATED: managers only (Ada in org A, Bea in org B), in-app only.
    const deact = of('MEMBER_DEACTIVATED');
    expect(deact.map((r) => r.recipientMembershipId).sort()).toEqual(
      [ada.membershipId, bea.membershipId].sort(),
    );
    expect(deact.every((r) => r.emailDispatchedAt !== null)).toBe(true);
    const lukasIds = memberships.map((m) => m.id);
    expect(rows.filter((r) => lukasIds.includes(r.recipientMembershipId))).toEqual([]);

    // Dispatch: nothing to the deleted user, and no email mentions the old name or address.
    expect(await mailer.dispatchPending(1000)).toBeGreaterThan(0);
    expect(mail.sent.length).toBeGreaterThan(0);
    for (const m of mail.sent) {
      expect([oldEmail, user.email]).not.toContain(m.to);
      for (const part of [m.subject, m.text, m.html]) {
        expect(part).not.toContain('Lukas Deletable');
        expect(part).not.toContain(oldEmail);
      }
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

  it('409 INVALID_TRANSITION when an admin reactivates the membership of a deleted user', async () => {
    const { orgId } = await makeOrg(ctx.prisma);
    const admin = await makeMember(ctx, orgId, { accessLevel: 'ADMIN' });
    const ghost = await makeMember(ctx, orgId, { accessLevel: 'ADMIN' });
    expect((await deleteMe(ghost.cookie)).status).toBe(204);

    const res = await api(app, admin.cookie).post(
      `/api/v1/orgs/${orgId}/members/${ghost.membershipId}/reactivate`,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    const m = await ctx.prisma.membership.findUniqueOrThrow({
      where: { id: ghost.membershipId },
    });
    expect(m.status).toBe('DEACTIVATED');
  });

  it('deactivates ADMIN memberships first, so a racing LAST_ADMIN fails before other orgs are touched', async () => {
    // The employee org sorts before the admin org, so ordering by org id alone would touch it first.
    const [o1, o2] = [(await makeOrg(ctx.prisma)).orgId, (await makeOrg(ctx.prisma)).orgId].sort();
    const [empOrg, adminOrg] = [o1, o2];
    await makeMember(ctx, empOrg, { accessLevel: 'ADMIN' });
    const otherAdmin = await makeMember(ctx, adminOrg, { accessLevel: 'ADMIN' });
    const m = await makeMember(ctx, adminOrg, { accessLevel: 'ADMIN' });
    const empM = await joinOrg(empOrg, m);
    const shift = await makeShift(empOrg, empM.id);

    const deactivation = app.select(AccountModule).get(DeactivationService);
    const real = deactivation.deactivate.bind(deactivation);
    const order: string[] = [];
    const spy = jest.spyOn(deactivation, 'deactivate').mockImplementation(async (...args) => {
      // The other admin is demoted after the up-front LAST_ADMIN check (a racing demotion).
      if (order.length === 0) {
        await ctx.prisma.membership.update({
          where: { id: otherAdmin.membershipId },
          data: { accessLevel: 'EMPLOYEE' },
        });
      }
      order.push(args[1]);
      return real(...args);
    });
    let res;
    try {
      res = await deleteMe(m.cookie);
    } finally {
      spy.mockRestore();
    }
    expect(order[0]).toBe(m.membershipId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_ADMIN');
    expect(res.body.error.details).toEqual({ organizationIds: [adminOrg] });
    const rows = await ctx.prisma.membership.findMany({
      where: { id: { in: [m.membershipId, empM.id] } },
    });
    expect(rows.map((r) => r.status)).toEqual(['ACTIVE', 'ACTIVE']);
    expect(await ctx.prisma.shift.findUniqueOrThrow({ where: { id: shift } })).toMatchObject({
      assignedMembershipId: empM.id,
    });
  });

  it('409 VERSION_CONFLICT without anonymising when a membership is reactivated mid-deletion', async () => {
    const { orgId } = await makeOrg(ctx.prisma);
    await makeMember(ctx, orgId, { accessLevel: 'ADMIN' });
    const m = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
    const userBefore = await ctx.prisma.user.findUniqueOrThrow({ where: { id: m.userId! } });
    // Simulates a reactivation committing between the deactivations and the final transaction.
    const deactivation = app.select(AccountModule).get(DeactivationService);
    const real = deactivation.deactivate.bind(deactivation);
    const spy = jest.spyOn(deactivation, 'deactivate').mockImplementation(async (...args) => {
      const result = await real(...args);
      await ctx.prisma.membership.update({ where: { id: args[1] }, data: { status: 'ACTIVE' } });
      return result;
    });
    try {
      const res = await deleteMe(m.cookie);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VERSION_CONFLICT');
    } finally {
      spy.mockRestore();
    }
    expect(await ctx.prisma.user.findUniqueOrThrow({ where: { id: m.userId! } })).toEqual(
      userBefore,
    );
    expect(await ctx.prisma.session.count({ where: { userId: m.userId! } })).toBeGreaterThan(0);

    // A retry deactivates the membership again and completes.
    expect((await deleteMe(m.cookie)).status).toBe(204);
  });

  describe('invite accept racing deletion (lock order invites -> memberships -> users)', () => {
    const tokenOf = (link: string) => /\/invites\/([A-Za-z0-9_-]{43})/.exec(link)![1];

    /** U is an employee of org A and holds an open invite (sent to U's email) in org B. */
    const setup = async () => {
      const { orgId: orgA } = await makeOrg(ctx.prisma);
      const { orgId: orgB } = await makeOrg(ctx.prisma);
      await makeMember(ctx, orgA, { accessLevel: 'ADMIN' });
      const adminB = await makeMember(ctx, orgB, { accessLevel: 'ADMIN' });
      const u = await makeMember(ctx, orgA, { accessLevel: 'EMPLOYEE' });
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: u.userId! } });
      const inv = await api(app, adminB.cookie)
        .post(`/api/v1/orgs/${orgB}/members`)
        .send({ displayName: 'Invited U', email: user.email });
      expect(inv.status).toBe(201);
      return {
        u,
        authUser: { id: user.id, email: user.email, name: user.name },
        token: tokenOf(inv.body.inviteLink),
        placeholderId: inv.body.member.id as string,
      };
    };

    it('an accept committing after deletion read the memberships aborts the deletion (409), nothing anonymised', async () => {
      const { u, authUser, token, placeholderId } = await setup();
      const invites = app.get(InvitesService);
      const userId = u.userId!;
      // Deterministic interleave: the accept commits right after the final transaction has
      // read the user's memberships and before it locks them and updates the user row.
      let fired = false;
      type Tx = Prisma.TransactionClient;
      type FindMany = (q: { where?: Record<string, unknown> }) => Promise<unknown>;
      const real = ctx.prisma.$transaction.bind(ctx.prisma) as (...a: unknown[]) => unknown;
      const pausing = (tx: Tx): Tx => {
        const membership = new Proxy(tx.membership, {
          get(m, prop, receiver) {
            if (prop !== 'findMany') return Reflect.get(m, prop, receiver);
            return async (q: { where?: Record<string, unknown> }) => {
              const r = await (m.findMany as unknown as FindMany)(q);
              const w = q?.where ?? {};
              if (!fired && w.userId === userId && w.status === undefined) {
                fired = true;
                await invites.accept(token, authUser);
              }
              return r;
            };
          },
        });
        return new Proxy(tx, {
          get: (t, prop, receiver) =>
            prop === 'membership' ? membership : Reflect.get(t, prop, receiver),
        });
      };
      const spy = jest
        .spyOn(ctx.prisma, '$transaction')
        .mockImplementation(((arg: unknown, ...rest: unknown[]) =>
          typeof arg === 'function'
            ? real((tx: Tx) => (arg as (t: Tx) => unknown)(pausing(tx)), ...rest)
            : real(arg, ...rest)) as never);
      let res;
      try {
        res = await deleteMe(u.cookie);
      } finally {
        spy.mockRestore();
      }
      expect(fired).toBe(true);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VERSION_CONFLICT');
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.deletedAt).toBeNull();
      expect(user.email).toBe(authUser.email);

      // A retry deactivates the freshly accepted membership too and completes.
      expect((await deleteMe(u.cookie)).status).toBe(204);
      const rows = await ctx.prisma.membership.findMany({ where: { userId } });
      expect(rows.map((r) => r.id)).toContain(placeholderId);
      for (const r of rows) {
        expect(r).toMatchObject({
          status: 'DEACTIVATED',
          displayName: 'Deleted user',
          email: null,
        });
      }
    });

    it('an accept after the deletion committed is rejected 401 UNAUTHENTICATED; placeholder stays unclaimed', async () => {
      const { u, authUser, token, placeholderId } = await setup();
      expect((await deleteMe(u.cookie)).status).toBe(204);

      // The request passed the session guard before the deletion committed (stale user).
      await expect(app.get(InvitesService).accept(token, authUser)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
      const p = await ctx.prisma.membership.findUniqueOrThrow({ where: { id: placeholderId } });
      expect(p.userId).toBeNull();
      expect(
        await ctx.prisma.membership.count({ where: { userId: u.userId!, status: 'ACTIVE' } }),
      ).toBe(0);
    });

    // 8 rounds of 3 password sign-ups each: slower than jest's 5 s default on CI runners.
    it('concurrent accept and delete never leave an ACTIVE membership or a real email on a deleted user', async () => {
      for (let i = 0; i < 8; i++) {
        const { u, authUser, token } = await setup();
        await Promise.allSettled([
          app.get(InvitesService).accept(token, authUser),
          deleteMe(u.cookie),
        ]);
        const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: u.userId! } });
        if (user.deletedAt) {
          const rows = await ctx.prisma.membership.findMany({ where: { userId: u.userId! } });
          for (const r of rows) {
            expect(r).toMatchObject({
              status: 'DEACTIVATED',
              displayName: 'Deleted user',
              email: null,
            });
          }
        }
      }
    }, 30_000);
  });

  it('401 for a session of a deleted user (a sign-in that raced the deletion)', async () => {
    const { orgId } = await makeOrg(ctx.prisma);
    await makeMember(ctx, orgId, { accessLevel: 'ADMIN' });
    const m = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
    expect((await deleteMe(m.cookie)).status).toBe(204);
    // The racing sign-in created its session row after the deletion committed.
    const fresh = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
    await ctx.prisma.session.updateMany({
      where: { userId: fresh.userId! },
      data: { userId: m.userId! },
    });

    const me = await api(app, fresh.cookie).get('/api/v1/me');
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('UNAUTHENTICATED');
    expect((await api(app, fresh.cookie).get(`/api/v1/orgs/${orgId}`)).status).toBe(401);
    const created = await api(app, fresh.cookie).post('/api/v1/orgs').send({ name: 'Ghost Org' });
    expect(created.status).toBe(401);
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
