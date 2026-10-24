import type { INestApplication } from '@nestjs/common';
import { DateTime } from 'luxon';
import { api, createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

type Member = { membershipId: string; cookie?: string };

const TZ = 'Europe/Berlin';

/** Berlin-local `daysAhead` at hh:00, `hours` long, as UTC instants. */
function slot(daysAhead: number, hour: number, hours: number) {
  const start = DateTime.now()
    .setZone(TZ)
    .plus({ days: daysAhead })
    .set({ hour, minute: 0, second: 0, millisecond: 0 });
  return { startAt: start.toJSDate(), endAt: start.plus({ hours }).toJSDate() };
}

describe('offers API', () => {
  let ctx: TestCtx;
  let app: INestApplication;
  let orgId: string;
  let serviceSkillId: string;
  let tom: Member;
  let anna: Member;
  let lukas: Member;
  let mia: Member;
  let jonas: Member;
  let annaShiftId: string;
  let offerId: string;

  const url = (p = '') => `/api/v1/orgs/${orgId}/offers${p}`;

  const makeShift = async (
    assignee: string | null,
    when: { startAt: Date; endAt: Date },
    skills: string[] = [serviceSkillId],
  ) =>
    (
      await ctx.prisma.shift.create({
        data: {
          organizationId: orgId,
          assignedMembershipId: assignee,
          ...when,
          skills: { create: skills.map((skillId) => ({ skillId })) },
        },
      })
    ).id;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    orgId = (await makeOrg(ctx.prisma, { timezone: TZ })).orgId;
    tom = await makeMember(ctx, orgId, { accessLevel: 'MANAGER', name: 'Tom' });
    anna = await makeMember(ctx, orgId, {
      accessLevel: 'EMPLOYEE',
      name: 'Anna',
      skillNames: ['Service'],
    });
    lukas = await makeMember(ctx, orgId, {
      accessLevel: 'EMPLOYEE',
      name: 'Lukas',
      skillNames: ['Service'],
    });
    mia = await makeMember(ctx, orgId, {
      accessLevel: 'EMPLOYEE',
      name: 'Mia',
      skillNames: ['Service'],
    });
    jonas = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', name: 'Jonas' });
    // Mia's lower weekly limit gives her less headroom -> ranked below Lukas.
    await ctx.prisma.membership.update({
      where: { id: mia.membershipId },
      data: { weeklyLimitMin: 1200 },
    });
    serviceSkillId = (
      await ctx.prisma.skill.findFirstOrThrow({ where: { organizationId: orgId, name: 'Service' } })
    ).id;
    annaShiftId = await makeShift(anna.membershipId, slot(3, 18, 5));
  });
  afterAll(async () => {
    await app?.close();
  });

  describe('give-away', () => {
    it('Lukas cannot offer Anna’s shift -> 403', async () => {
      const res = await api(app, lukas.cookie)
        .post(url())
        .send({ shiftId: annaShiftId, kind: 'GIVE_AWAY' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('Anna creates a give-away -> 201 OfferSummaryDto', async () => {
      const res = await api(app, anna.cookie)
        .post(url())
        .send({ shiftId: annaShiftId, kind: 'GIVE_AWAY' });
      expect(res.status).toBe(201);
      offerId = res.body.id;
      expect(res.body).toMatchObject({
        kind: 'GIVE_AWAY',
        status: 'OPEN',
        version: 1,
        originalOwnerMembershipId: anna.membershipId,
        myAcceptanceStatus: null,
        pendingCount: 0,
      });
      expect(res.body.shift.id).toBe(annaShiftId);
      expect(res.body.shift.openOfferId).toBe(offerId);
      const shift = await ctx.prisma.shift.findUniqueOrThrow({ where: { id: annaShiftId } });
      expect(new Date(res.body.expiresAt).getTime()).toBe(shift.startAt.getTime() - 120 * 60_000);
    });

    it('second offer on the same shift -> 409 OFFER_ALREADY_OPEN', async () => {
      const res = await api(app, anna.cookie)
        .post(url())
        .send({ shiftId: annaShiftId, kind: 'GIVE_AWAY' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('OFFER_ALREADY_OPEN');
    });

    it('offer on a shift starting in 60 min -> 409 OFFER_EXPIRED', async () => {
      const start = new Date(Date.now() + 60 * 60_000);
      const soon = await makeShift(anna.membershipId, {
        startAt: start,
        endAt: new Date(start.getTime() + 2 * 60 * 60_000),
      });
      const res = await api(app, anna.cookie)
        .post(url())
        .send({ shiftId: soon, kind: 'GIVE_AWAY' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('OFFER_EXPIRED');
    });

    it('unknown / malformed offer ids -> 404', async () => {
      const a = await api(app, lukas.cookie).get(url('/not-a-uuid'));
      expect(a.status).toBe(404);
      const b = await api(app, lukas.cookie).post(
        url('/00000000-0000-4000-8000-000000000000/acceptances'),
      );
      expect(b.status).toBe(404);
    });

    it('scope=eligible: Lukas sees the offer, Anna does not', async () => {
      const lukasList = await api(app, lukas.cookie).get(url('?scope=eligible'));
      expect(lukasList.status).toBe(200);
      expect(lukasList.body.map((o: { id: string }) => o.id)).toContain(offerId);
      const annaList = await api(app, anna.cookie).get(url('?scope=eligible'));
      expect(annaList.status).toBe(200);
      expect(annaList.body.map((o: { id: string }) => o.id)).not.toContain(offerId);
      // Jonas lacks the Service skill.
      const jonasList = await api(app, jonas.cookie).get(url('?scope=eligible'));
      expect(jonasList.body.map((o: { id: string }) => o.id)).not.toContain(offerId);
    });

    it('invalid scope -> 400; employee scope=review -> 403', async () => {
      expect((await api(app, lukas.cookie).get(url('?scope=bogus'))).status).toBe(400);
      expect((await api(app, lukas.cookie).get(url('?scope=review'))).status).toBe(403);
    });

    let lukasAcceptanceId: string;

    it('Lukas accepts -> 201 PENDING; retry -> 200 same row', async () => {
      const first = await api(app, lukas.cookie).post(url(`/${offerId}/acceptances`));
      expect(first.status).toBe(201);
      expect(first.body.status).toBe('PENDING');
      lukasAcceptanceId = first.body.id;
      const again = await api(app, lukas.cookie).post(url(`/${offerId}/acceptances`));
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(lukasAcceptanceId);
      expect(again.body.status).toBe('PENDING');
    });

    it('Anna accepting her own shift -> 422 INELIGIBLE IS_OWNER', async () => {
      const res = await api(app, anna.cookie).post(url(`/${offerId}/acceptances`));
      expect(res.status).toBe(422);
      expect(res.body.error.details.failedRules).toContain('IS_OWNER');
    });

    it('Lukas withdraws -> 204; withdraw again -> 409; accept again -> 200 PENDING same row', async () => {
      const w = await api(app, lukas.cookie).delete(url(`/${offerId}/acceptances/me`));
      expect(w.status).toBe(204);
      const row = await ctx.prisma.acceptance.findUniqueOrThrow({
        where: { id: lukasAcceptanceId },
      });
      expect(row.status).toBe('WITHDRAWN');
      const w2 = await api(app, lukas.cookie).delete(url(`/${offerId}/acceptances/me`));
      expect(w2.status).toBe(409);
      expect(w2.body.error.code).toBe('INVALID_TRANSITION');
      const again = await api(app, lukas.cookie).post(url(`/${offerId}/acceptances`));
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(lukasAcceptanceId);
      expect(again.body.status).toBe('PENDING');
    });

    it('withdraw without an acceptance -> 404', async () => {
      const res = await api(app, jonas.cookie).delete(url(`/${offerId}/acceptances/me`));
      expect(res.status).toBe(404);
    });

    it('manager detail ranks acceptances by score (preference 20 for everyone)', async () => {
      const m = await api(app, mia.cookie).post(url(`/${offerId}/acceptances`));
      expect(m.status).toBe(201);

      const res = await api(app, tom.cookie).get(url(`/${offerId}`));
      expect(res.status).toBe(200);
      expect(res.body.pendingCount).toBe(2);
      const accs = res.body.acceptances as {
        membershipId: string;
        displayName: string;
        score: { total: number; breakdown: { preference: number; headroom: number } } | null;
        recheck: { eligible: boolean };
      }[];
      expect(accs.map((a) => a.membershipId)).toEqual([lukas.membershipId, mia.membershipId]);
      expect(accs.map((a) => a.displayName)).toEqual(['Lukas', 'Mia']);
      for (const a of accs) {
        expect(a.recheck.eligible).toBe(true);
        expect(a.score!.breakdown.preference).toBe(20);
      }
      // 300 min shift: Lukas 2400 limit -> headroom 35, Mia 1200 limit -> 30; swap load 20 each.
      expect(accs.map((a) => a.score!.total)).toEqual([75, 70]);
      expect(accs[0].score!.total).toBeGreaterThan(accs[1].score!.total);
    });

    it('manager detail lists non-PENDING acceptances after PENDING ones, unscored', async () => {
      // Lukas has more headroom than Mia, but a withdrawn acceptance ranks below a pending one.
      expect((await api(app, lukas.cookie).delete(url(`/${offerId}/acceptances/me`))).status).toBe(
        204,
      );
      const res = await api(app, tom.cookie).get(url(`/${offerId}`));
      const accs = res.body.acceptances as {
        membershipId: string;
        status: string;
        score: { total: number } | null;
        recheck: { eligible: boolean };
      }[];
      expect(accs.map((a) => [a.membershipId, a.status])).toEqual([
        [mia.membershipId, 'PENDING'],
        [lukas.membershipId, 'WITHDRAWN'],
      ]);
      expect(accs[0].score!.total).toBe(70);
      expect(accs[1].score).toBeNull();
      expect(accs[1].recheck.eligible).toBe(true);
      // Restore Lukas's pending acceptance for the following tests.
      expect((await api(app, lukas.cookie).post(url(`/${offerId}/acceptances`))).status).toBe(200);
    });

    it('two parallel accepts by the same user -> [200, 201], one row, same id', async () => {
      const shiftId = await makeShift(anna.membershipId, slot(40, 18, 5));
      const created = await api(app, anna.cookie).post(url()).send({ shiftId, kind: 'GIVE_AWAY' });
      expect(created.status).toBe(201);
      const [a, b] = await Promise.all([
        api(app, mia.cookie).post(url(`/${created.body.id}/acceptances`)),
        api(app, mia.cookie).post(url(`/${created.body.id}/acceptances`)),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(a.body.id).toBe(b.body.id);
      expect(await ctx.prisma.acceptance.count({ where: { offerId: created.body.id } })).toBe(1);
    });

    it('employee detail: involved see summary + own acceptance only; others 404', async () => {
      const lukasView = await api(app, lukas.cookie).get(url(`/${offerId}`));
      expect(lukasView.status).toBe(200);
      expect(lukasView.body.myAcceptanceStatus).toBe('PENDING');
      expect(lukasView.body.acceptances).toHaveLength(1);
      expect(lukasView.body.acceptances[0].membershipId).toBe(lukas.membershipId);

      const annaView = await api(app, anna.cookie).get(url(`/${offerId}`));
      expect(annaView.status).toBe(200);
      expect(annaView.body.acceptances).toEqual([]);
      expect(annaView.body.pendingCount).toBe(2);

      const jonasView = await api(app, jonas.cookie).get(url(`/${offerId}`));
      expect(jonasView.status).toBe(404);
    });

    it('scope=mine and scope=review', async () => {
      const mine = await api(app, anna.cookie).get(url('?scope=mine'));
      expect(mine.body.map((o: { id: string }) => o.id)).toContain(offerId);
      const lukasMine = await api(app, lukas.cookie).get(url('?scope=mine'));
      const entry = lukasMine.body.find((o: { id: string }) => o.id === offerId);
      expect(entry.myAcceptanceStatus).toBe('PENDING');
      expect((await api(app, jonas.cookie).get(url('?scope=mine'))).body).toEqual([]);
      const review = await api(app, tom.cookie).get(url('?scope=review'));
      expect(review.status).toBe(200);
      const r = review.body.find((o: { id: string }) => o.id === offerId);
      expect(r.pendingCount).toBe(2);
    });

    it('Lukas with an overlapping shift accepts -> 422 INELIGIBLE OVERLAP', async () => {
      const shiftId = await makeShift(anna.membershipId, slot(20, 18, 5));
      const created = await api(app, anna.cookie).post(url()).send({ shiftId, kind: 'GIVE_AWAY' });
      expect(created.status).toBe(201);
      await makeShift(lukas.membershipId, slot(20, 17, 3), []);
      const res = await api(app, lukas.cookie).post(url(`/${created.body.id}/acceptances`));
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INELIGIBLE');
      expect(res.body.error.details.failedRules).toContain('OVERLAP');
      expect(await ctx.prisma.acceptance.count({ where: { offerId: created.body.id } })).toBe(0);
    });

    it('cancel: stale version -> 409; acceptance holder -> 403; uninvolved employee -> 404', async () => {
      const stale = await api(app, anna.cookie)
        .post(url(`/${offerId}/cancel`))
        .send({ version: 2 });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');
      const lukasCancel = await api(app, lukas.cookie)
        .post(url(`/${offerId}/cancel`))
        .send({ version: 1 });
      expect(lukasCancel.status).toBe(403);
      const jonasCancel = await api(app, jonas.cookie)
        .post(url(`/${offerId}/cancel`))
        .send({ version: 1 });
      expect(jonasCancel.status).toBe(404);
      expect(jonasCancel.body.error.code).toBe('NOT_FOUND');
    });

    it('Anna cancels -> CANCELLED / WITHDRAWN, pending acceptances NOT_SELECTED', async () => {
      const res = await api(app, anna.cookie)
        .post(url(`/${offerId}/cancel`))
        .send({ version: 1 });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
      expect(res.body.version).toBe(2);
      const row = await ctx.prisma.offer.findUniqueOrThrow({ where: { id: offerId } });
      expect(row.cancelReason).toBe('WITHDRAWN');
      const accs = await ctx.prisma.acceptance.findMany({ where: { offerId } });
      expect(accs.map((a) => a.status)).toEqual(['NOT_SELECTED', 'NOT_SELECTED']);
      const again = await api(app, anna.cookie)
        .post(url(`/${offerId}/cancel`))
        .send({ version: 2 });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('INVALID_TRANSITION');
    });
  });

  describe('lazy expiry', () => {
    it('accepting an offer past expiresAt -> 409 OFFER_EXPIRED and the offer is EXPIRED', async () => {
      const shiftId = await makeShift(anna.membershipId, slot(30, 18, 5));
      const created = await api(app, anna.cookie).post(url()).send({ shiftId, kind: 'GIVE_AWAY' });
      expect(created.status).toBe(201);
      const id = created.body.id as string;
      await ctx.prisma.acceptance.create({
        data: {
          organizationId: orgId,
          offerId: id,
          membershipId: mia.membershipId,
          status: 'PENDING',
        },
      });
      await ctx.prisma.offer.update({
        where: { id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      const res = await api(app, lukas.cookie).post(url(`/${id}/acceptances`));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('OFFER_EXPIRED');
      const row = await ctx.prisma.offer.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe('EXPIRED');
      const accs = await ctx.prisma.acceptance.findMany({ where: { offerId: id } });
      expect(accs.map((a) => a.status)).toEqual(['NOT_SELECTED']);
      const audit = await ctx.prisma.auditLog.count({
        where: { organizationId: orgId, action: 'offer.expired', entityId: id },
      });
      expect(audit).toBe(1);

      // Already EXPIRED (no lazy expiry this time): still OFFER_EXPIRED, not INVALID_TRANSITION.
      const again = await api(app, lukas.cookie).post(url(`/${id}/acceptances`));
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('OFFER_EXPIRED');
      const withdraw = await api(app, mia.cookie).delete(url(`/${id}/acceptances/me`));
      expect(withdraw.status).toBe(409);
      expect(withdraw.body.error.code).toBe('OFFER_EXPIRED');
      const cancel = await api(app, anna.cookie)
        .post(url(`/${id}/cancel`))
        .send({ version: 2 });
      expect(cancel.status).toBe(409);
      expect(cancel.body.error.code).toBe('OFFER_EXPIRED');
      expect(
        await ctx.prisma.auditLog.count({
          where: { organizationId: orgId, action: 'offer.expired', entityId: id },
        }),
      ).toBe(1);
    });
  });

  describe('open shift', () => {
    let openShiftId: string;
    let openOfferId: string;

    beforeAll(async () => {
      openShiftId = await makeShift(null, slot(10, 18, 5));
    });

    it('employee posting an open shift -> 403', async () => {
      const res = await api(app, lukas.cookie)
        .post(url())
        .send({ shiftId: openShiftId, kind: 'OPEN_SHIFT' });
      expect(res.status).toBe(403);
    });

    it('manager posting an open shift on an assigned shift -> 409 INVALID_TRANSITION', async () => {
      const assigned = await makeShift(anna.membershipId, slot(12, 18, 5));
      const res = await api(app, tom.cookie)
        .post(url())
        .send({ shiftId: assigned, kind: 'OPEN_SHIFT' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
    });

    it('manager posts -> 201; accepting an open shift -> 409 INVALID_TRANSITION', async () => {
      const res = await api(app, tom.cookie)
        .post(url())
        .send({ shiftId: openShiftId, kind: 'OPEN_SHIFT' });
      expect(res.status).toBe(201);
      expect(res.body.originalOwnerMembershipId).toBeNull();
      openOfferId = res.body.id;
      const acc = await api(app, lukas.cookie).post(url(`/${openOfferId}/acceptances`));
      expect(acc.status).toBe(409);
      expect(acc.body.error.code).toBe('INVALID_TRANSITION');
    });

    it('Jonas (missing skill) claims -> 422', async () => {
      const res = await api(app, jonas.cookie).post(url(`/${openOfferId}/claim`));
      expect(res.status).toBe(422);
      expect(res.body.error.details.failedRules).toContain('MISSING_SKILL');
    });

    it('two parallel claims -> exactly one 200 and one 409 OFFER_ALREADY_FILLED', async () => {
      const [a, b] = await Promise.all([
        api(app, lukas.cookie).post(url(`/${openOfferId}/claim`)),
        api(app, mia.cookie).post(url(`/${openOfferId}/claim`)),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);
      const loser = a.status === 409 ? a : b;
      const winnerRes = a.status === 200 ? a : b;
      expect(loser.body.error.code).toBe('OFFER_ALREADY_FILLED');
      expect(winnerRes.body.status).toBe('FILLED');
      const winner = a.status === 200 ? lukas : mia;

      const shift = await ctx.prisma.shift.findUniqueOrThrow({ where: { id: openShiftId } });
      expect(shift.assignedMembershipId).toBe(winner.membershipId);
      expect(shift.version).toBe(2);
      const selected = await ctx.prisma.acceptance.findMany({
        where: { offerId: openOfferId, status: 'SELECTED' },
      });
      expect(selected).toHaveLength(1);
      expect(selected[0].membershipId).toBe(winner.membershipId);
      const offer = await ctx.prisma.offer.findUniqueOrThrow({ where: { id: openOfferId } });
      expect(offer.status).toBe('FILLED');
      expect(offer.selectedAcceptanceId).toBe(selected[0].id);
    });
  });

  describe('claims on closed open-shift offers', () => {
    const postOpenShift = async (daysAhead: number) => {
      const shiftId = await makeShift(null, slot(daysAhead, 18, 5));
      const res = await api(app, tom.cookie).post(url()).send({ shiftId, kind: 'OPEN_SHIFT' });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };

    it('claim on an expired open shift -> 409 OFFER_EXPIRED (first and later requests)', async () => {
      const id = await postOpenShift(14);
      await ctx.prisma.offer.update({
        where: { id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      const first = await api(app, lukas.cookie).post(url(`/${id}/claim`));
      expect(first.status).toBe(409);
      expect(first.body.error.code).toBe('OFFER_EXPIRED');
      const second = await api(app, mia.cookie).post(url(`/${id}/claim`));
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('OFFER_EXPIRED');
    });

    it('claim on a cancelled open shift -> 409 INVALID_TRANSITION', async () => {
      const id = await postOpenShift(16);
      const cancel = await api(app, tom.cookie)
        .post(url(`/${id}/cancel`))
        .send({ version: 1 });
      expect(cancel.status).toBe(200);
      expect(cancel.body.status).toBe('CANCELLED');
      const res = await api(app, lukas.cookie).post(url(`/${id}/claim`));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
    });
  });

  describe('audit', () => {
    it('writes an audit row for each transition, with IDs only', async () => {
      const rows = await ctx.prisma.auditLog.findMany({ where: { organizationId: orgId } });
      const actions = new Set(rows.map((r) => r.action));
      for (const a of [
        'offer.created',
        'acceptance.created',
        'acceptance.withdrawn',
        'acceptance.reactivated',
        'offer.cancelled',
        'offer.expired',
        'offer.filled',
      ]) {
        expect(actions).toContain(a);
      }
      const dump = JSON.stringify(rows.map((r) => [r.before, r.after, r.metadata]));
      for (const name of ['Anna', 'Lukas', 'Mia', 'Tom', 'Jonas', '@shiftswap.test']) {
        expect(dump).not.toContain(name);
      }
      const cancelled = rows.find((r) => r.action === 'offer.cancelled' && r.entityId === offerId);
      expect(cancelled?.after).toMatchObject({ status: 'CANCELLED', cancelReason: 'WITHDRAWN' });
    });
  });
});
