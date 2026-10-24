import type { INestApplication } from '@nestjs/common';
import { DateTime } from 'luxon';
import { OffersService } from '../src/offers/offers.service';
import { api, createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

type Member = { membershipId: string; cookie?: string };

const TZ = 'Europe/Berlin';

function slot(daysAhead: number, hour: number, hours: number) {
  const start = DateTime.now()
    .setZone(TZ)
    .plus({ days: daysAhead })
    .set({ hour, minute: 0, second: 0, millisecond: 0 });
  return { startAt: start.toJSDate(), endAt: start.plus({ hours }).toJSDate() };
}

/** Real parallel requests against real Postgres (SDD §25 mandatory tests). */
describe('concurrency', () => {
  let ctx: TestCtx;
  let app: INestApplication;
  let orgId: string;
  let tom: Member;
  let sara: Member;
  let anna: Member;
  let mia: Member;
  let lukas: Member;
  let jonas: Member;

  const url = (p = '') => `/api/v1/orgs/${orgId}/offers${p}`;

  const makeShift = async (assignee: string | null, when: { startAt: Date; endAt: Date }) =>
    (
      await ctx.prisma.shift.create({
        data: { organizationId: orgId, assignedMembershipId: assignee, ...when },
      })
    ).id;

  const giveAway = async (
    owner: Member,
    when: { startAt: Date; endAt: Date },
    acceptors: Member[],
  ) => {
    const shiftId = await makeShift(owner.membershipId, when);
    const created = await api(app, owner.cookie).post(url()).send({ shiftId, kind: 'GIVE_AWAY' });
    expect(created.status).toBe(201);
    const acceptanceIds: string[] = [];
    for (const m of acceptors) {
      const res = await api(app, m.cookie).post(url(`/${created.body.id}/acceptances`));
      expect(res.status).toBe(201);
      acceptanceIds.push(res.body.id);
    }
    return { shiftId, offerId: created.body.id as string, acceptanceIds };
  };

  const auditCount = (action: string, entityId: string) =>
    ctx.prisma.auditLog.count({ where: { organizationId: orgId, action, entityId } });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    orgId = (await makeOrg(ctx.prisma, { timezone: TZ })).orgId;
    tom = await makeMember(ctx, orgId, { accessLevel: 'MANAGER', name: 'Tom' });
    sara = await makeMember(ctx, orgId, { accessLevel: 'MANAGER', name: 'Sara' });
    anna = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', name: 'Anna' });
    mia = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', name: 'Mia' });
    lukas = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', name: 'Lukas' });
    jonas = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', name: 'Jonas' });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('(a) two managers approve different candidates of one offer -> one 200, one 409', async () => {
    for (let i = 0; i < 3; i++) {
      const { shiftId, offerId, acceptanceIds } = await giveAway(anna, slot(3 + i * 2, 8, 4), [
        lukas,
        jonas,
      ]);
      const [a, b] = await Promise.all([
        api(app, tom.cookie)
          .post(url(`/${offerId}/approve`))
          .send({ acceptanceId: acceptanceIds[0], version: 1 }),
        api(app, sara.cookie)
          .post(url(`/${offerId}/approve`))
          .send({ acceptanceId: acceptanceIds[1], version: 1 }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const winnerIdx = a.status === 200 ? 0 : 1;
      const winner = [lukas, jonas][winnerIdx];

      const selected = await ctx.prisma.acceptance.findMany({
        where: { offerId, status: 'SELECTED' },
      });
      expect(selected).toHaveLength(1);
      expect(selected[0].id).toBe(acceptanceIds[winnerIdx]);
      const loser = await ctx.prisma.acceptance.findUniqueOrThrow({
        where: { id: acceptanceIds[1 - winnerIdx] },
      });
      expect(loser.status).toBe('NOT_SELECTED');
      const s = await ctx.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
      expect(s.assignedMembershipId).toBe(winner.membershipId);
      expect(s.version).toBe(2);
      const o = await ctx.prisma.offer.findUniqueOrThrow({ where: { id: offerId } });
      expect(o).toMatchObject({
        status: 'APPROVED',
        version: 2,
        selectedAcceptanceId: selected[0].id,
      });
      expect(await auditCount('offer.approved', offerId)).toBe(1);
    }
  });

  it('(b) Lukas accepted on two overlapping give-aways; both approved in parallel -> one 200, one 422 OVERLAP', async () => {
    for (let i = 0; i < 3; i++) {
      const day = 20 + i * 2;
      const first = await giveAway(anna, slot(day, 18, 5), [lukas]);
      const second = await giveAway(mia, slot(day, 19, 5), [lukas]);

      const [a, b] = await Promise.all([
        api(app, tom.cookie)
          .post(url(`/${first.offerId}/approve`))
          .send({ acceptanceId: first.acceptanceIds[0], version: 1 }),
        api(app, sara.cookie)
          .post(url(`/${second.offerId}/approve`))
          .send({ acceptanceId: second.acceptanceIds[0], version: 1 }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 422]);
      const rejected = a.status === 422 ? a : b;
      expect(rejected.body.error.code).toBe('INELIGIBLE');
      expect(rejected.body.error.details.failedRules).toContain('OVERLAP');

      const shifts = await ctx.prisma.shift.findMany({
        where: { id: { in: [first.shiftId, second.shiftId] } },
      });
      const lukasShifts = shifts.filter((s) => s.assignedMembershipId === lukas.membershipId);
      expect(lukasShifts).toHaveLength(1);

      const [won, lost] = a.status === 200 ? [first, second] : [second, first];
      const lostOwner = lost === first ? anna : mia;
      expect(lukasShifts[0].id).toBe(won.shiftId);
      expect(shifts.find((s) => s.id === lost.shiftId)!.assignedMembershipId).toBe(
        lostOwner.membershipId,
      );
      const lostAcc = await ctx.prisma.acceptance.findUniqueOrThrow({
        where: { id: lost.acceptanceIds[0] },
      });
      expect(lostAcc.status).toBe('INVALIDATED');
      expect(lostAcc.invalidatedReason).toMatchObject({ code: 'RECHECK_FAILED' });
      expect(
        (await ctx.prisma.offer.findUniqueOrThrow({ where: { id: lost.offerId } })).status,
      ).toBe('OPEN');
    }
  });

  it('(c) expireDue racing an approve -> exactly one of APPROVED or EXPIRED, side effects consistent', async () => {
    const service = app.get(OffersService);
    const outcomes: string[] = [];
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 10; i++) {
      const { shiftId, offerId, acceptanceIds } = await giveAway(anna, slot(40 + i * 2, 8, 4), [
        jonas,
      ]);
      // Even iterations: due for both (lazy expiry and scheduler race to expire it).
      // Odd iterations: not due for the approver's clock, due for the scheduler's -> a real race;
      // the sweep starts 0-40 ms after the approve so both interleavings get exercised.
      const expiresAt = i % 2 === 0 ? new Date(Date.now() - 1_000) : new Date(Date.now() + 60_000);
      await ctx.prisma.offer.update({ where: { id: offerId }, data: { expiresAt } });

      const [res] = await Promise.all([
        api(app, tom.cookie)
          .post(url(`/${offerId}/approve`))
          .send({ acceptanceId: acceptanceIds[0], version: 1 }),
        sleep(i % 2 === 0 ? 0 : (i - 1) * 5).then(() =>
          service.expireDue(new Date(Date.now() + 120_000)),
        ),
      ]);

      const o = await ctx.prisma.offer.findUniqueOrThrow({ where: { id: offerId } });
      const s = await ctx.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
      const acc = await ctx.prisma.acceptance.findUniqueOrThrow({
        where: { id: acceptanceIds[0] },
      });
      const approvedAudits = await auditCount('offer.approved', offerId);
      const expiredAudits = await auditCount('offer.expired', offerId);
      expect(['APPROVED', 'EXPIRED']).toContain(o.status);
      outcomes.push(o.status);
      expect(o.version).toBe(2);
      if (o.status === 'APPROVED') {
        expect(res.status).toBe(200);
        expect(s.assignedMembershipId).toBe(jonas.membershipId);
        expect(s.version).toBe(2);
        expect(acc.status).toBe('SELECTED');
        expect([approvedAudits, expiredAudits]).toEqual([1, 0]);
      } else {
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('OFFER_EXPIRED');
        expect(s.assignedMembershipId).toBe(anna.membershipId);
        expect(s.version).toBe(1);
        expect(acc.status).toBe('NOT_SELECTED');
        expect([approvedAudits, expiredAudits]).toEqual([0, 1]);
      }
    }
    // Due-for-both iterations can only end EXPIRED.
    expect(outcomes.filter((_, i) => i % 2 === 0)).toEqual(Array(5).fill('EXPIRED'));
  });

  it('(c2) expireDue skips an offer whose lock is held (SKIP LOCKED) and never expires it once resolved', async () => {
    const service = app.get(OffersService);
    const { offerId } = await giveAway(anna, slot(90, 8, 4), [jonas]);
    await ctx.prisma.offer.update({
      where: { id: offerId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let markLocked!: () => void;
    const locked = new Promise<void>((r) => (markLocked = r));
    // Stands in for an approve holding the offer lock and resolving the offer.
    const holder = ctx.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "offers" WHERE id = ${offerId} FOR UPDATE`;
        markLocked();
        await gate;
        await tx.offer.update({
          where: { id: offerId },
          data: { status: 'REJECTED', version: { increment: 1 } },
        });
      },
      { timeout: 15_000 },
    );
    await locked;
    try {
      // The sweep must not wait for the held row: it finishes while the lock is still held.
      const outcome = await Promise.race([
        service.expireDue(new Date()).then(() => 'swept'),
        new Promise((r) => setTimeout(() => r('blocked'), 2_000)),
      ]);
      expect(outcome).toBe('swept');
    } finally {
      release();
      await holder;
    }
    await service.expireDue(new Date());
    const o = await ctx.prisma.offer.findUniqueOrThrow({ where: { id: offerId } });
    expect(o).toMatchObject({ status: 'REJECTED', version: 2 });
    expect(await auditCount('offer.expired', offerId)).toBe(0);
  });

  it('(c3) expireDue vs a transaction locking two due offers in id order: no deadlock', async () => {
    const service = app.get(OffersService);
    // Heap order and shift-id order (the open-offer index) are both the reverse of offer-id order,
    // so an unordered bulk UPDATE reaches the high id first.
    const ids = ['ffffffff-ffff-4fff-bfff-fffffffffff8', '00000000-0000-4000-8000-000000000008'];
    const shiftIds = [
      '00000000-0000-4000-8000-0000000000a8',
      'ffffffff-ffff-4fff-bfff-ffffffffffa8',
    ];
    for (const [i, id] of ids.entries()) {
      const shiftId = shiftIds[i];
      await ctx.prisma.shift.create({
        data: {
          id: shiftId,
          organizationId: orgId,
          assignedMembershipId: anna.membershipId,
          ...slot(95 + i * 2, 8, 4),
        },
      });
      await ctx.prisma.offer.create({
        data: {
          id,
          organizationId: orgId,
          shiftId,
          kind: 'GIVE_AWAY',
          originalOwnerMembershipId: anna.membershipId,
          createdByMembershipId: anna.membershipId,
          expiresAt: new Date(Date.now() - 1_000),
        },
      });
    }
    const [high, low] = ids;
    let markLocked!: () => void;
    const locked = new Promise<void>((r) => (markLocked = r));
    // Locks like deactivation does: offers ascending by id.
    const holder = ctx.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "offers" WHERE id = ${low} FOR UPDATE`;
        markLocked();
        await new Promise((r) => setTimeout(r, 400));
        await tx.$queryRaw`SELECT id FROM "offers" WHERE id = ${high} FOR UPDATE`;
      },
      { timeout: 15_000 },
    );
    await locked;
    const [held, swept] = await Promise.allSettled([holder, service.expireDue(new Date())]);
    expect(held.status).toBe('fulfilled');
    expect(swept.status).toBe('fulfilled');
    // The held offer was skipped this round; the next sweep expires it.
    await service.expireDue(new Date());
    for (const id of ids) {
      const o = await ctx.prisma.offer.findUniqueOrThrow({ where: { id } });
      expect(o).toMatchObject({ status: 'EXPIRED', version: 2 });
      expect(await auditCount('offer.expired', id)).toBe(1);
    }
  });

  it('(d) shift PATCH racing an approve -> one 200, one 409, no deadlock', async () => {
    for (let i = 0; i < 5; i++) {
      const { shiftId, offerId, acceptanceIds } = await giveAway(anna, slot(60 + i * 2, 8, 4), [
        jonas,
      ]);
      const moved = slot(60 + i * 2, 9, 4);
      const [approve, patch] = await Promise.all([
        api(app, tom.cookie)
          .post(url(`/${offerId}/approve`))
          .send({ acceptanceId: acceptanceIds[0], version: 1 }),
        api(app, sara.cookie).patch(`/api/v1/orgs/${orgId}/shifts/${shiftId}`).send({
          startAt: moved.startAt.toISOString(),
          endAt: moved.endAt.toISOString(),
          version: 1,
        }),
      ]);
      expect([approve.status, patch.status].sort()).toEqual([200, 409]);
      const o = await ctx.prisma.offer.findUniqueOrThrow({ where: { id: offerId } });
      const s = await ctx.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
      const acc = await ctx.prisma.acceptance.findUniqueOrThrow({
        where: { id: acceptanceIds[0] },
      });
      if (approve.status === 200) {
        expect(patch.body.error.code).toBe('VERSION_CONFLICT');
        expect(o.status).toBe('APPROVED');
        expect(s.assignedMembershipId).toBe(jonas.membershipId);
        expect(s.startAt.getTime()).not.toBe(moved.startAt.getTime());
        expect(acc.status).toBe('SELECTED');
      } else {
        expect(approve.body.error.code).toBe('VERSION_CONFLICT');
        expect(o.status).toBe('OPEN');
        expect(s.assignedMembershipId).toBe(anna.membershipId);
        expect(s.startAt.getTime()).toBe(moved.startAt.getTime());
        expect(acc.status).toBe('INVALIDATED');
      }
    }
  });
});
