import type { INestApplication } from '@nestjs/common';
import { DateTime } from 'luxon';
import { api, createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

type Member = { membershipId: string; cookie?: string };

const TZ = 'Europe/Berlin';
const LEAD_MIN = 120;

/** Starts `fn` after `ms` (stagger so different interleavings of the race get exercised). */
const after = <T>(ms: number, fn: () => PromiseLike<T>): Promise<T> =>
  new Promise((resolve) => setTimeout(resolve, ms)).then(fn);
/** Per-iteration head start in ms for the side that otherwise tends to lose the race. */
const STAGGER = [0, 0, 5, 15, 30, 60];

let dayCounter = 0;
/** A fresh future 4h slot per call, far enough apart that no two collide on the hard rules. */
function nextSlot(hour = 8) {
  const start = DateTime.now()
    .setZone(TZ)
    .plus({ days: 3 + dayCounter++ * 2 })
    .set({ hour, minute: 0, second: 0, millisecond: 0 });
  return { startAt: start.toJSDate(), endAt: start.plus({ hours: 4 }).toJSDate() };
}

describe('deactivate / reactivate members (FR-15, SDD §17)', () => {
  let ctx: TestCtx;
  let app: INestApplication;
  let orgId: string;
  let admin: Member;
  let maria: Member;
  let tom: Member;
  let jonas: Member;

  const membersUrl = (p = '') => `/api/v1/orgs/${orgId}/members${p}`;
  const offersUrl = (p = '') => `/api/v1/orgs/${orgId}/offers${p}`;
  const deactivate = (actor: Member, target: string) =>
    api(app, actor.cookie).post(membersUrl(`/${target}/deactivate`));
  const reactivate = (actor: Member, target: string) =>
    api(app, actor.cookie).post(membersUrl(`/${target}/reactivate`));

  const makeShift = async (assignee: string | null, when = nextSlot()) =>
    (
      await ctx.prisma.shift.create({
        data: { organizationId: orgId, assignedMembershipId: assignee, ...when },
      })
    ).id;

  const giveAway = async (owner: Member, acceptors: Member[]) => {
    const shiftId = await makeShift(owner.membershipId);
    const created = await api(app, owner.cookie)
      .post(offersUrl())
      .send({ shiftId, kind: 'GIVE_AWAY' });
    expect(created.status).toBe(201);
    const acceptanceIds: string[] = [];
    for (const m of acceptors) {
      const res = await api(app, m.cookie).post(offersUrl(`/${created.body.id}/acceptances`));
      expect(res.status).toBe(201);
      acceptanceIds.push(res.body.id);
    }
    return { shiftId, offerId: created.body.id as string, acceptanceIds };
  };

  const openOffers = (shiftId: string) =>
    ctx.prisma.offer.findMany({ where: { shiftId, status: 'OPEN' } });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    orgId = (await makeOrg(ctx.prisma, { timezone: TZ, offerLeadTimeMin: LEAD_MIN })).orgId;
    admin = await makeMember(ctx, orgId, { accessLevel: 'ADMIN', name: 'Ada' });
    maria = await makeMember(ctx, orgId, { accessLevel: 'MANAGER', name: 'Maria' });
    tom = await makeMember(ctx, orgId, { accessLevel: 'MANAGER', name: 'Tom' });
    jonas = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', name: 'Jonas' });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('converts give-aways, unassigns and reposts future shifts, withdraws acceptances', async () => {
    const anna = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', name: 'Anna' });
    const lukas = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', name: 'Lukas' });

    // Anna's open give-away with Lukas PENDING.
    const ga = await giveAway(anna, [lukas]);
    // Two more future shifts, one inside the lead time, one in the past.
    const f1 = await makeShift(anna.membershipId);
    const f2 = await makeShift(anna.membershipId);
    const soonStart = new Date(Date.now() + 60 * 60_000);
    const soon = await makeShift(anna.membershipId, {
      startAt: soonStart,
      endAt: new Date(soonStart.getTime() + 2 * 3600_000),
    });
    const pastStart = new Date(Date.now() - 2 * 24 * 3600_000);
    const past = await makeShift(anna.membershipId, {
      startAt: pastStart,
      endAt: new Date(pastStart.getTime() + 4 * 3600_000),
    });
    // Anna's PENDING acceptance on Jonas's give-away.
    const other = await giveAway(jonas, [anna]);
    // An open invite for Anna.
    const invite = await ctx.prisma.invite.create({
      data: {
        organizationId: orgId,
        membershipId: anna.membershipId,
        email: `anna-${Date.now()}@shiftswap.test`,
        tokenHash: `${Date.now()}`.padEnd(64, '0'),
        expiresAt: new Date(Date.now() + 24 * 3600_000),
        createdByMembershipId: maria.membershipId,
      },
    });
    const shiftsBefore = await ctx.prisma.shift.findMany({
      where: { id: { in: [ga.shiftId, f1, f2, soon, past] } },
    });
    const versionOf = (id: string) => shiftsBefore.find((s) => s.id === id)!.version;

    const res = await deactivate(maria, anna.membershipId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      cancelledOffers: 1,
      reposted: 3,
      unassigned: 4,
      withdrawnAcceptances: 1,
    });

    // (a) give-away cancelled, Lukas's acceptance invalidated.
    const gaOffer = await ctx.prisma.offer.findUniqueOrThrow({ where: { id: ga.offerId } });
    expect(gaOffer).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'OWNER_DEACTIVATED',
      resolvedByMembershipId: maria.membershipId,
      version: 2,
    });
    const lukasAcc = await ctx.prisma.acceptance.findUniqueOrThrow({
      where: { id: ga.acceptanceIds[0] },
    });
    expect(lukasAcc.status).toBe('INVALIDATED');
    expect(lukasAcc.invalidatedReason).toEqual({ code: 'OWNER_DEACTIVATED' });

    // (b) + (c) future shifts unassigned; reposted as OPEN_SHIFT unless inside the lead time.
    for (const id of [ga.shiftId, f1, f2]) {
      const s = await ctx.prisma.shift.findUniqueOrThrow({ where: { id } });
      expect(s.assignedMembershipId).toBeNull();
      expect(s.version).toBe(versionOf(id) + 1);
      const open = await openOffers(id);
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({
        kind: 'OPEN_SHIFT',
        originalOwnerMembershipId: null,
        createdByMembershipId: maria.membershipId,
      });
      expect(open[0].expiresAt.getTime()).toBe(s.startAt.getTime() - LEAD_MIN * 60_000);
    }
    const soonRow = await ctx.prisma.shift.findUniqueOrThrow({ where: { id: soon } });
    expect(soonRow.assignedMembershipId).toBeNull();
    expect(await openOffers(soon)).toHaveLength(0);
    const pastRow = await ctx.prisma.shift.findUniqueOrThrow({ where: { id: past } });
    expect(pastRow.assignedMembershipId).toBe(anna.membershipId);
    expect(pastRow.version).toBe(versionOf(past));

    // (d) Anna's acceptance elsewhere withdrawn; that offer stays OPEN.
    const annaAcc = await ctx.prisma.acceptance.findUniqueOrThrow({
      where: { id: other.acceptanceIds[0] },
    });
    expect(annaAcc.status).toBe('WITHDRAWN');
    const otherOffer = await ctx.prisma.offer.findUniqueOrThrow({ where: { id: other.offerId } });
    expect(otherOffer.status).toBe('OPEN');

    // Membership + invites.
    const m = await ctx.prisma.membership.findUniqueOrThrow({ where: { id: anna.membershipId } });
    expect(m.status).toBe('DEACTIVATED');
    const inv = await ctx.prisma.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(inv.revokedAt).not.toBeNull();

    // Audit: IDs and counts only.
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { organizationId: orgId, action: 'member.deactivated', entityId: anna.membershipId },
    });
    expect(audit.actorMembershipId).toBe(maria.membershipId);
    expect(audit.metadata).toEqual({
      cancelledOffers: 1,
      reposted: 3,
      unassigned: 4,
      withdrawnAcceptances: 1,
    });
    const cancelledAudit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { organizationId: orgId, action: 'offer.cancelled', entityId: ga.offerId },
    });
    expect(cancelledAudit.after).toMatchObject({ cancelReason: 'OWNER_DEACTIVATED' });
    const shiftAudits = await ctx.prisma.auditLog.findMany({
      where: {
        organizationId: orgId,
        action: 'shift.updated',
        entityId: { in: [ga.shiftId, f1, f2, soon] },
      },
    });
    expect(shiftAudits).toHaveLength(4);
    for (const a of shiftAudits) {
      expect(a.before).toMatchObject({ assignedMembershipId: anna.membershipId });
      expect(a.after).toMatchObject({ assignedMembershipId: null });
    }
    expect(
      await ctx.prisma.auditLog.count({
        where: {
          organizationId: orgId,
          action: 'offer.created',
          entityType: 'offer',
          after: { path: ['kind'], equals: 'OPEN_SHIFT' },
          actorMembershipId: maria.membershipId,
        },
      }),
    ).toBeGreaterThanOrEqual(3);
    expect(
      await ctx.prisma.auditLog.count({
        where: {
          organizationId: orgId,
          action: 'acceptance.withdrawn',
          entityId: other.acceptanceIds[0],
        },
      }),
    ).toBe(1);

    // Notifications.
    const notes = (recipient: string, type: string) =>
      ctx.prisma.notification.findMany({
        where: { organizationId: orgId, recipientMembershipId: recipient, type: type as never },
      });
    const invalidated = await notes(lukas.membershipId, 'ACCEPTANCE_INVALIDATED');
    expect(invalidated).toHaveLength(1);
    expect(invalidated[0].payload).toMatchObject({
      offerId: ga.offerId,
      role: 'candidate',
      reason: 'OWNER_DEACTIVATED',
    });
    const tomDeact = await notes(tom.membershipId, 'MEMBER_DEACTIVATED');
    expect(tomDeact).toHaveLength(1);
    expect(tomDeact[0].payload).toEqual({});
    expect(await notes(maria.membershipId, 'MEMBER_DEACTIVATED')).toHaveLength(0);
    expect(await notes(anna.membershipId, 'MEMBER_DEACTIVATED')).toHaveLength(0);
    const reposted = await ctx.prisma.offer.findMany({
      where: { shiftId: { in: [f1, f2] }, status: 'OPEN' },
      select: { id: true },
    });
    const created = await ctx.prisma.notification.findMany({
      where: {
        organizationId: orgId,
        type: 'OFFER_CREATED',
        OR: reposted.map((o) => ({ payload: { path: ['offerId'], equals: o.id } })),
      },
    });
    const recipients = new Set(created.map((n) => n.recipientMembershipId));
    expect(recipients.has(jonas.membershipId)).toBe(true);
    expect(recipients.has(anna.membershipId)).toBe(false);
    expect(recipients.has(maria.membershipId)).toBe(false);

    // A deactivated member loses access (OrgGuard -> 404).
    expect((await api(app, anna.cookie).get(`/api/v1/orgs/${orgId}`)).status).toBe(404);
  });

  it('deactivates a placeholder (no login) and reposts its future shift', async () => {
    const p = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', withLogin: false });
    const shiftId = await makeShift(p.membershipId);
    const res = await deactivate(maria, p.membershipId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      cancelledOffers: 0,
      reposted: 1,
      unassigned: 1,
      withdrawnAcceptances: 0,
    });
    expect((await openOffers(shiftId))[0]?.kind).toBe('OPEN_SHIFT');
  });

  it('permissions and invalid transitions', async () => {
    const emp = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
    const otherEmp = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
    const admin2 = await makeMember(ctx, orgId, { accessLevel: 'ADMIN' });

    // EMPLOYEE -> 403.
    const forbidden = await deactivate(emp, otherEmp.membershipId);
    expect(forbidden.status).toBe(403);
    expect((await reactivate(emp, otherEmp.membershipId)).status).toBe(403);
    // MANAGER cannot deactivate an ADMIN.
    const mgrOnAdmin = await deactivate(maria, admin2.membershipId);
    expect(mgrOnAdmin.status).toBe(403);
    expect(mgrOnAdmin.body.error.code).toBe('FORBIDDEN');
    // Self-deactivation -> 409 INVALID_TRANSITION.
    const self = await deactivate(tom, tom.membershipId);
    expect(self.status).toBe(409);
    expect(self.body.error.code).toBe('INVALID_TRANSITION');
    // Already deactivated -> 409 INVALID_TRANSITION.
    expect((await deactivate(maria, otherEmp.membershipId)).status).toBe(200);
    const again = await deactivate(maria, otherEmp.membershipId);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');
    // ADMIN can deactivate another ADMIN; reactivating an ADMIN also needs an ADMIN.
    expect((await deactivate(admin, admin2.membershipId)).status).toBe(200);
    expect((await reactivate(maria, admin2.membershipId)).status).toBe(403);
    expect((await reactivate(admin, admin2.membershipId)).status).toBe(200);
    // Unknown id -> 404.
    const unknown = await deactivate(maria, '00000000-0000-4000-8000-000000000000');
    expect(unknown.status).toBe(404);
  });

  it('the last active admin cannot be deactivated (409 LAST_ADMIN)', async () => {
    const solo = (await makeOrg(ctx.prisma, { timezone: TZ })).orgId;
    const only = await makeMember(ctx, solo, { accessLevel: 'ADMIN' });
    const res = await api(app, only.cookie).post(
      `/api/v1/orgs/${solo}/members/${only.membershipId}/deactivate`,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_ADMIN');
  });

  it('two admins deactivating each other in parallel: one 200, one 409 LAST_ADMIN', async () => {
    const duo = (await makeOrg(ctx.prisma, { timezone: TZ })).orgId;
    const a = await makeMember(ctx, duo, { accessLevel: 'ADMIN' });
    const b = await makeMember(ctx, duo, { accessLevel: 'ADMIN' });
    const url = (id: string) => `/api/v1/orgs/${duo}/members/${id}/deactivate`;
    const [ra, rb] = await Promise.all([
      api(app, a.cookie).post(url(b.membershipId)),
      api(app, b.cookie).post(url(a.membershipId)),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    expect((ra.status === 409 ? ra : rb).body.error.code).toBe('LAST_ADMIN');
    expect(
      await ctx.prisma.membership.count({
        where: { organizationId: duo, accessLevel: 'ADMIN', status: 'ACTIVE' },
      }),
    ).toBe(1);
  });

  it('reactivate: DEACTIVATED -> ACTIVE, reassigns nothing', async () => {
    const eva = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', name: 'Eva' });
    const shiftId = await makeShift(eva.membershipId);
    expect((await deactivate(maria, eva.membershipId)).status).toBe(200);

    const res = await reactivate(maria, eva.membershipId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: eva.membershipId,
      status: 'ACTIVE',
      hasLogin: true,
      invitePending: false,
    });
    const s = await ctx.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(s.assignedMembershipId).toBeNull();
    expect(await openOffers(shiftId)).toHaveLength(1);
    expect(
      await ctx.prisma.auditLog.count({
        where: { organizationId: orgId, action: 'member.reactivated', entityId: eva.membershipId },
      }),
    ).toBe(1);
    expect((await api(app, eva.cookie).get(`/api/v1/orgs/${orgId}`)).status).toBe(200);

    // Reactivating an ACTIVE member -> 409 INVALID_TRANSITION.
    const again = await reactivate(maria, eva.membershipId);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('reactivate -> 409 ALREADY_MEMBER when the email now belongs to another active member', async () => {
    const addr = `dup-${Date.now()}@shiftswap.test`;
    const old = await ctx.prisma.membership.create({
      data: {
        organizationId: orgId,
        displayName: 'Old Placeholder',
        email: addr,
        accessLevel: 'EMPLOYEE',
        status: 'DEACTIVATED',
      },
    });
    const user = await ctx.prisma.user.create({
      data: { id: `u-${Date.now()}`, name: 'Dup', email: addr.toUpperCase(), emailVerified: false },
    });
    await ctx.prisma.membership.create({
      data: {
        organizationId: orgId,
        displayName: 'New Account',
        userId: user.id,
        accessLevel: 'EMPLOYEE',
      },
    });
    const res = await reactivate(maria, old.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_MEMBER');
  });

  /*
   * Review Focus 2: Tom approves Lukas on Anna's give-away while Maria deactivates Lukas.
   * Either Lukas got the shift and it is then reposted as open, or the approval fails cleanly.
   */
  it('deactivation racing an approval stays consistent (x6)', async () => {
    for (let i = 0; i < STAGGER.length; i++) {
      const anna = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', name: `Anna ${i}` });
      const lukas = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', name: `Lukas ${i}` });
      const own = await makeShift(lukas.membershipId);
      const ga = await giveAway(anna, [lukas]);

      const [approve, deact] = await Promise.all([
        after(STAGGER[i], () =>
          api(app, tom.cookie)
            .post(offersUrl(`/${ga.offerId}/approve`))
            .send({ acceptanceId: ga.acceptanceIds[0], version: 1 }),
        ),
        deactivate(maria, lukas.membershipId),
      ]);
      expect(deact.status).toBe(200);
      expect([200, 409]).toContain(approve.status);

      const l = await ctx.prisma.membership.findUniqueOrThrow({
        where: { id: lukas.membershipId },
      });
      expect(l.status).toBe('DEACTIVATED');
      expect(
        await ctx.prisma.shift.count({
          where: {
            assignedMembershipId: lukas.membershipId,
            startAt: { gt: new Date() },
            deletedAt: null,
          },
        }),
      ).toBe(0);

      for (const shiftId of [own, ga.shiftId]) {
        const s = await ctx.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
        const open = await openOffers(shiftId);
        if (s.assignedMembershipId === null) {
          // Unassigned -> exactly one OPEN open-shift offer, never an assignee.
          expect(open.map((o) => o.kind)).toEqual(['OPEN_SHIFT']);
        } else {
          // Assigned -> an ACTIVE assignee and no open-shift offer.
          const holder = await ctx.prisma.membership.findUniqueOrThrow({
            where: { id: s.assignedMembershipId },
          });
          expect(holder.status).toBe('ACTIVE');
          expect(open.filter((o) => o.kind === 'OPEN_SHIFT')).toHaveLength(0);
        }
      }

      const offer = await ctx.prisma.offer.findUniqueOrThrow({ where: { id: ga.offerId } });
      const acc = await ctx.prisma.acceptance.findUniqueOrThrow({
        where: { id: ga.acceptanceIds[0] },
      });
      if (approve.status === 200) {
        expect(offer.status).toBe('APPROVED');
        expect(acc.status).toBe('SELECTED');
        expect(deact.body).toMatchObject({ unassigned: 2, reposted: 2, withdrawnAcceptances: 0 });
      } else {
        expect(approve.body.error.code).toBe('INVALID_TRANSITION');
        expect(offer.status).toBe('OPEN');
        expect(acc.status).toBe('WITHDRAWN');
        const s = await ctx.prisma.shift.findUniqueOrThrow({ where: { id: ga.shiftId } });
        expect(s.assignedMembershipId).toBe(anna.membershipId);
        expect(deact.body).toMatchObject({ unassigned: 1, reposted: 1, withdrawnAcceptances: 1 });
      }
    }
  });

  it('deactivation racing a claim of an open shift stays consistent (x6)', async () => {
    for (let i = 0; i < STAGGER.length; i++) {
      const lukas = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', name: `Claimer ${i}` });
      const shiftId = await makeShift(null);
      const posted = await api(app, tom.cookie)
        .post(offersUrl())
        .send({ shiftId, kind: 'OPEN_SHIFT' });
      expect(posted.status).toBe(201);

      const [claim, deact] = await Promise.all([
        api(app, lukas.cookie).post(offersUrl(`/${posted.body.id}/claim`)),
        after(STAGGER[i], () => deactivate(maria, lukas.membershipId)),
      ]);
      expect(deact.status).toBe(200);
      // 200 (claimed first), 422 NOT_ACTIVE (waited on the membership lock) or 404 (OrgGuard).
      expect([200, 404, 422]).toContain(claim.status);

      const s = await ctx.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
      expect(s.assignedMembershipId).toBeNull();
      const open = await openOffers(shiftId);
      expect(open.map((o) => o.kind)).toEqual(['OPEN_SHIFT']);
      const original = await ctx.prisma.offer.findUniqueOrThrow({
        where: { id: posted.body.id },
      });
      if (claim.status === 200) {
        expect(original.status).toBe('FILLED');
        expect(open[0].id).not.toBe(original.id);
        expect(deact.body).toMatchObject({ unassigned: 1, reposted: 1 });
      } else {
        expect(original.status).toBe('OPEN');
        expect(deact.body).toMatchObject({ unassigned: 0, reposted: 0 });
      }
    }
  });

  it('an in-progress shift (startAt <= now < endAt) stays assigned', async () => {
    const p = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', withLogin: false });
    const running = await makeShift(p.membershipId, {
      startAt: new Date(Date.now() - 3600_000),
      endAt: new Date(Date.now() + 3600_000),
    });
    const res = await deactivate(maria, p.membershipId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ unassigned: 0, reposted: 0 });
    const s = await ctx.prisma.shift.findUniqueOrThrow({ where: { id: running } });
    expect(s).toMatchObject({ assignedMembershipId: p.membershipId, version: 1 });
    expect(await openOffers(running)).toHaveLength(0);
  });

  /* ---------------------------------------------------- invite <-> membership lock order */

  let inviteN = 0;
  const tokenOf = (link: string) => /\/invites\/([A-Za-z0-9_-]{43})/.exec(link)![1];
  /** A placeholder invited by Maria plus a signed-in user owning the invite email. */
  const invitedPlaceholder = async () => {
    const addr = `race-${Date.now()}-${inviteN++}@shiftswap.test`;
    const created = await api(app, maria.cookie)
      .post(membersUrl())
      .send({ displayName: 'Invitee', email: addr });
    expect(created.status).toBe(201);
    const { orgId: elsewhere } = await makeOrg(ctx.prisma);
    const user = await makeMember(ctx, elsewhere, { accessLevel: 'EMPLOYEE' });
    await ctx.prisma.user.update({ where: { id: user.userId! }, data: { email: addr } });
    return {
      membershipId: created.body.member.id as string,
      token: tokenOf(created.body.inviteLink),
      cookie: user.cookie!,
      userId: user.userId!,
    };
  };
  const acceptInvite = (token: string, cookie: string) =>
    api(app, cookie)
      .post(`/api/v1/invites/${token}/accept`)
      .set('X-Forwarded-For', `10.9.${Math.floor(inviteN / 250)}.${inviteN++ % 250}`);
  /** Locks the invite row like accept does, then (after `ms`) the membership row. */
  const holdInviteThenMembership = (inviteId: string, membershipId: string, ms = 400) => {
    let markLocked!: () => void;
    const locked = new Promise<void>((r) => (markLocked = r));
    const done = ctx.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "invites" WHERE id = ${inviteId} FOR UPDATE`;
        markLocked();
        await new Promise((r) => setTimeout(r, ms));
        await tx.$queryRaw`SELECT id FROM "memberships" WHERE id = ${membershipId} FOR NO KEY UPDATE`;
      },
      { timeout: 15_000 },
    );
    return { locked, done };
  };

  it('deactivation vs a transaction holding invite -> membership locks: no deadlock', async () => {
    const p = await invitedPlaceholder();
    const invite = await ctx.prisma.invite.findFirstOrThrow({
      where: { membershipId: p.membershipId },
    });
    const holder = holdInviteThenMembership(invite.id, p.membershipId);
    await holder.locked;
    const [held, deact] = await Promise.allSettled([
      holder.done,
      deactivate(maria, p.membershipId),
    ]);
    expect(held.status).toBe('fulfilled');
    expect(deact.status === 'fulfilled' && deact.value.status).toBe(200);
    const inv = await ctx.prisma.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(inv.revokedAt).not.toBeNull();
  });

  it('resending an invite vs a transaction holding invite -> membership locks: no deadlock', async () => {
    const p = await invitedPlaceholder();
    const invite = await ctx.prisma.invite.findFirstOrThrow({
      where: { membershipId: p.membershipId },
    });
    const holder = holdInviteThenMembership(invite.id, p.membershipId);
    await holder.locked;
    const [held, resend] = await Promise.allSettled([
      holder.done,
      api(app, maria.cookie)
        .post(membersUrl(`/${p.membershipId}/invite`))
        .send({ appOrigin: 'http://localhost:5173' }),
    ]);
    expect(held.status).toBe('fulfilled');
    expect(resend.status === 'fulfilled' && resend.value.status).toBe(201);
  });

  it('deactivating a placeholder while its invite is accepted in parallel stays consistent (x5)', async () => {
    for (let i = 0; i < 5; i++) {
      const p = await invitedPlaceholder();
      const [acc, deact] = await Promise.all([
        after(STAGGER[i], () => acceptInvite(p.token, p.cookie)),
        deactivate(maria, p.membershipId),
      ]);
      expect(deact.status).toBe(200);
      const m = await ctx.prisma.membership.findUniqueOrThrow({ where: { id: p.membershipId } });
      const inv = await ctx.prisma.invite.findFirstOrThrow({
        where: { membershipId: p.membershipId },
      });
      expect(m.status).toBe('DEACTIVATED');
      if (acc.status === 200) {
        // Accepted first, then deactivated.
        expect(m.userId).toBe(p.userId);
        expect(inv.acceptedAt).not.toBeNull();
        expect(inv.revokedAt).toBeNull();
      } else {
        expect(acc.status).toBe(410);
        expect(acc.body.error.code).toBe('INVITE_INVALID');
        expect(acc.body.error.details).toEqual({ state: 'REVOKED' });
        expect(m.userId).toBeNull();
        expect(inv.acceptedAt).toBeNull();
        expect(inv.revokedAt).not.toBeNull();
      }
    }
  });
});
