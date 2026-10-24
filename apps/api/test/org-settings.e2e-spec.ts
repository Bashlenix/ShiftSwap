import type { INestApplication } from '@nestjs/common';
import { api, createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

type Member = { membershipId: string; cookie?: string };

const minute = 60_000;
const hour = 60 * minute;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('organisation settings (FR-04)', () => {
  let ctx: TestCtx;
  let app: INestApplication;

  /** A fresh org (lead time 120 min) with an admin, a manager and two employees. */
  const setup = async () => {
    const { orgId } = await makeOrg(ctx.prisma, {
      timezone: 'Europe/Berlin',
      offerLeadTimeMin: 120,
    });
    const admin = await makeMember(ctx, orgId, { accessLevel: 'ADMIN' });
    const manager = await makeMember(ctx, orgId, { accessLevel: 'MANAGER' });
    const anna = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
    const lukas = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
    const patch = (actor: Member, body: object) =>
      api(app, actor.cookie).patch(`/api/v1/orgs/${orgId}`).send(body);
    /** Anna's shift starting `startInMs` from now with an OPEN give-away expiring at start - 2h. */
    const giveAway = async (startInMs: number, id?: string, shiftIdOverride?: string) => {
      const startAt = new Date(Date.now() + startInMs);
      const shift = await ctx.prisma.shift.create({
        data: {
          ...(shiftIdOverride ? { id: shiftIdOverride } : {}),
          organizationId: orgId,
          assignedMembershipId: anna.membershipId,
          startAt,
          endAt: new Date(startAt.getTime() + 4 * hour),
        },
      });
      const offer = await ctx.prisma.offer.create({
        data: {
          ...(id ? { id } : {}),
          organizationId: orgId,
          shiftId: shift.id,
          kind: 'GIVE_AWAY',
          originalOwnerMembershipId: anna.membershipId,
          createdByMembershipId: anna.membershipId,
          expiresAt: new Date(startAt.getTime() - 120 * minute),
        },
      });
      return { shift, offer };
    };
    return { orgId, admin, manager, anna, lukas, patch, giveAway };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });
  afterAll(async () => {
    await app?.close();
  });

  it('PATCH is ADMIN only: MANAGER and EMPLOYEE -> 403', async () => {
    const o = await setup();
    expect((await o.patch(o.manager, { name: 'Nope' })).status).toBe(403);
    expect((await o.patch(o.anna, { name: 'Nope' })).status).toBe(403);
  });

  it('400 for an invalid or offset-style time zone, out-of-range policy or empty body', async () => {
    const o = await setup();
    for (const body of [
      { timezone: 'Mars/Olympus' },
      { timezone: '+01:00' },
      { offerLeadTimeMin: 2881 },
      { minRestMin: -1 },
      {},
    ]) {
      const res = await o.patch(o.admin, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('ADMIN updates settings -> OrgDto (time zone canonicalised); /me reflects the change', async () => {
    const o = await setup();
    const res = await o.patch(o.admin, {
      name: 'Cafe Nord',
      timezone: 'europe/london',
      minRestMin: 600,
      maxDailyMin: 480,
      defaultWeeklyLimitMin: 2100,
      offerLeadTimeMin: 240,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: o.orgId,
      name: 'Cafe Nord',
      timezone: 'Europe/London',
      minRestMin: 600,
      maxDailyMin: 480,
      defaultWeeklyLimitMin: 2100,
      offerLeadTimeMin: 240,
    });
    const me = await api(app, o.anna.cookie).get('/api/v1/me');
    const entry = (
      me.body.memberships as {
        organizationId: string;
        offerLeadTimeMin: number;
        organizationTimezone: string;
      }[]
    ).find((m) => m.organizationId === o.orgId);
    expect(entry).toMatchObject({ offerLeadTimeMin: 240, organizationTimezone: 'Europe/London' });
  });

  it('audits org.updated with the changed fields only', async () => {
    const o = await setup();
    const res = await o.patch(o.admin, { offerLeadTimeMin: 120, minRestMin: 720 });
    expect(res.status).toBe(200);
    const audits = await ctx.prisma.auditLog.findMany({
      where: { organizationId: o.orgId, action: 'org.updated' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entityType: 'organization',
      entityId: o.orgId,
      actorMembershipId: o.admin.membershipId,
      before: { minRestMin: 660 },
      after: { minRestMin: 720 },
    });
  });

  it('raising the lead time 120 -> 600 moves expires_at of OPEN offers only', async () => {
    const o = await setup();
    const open = await o.giveAway(30 * hour);
    const cancelled = await o.giveAway(40 * hour);
    await ctx.prisma.offer.update({
      where: { id: cancelled.offer.id },
      data: { status: 'CANCELLED' },
    });
    const other = await setup();
    const foreign = await other.giveAway(30 * hour);

    const res = await o.patch(o.admin, { offerLeadTimeMin: 600 });
    expect(res.status).toBe(200);
    expect(res.body.offerLeadTimeMin).toBe(600);

    const moved = await ctx.prisma.offer.findUniqueOrThrow({ where: { id: open.offer.id } });
    expect(moved.expiresAt.getTime()).toBe(open.shift.startAt.getTime() - 600 * minute);
    expect(moved.version).toBe(2);
    const untouched = await ctx.prisma.offer.findUniqueOrThrow({
      where: { id: cancelled.offer.id },
    });
    expect(untouched.expiresAt.getTime()).toBe(cancelled.offer.expiresAt.getTime());
    expect(untouched.version).toBe(1);
    const otherOrg = await ctx.prisma.offer.findUniqueOrThrow({ where: { id: foreign.offer.id } });
    expect(otherOrg.expiresAt.getTime()).toBe(foreign.offer.expiresAt.getTime());
    expect(otherOrg.version).toBe(1);
  });

  it('an offer now past its new expiry answers 409 OFFER_EXPIRED on accept (Review Focus 5)', async () => {
    const o = await setup();
    // Starts in 5h: expires in 3h with 120 min, 5h ago with 600 min.
    const { offer } = await o.giveAway(5 * hour);
    expect((await o.patch(o.admin, { offerLeadTimeMin: 600 })).status).toBe(200);
    const res = await api(app, o.lukas.cookie).post(
      `/api/v1/orgs/${o.orgId}/offers/${offer.id}/acceptances`,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OFFER_EXPIRED');
  });

  /*
   * Follow-up (iii): the recompute must lock OPEN offers in id order. A transaction that locks
   * two offers in ascending id order (like deactivation) must not deadlock with it, even when
   * the rows sit in the heap in the opposite order.
   */
  it('lead-time recompute vs a transaction locking offers in id order: no deadlock', async () => {
    const o = await setup();
    // Heap order and shift-id order (the open-offer index) are both the reverse of offer-id order,
    // so an unordered bulk UPDATE reaches the high id first.
    const high = await o.giveAway(
      50 * hour,
      'ffffffff-ffff-4fff-bfff-fffffffffff9',
      '00000000-0000-4000-8000-0000000000a9',
    );
    const low = await o.giveAway(
      60 * hour,
      '00000000-0000-4000-8000-000000000009',
      'ffffffff-ffff-4fff-bfff-ffffffffffa9',
    );
    let markLocked!: () => void;
    const locked = new Promise<void>((r) => (markLocked = r));
    const holder = ctx.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "offers" WHERE id = ${low.offer.id} FOR UPDATE`;
        markLocked();
        await sleep(400); // let the PATCH run into the held lock
        await tx.$queryRaw`SELECT id FROM "offers" WHERE id = ${high.offer.id} FOR UPDATE`;
      },
      { timeout: 15_000 },
    );
    await locked;
    const patch = o.patch(o.admin, { offerLeadTimeMin: 600 });
    const [holderResult, res] = await Promise.allSettled([holder, patch]);
    expect(holderResult.status).toBe('fulfilled');
    expect(res.status === 'fulfilled' && res.value.status).toBe(200);
    for (const { shift, offer } of [high, low]) {
      const row = await ctx.prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });
      expect(row.expiresAt.getTime()).toBe(shift.startAt.getTime() - 600 * minute);
      expect(row.version).toBe(2);
    }
  });
});
