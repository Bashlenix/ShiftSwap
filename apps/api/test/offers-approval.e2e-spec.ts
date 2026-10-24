import type { INestApplication } from '@nestjs/common';
import { DateTime } from 'luxon';
import { OffersService } from '../src/offers/offers.service';
import { api, createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

type Member = { membershipId: string; cookie?: string };

const TZ = 'Europe/Berlin';
const LEAD_MS = 120 * 60_000;

/** Berlin-local `daysAhead` at hh:00, `hours` long, as UTC instants. */
function slot(daysAhead: number, hour: number, hours: number) {
  const start = DateTime.now()
    .setZone(TZ)
    .plus({ days: daysAhead })
    .set({ hour, minute: 0, second: 0, millisecond: 0 });
  return { startAt: start.toJSDate(), endAt: start.plus({ hours }).toJSDate() };
}

describe('offer approval, rejection, shift side effects and expiry', () => {
  let ctx: TestCtx;
  let app: INestApplication;
  let orgId: string;
  let tom: Member;
  let sara: Member;
  let anna: Member;
  let lukas: Member;
  let mia: Member;

  const url = (p = '') => `/api/v1/orgs/${orgId}/offers${p}`;
  const shiftUrl = (p = '') => `/api/v1/orgs/${orgId}/shifts${p}`;

  const makeShift = async (assignee: string | null, when: { startAt: Date; endAt: Date }) =>
    (
      await ctx.prisma.shift.create({
        data: { organizationId: orgId, assignedMembershipId: assignee, ...when },
      })
    ).id;

  /** Owner gives away a fresh shift; the given members accept. */
  const giveAway = async (owner: Member, daysAhead: number, acceptors: Member[] = []) => {
    const shiftId = await makeShift(owner.membershipId, slot(daysAhead, 18, 5));
    const created = await api(app, owner.cookie).post(url()).send({ shiftId, kind: 'GIVE_AWAY' });
    expect(created.status).toBe(201);
    const offerId = created.body.id as string;
    const acceptanceIds: string[] = [];
    for (const m of acceptors) {
      const res = await api(app, m.cookie).post(url(`/${offerId}/acceptances`));
      expect(res.status).toBe(201);
      acceptanceIds.push(res.body.id);
    }
    return { shiftId, offerId, acceptanceIds };
  };

  const acceptance = (id: string) => ctx.prisma.acceptance.findUniqueOrThrow({ where: { id } });
  const offer = (id: string) => ctx.prisma.offer.findUniqueOrThrow({ where: { id } });
  const shift = (id: string) => ctx.prisma.shift.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    orgId = (await makeOrg(ctx.prisma, { timezone: TZ })).orgId;
    tom = await makeMember(ctx, orgId, { accessLevel: 'MANAGER', name: 'Tom' });
    sara = await makeMember(ctx, orgId, { accessLevel: 'ADMIN', name: 'Sara' });
    anna = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', name: 'Anna' });
    lukas = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', name: 'Lukas' });
    mia = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', name: 'Mia' });
  });
  afterAll(async () => {
    await app?.close();
  });

  describe('approve', () => {
    let shiftId: string;
    let offerId: string;
    let lukasAcc: string;
    let miaAcc: string;

    beforeAll(async () => {
      ({
        shiftId,
        offerId,
        acceptanceIds: [lukasAcc, miaAcc],
      } = await giveAway(anna, 3, [lukas, mia]));
    });

    it('employee approve -> 403', async () => {
      const res = await api(app, lukas.cookie)
        .post(url(`/${offerId}/approve`))
        .send({ acceptanceId: lukasAcc, version: 1 });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('invalid body -> 400; unknown acceptance -> 404', async () => {
      const bad = await api(app, tom.cookie)
        .post(url(`/${offerId}/approve`))
        .send({ acceptanceId: 'nope', version: 1 });
      expect(bad.status).toBe(400);
      const unknown = await api(app, tom.cookie)
        .post(url(`/${offerId}/approve`))
        .send({ acceptanceId: '00000000-0000-4000-8000-000000000000', version: 1 });
      expect(unknown.status).toBe(404);
    });

    it('stale version -> 409 VERSION_CONFLICT', async () => {
      const res = await api(app, tom.cookie)
        .post(url(`/${offerId}/approve`))
        .send({ acceptanceId: lukasAcc, version: 2 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('approving a non-pending acceptance -> 409 INVALID_TRANSITION', async () => {
      expect((await api(app, mia.cookie).delete(url(`/${offerId}/acceptances/me`))).status).toBe(
        204,
      );
      const res = await api(app, tom.cookie)
        .post(url(`/${offerId}/approve`))
        .send({ acceptanceId: miaAcc, version: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      expect((await api(app, mia.cookie).post(url(`/${offerId}/acceptances`))).status).toBe(200);
    });

    it('acceptance of another offer -> 409 INVALID_TRANSITION', async () => {
      const other = await giveAway(anna, 4, [mia]);
      const res = await api(app, tom.cookie)
        .post(url(`/${offerId}/approve`))
        .send({ acceptanceId: other.acceptanceIds[0], version: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
    });

    it('Tom approves Lukas -> 200; shift is Lukas’s; Mia NOT_SELECTED', async () => {
      const res = await api(app, tom.cookie)
        .post(url(`/${offerId}/approve`))
        .send({ acceptanceId: lukasAcc, version: 1 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: offerId, status: 'APPROVED', version: 2 });
      expect(res.body.shift.assignedMembershipId).toBe(lukas.membershipId);
      expect(Array.isArray(res.body.acceptances)).toBe(true);

      const s = await shift(shiftId);
      expect(s.assignedMembershipId).toBe(lukas.membershipId);
      expect(s.version).toBe(2);
      const o = await offer(offerId);
      expect(o).toMatchObject({
        status: 'APPROVED',
        selectedAcceptanceId: lukasAcc,
        resolvedByMembershipId: tom.membershipId,
        version: 2,
      });
      expect(o.resolvedAt).not.toBeNull();
      expect((await acceptance(lukasAcc)).status).toBe('SELECTED');
      expect((await acceptance(miaAcc)).status).toBe('NOT_SELECTED');

      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { organizationId: orgId, action: 'offer.approved', entityId: offerId },
      });
      expect(audit.actorMembershipId).toBe(tom.membershipId);
      expect(audit.metadata).toMatchObject({ acceptanceId: lukasAcc, selfApproved: false });

      const mine = await api(app, anna.cookie).get(url('?scope=mine'));
      const entry = mine.body.find((o: { id: string }) => o.id === offerId);
      expect(entry.status).toBe('APPROVED');
    });

    it('approving again -> 409 INVALID_TRANSITION', async () => {
      const res = await api(app, tom.cookie)
        .post(url(`/${offerId}/approve`))
        .send({ acceptanceId: lukasAcc, version: 2 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
    });

    it('candidate gained an overlapping shift -> 422, acceptance INVALIDATED, shift still Anna’s', async () => {
      const { shiftId: sid, offerId: oid, acceptanceIds } = await giveAway(anna, 6, [lukas]);
      await makeShift(lukas.membershipId, slot(6, 17, 3));
      const res = await api(app, tom.cookie)
        .post(url(`/${oid}/approve`))
        .send({ acceptanceId: acceptanceIds[0], version: 1 });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INELIGIBLE');
      expect(res.body.error.details.failedRules).toContain('OVERLAP');

      const acc = await acceptance(acceptanceIds[0]);
      expect(acc.status).toBe('INVALIDATED');
      expect(acc.invalidatedReason).toEqual({
        code: 'RECHECK_FAILED',
        failedRules: res.body.error.details.failedRules,
      });
      expect((await shift(sid)).assignedMembershipId).toBe(anna.membershipId);
      expect(await offer(oid)).toMatchObject({ status: 'OPEN', version: 1 });
      const audit = await ctx.prisma.auditLog.count({
        where: { organizationId: orgId, action: 'acceptance.invalidated', entityId: acc.id },
      });
      expect(audit).toBe(1);
    });

    it('approving an open shift -> 409 INVALID_TRANSITION', async () => {
      const sid = await makeShift(null, slot(8, 18, 5));
      const created = await api(app, tom.cookie)
        .post(url())
        .send({ shiftId: sid, kind: 'OPEN_SHIFT' });
      expect(created.status).toBe(201);
      const res = await api(app, tom.cookie)
        .post(url(`/${created.body.id}/approve`))
        .send({ acceptanceId: lukasAcc, version: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
    });

    it('approving an expired offer -> 409 OFFER_EXPIRED', async () => {
      const { offerId: oid, acceptanceIds } = await giveAway(anna, 9, [mia]);
      await ctx.prisma.offer.update({
        where: { id: oid },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      const res = await api(app, tom.cookie)
        .post(url(`/${oid}/approve`))
        .send({ acceptanceId: acceptanceIds[0], version: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('OFFER_EXPIRED');
      expect((await offer(oid)).status).toBe('EXPIRED');
    });
  });

  describe('self-approval', () => {
    it('Tom approving his own give-away while another manager exists -> 403', async () => {
      const { offerId: oid, shiftId: sid, acceptanceIds } = await giveAway(tom, 11, [lukas]);
      const res = await api(app, tom.cookie)
        .post(url(`/${oid}/approve`))
        .send({ acceptanceId: acceptanceIds[0], version: 1 });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SELF_APPROVAL_FORBIDDEN');
      expect((await shift(sid)).assignedMembershipId).toBe(tom.membershipId);
      expect((await offer(oid)).status).toBe('OPEN');
      // The other manager may approve it.
      const bySara = await api(app, sara.cookie)
        .post(url(`/${oid}/approve`))
        .send({ acceptanceId: acceptanceIds[0], version: 1 });
      expect(bySara.status).toBe(200);
    });

    it('sole manager approves own give-away -> 200, audit selfApproved', async () => {
      const soloOrg = (await makeOrg(ctx.prisma, { timezone: TZ })).orgId;
      const solo = await makeMember(ctx, soloOrg, { accessLevel: 'MANAGER', name: 'Tom' });
      const emp = await makeMember(ctx, soloOrg, { accessLevel: 'EMPLOYEE', name: 'Lukas' });
      // An inactive admin does not count as a second approver.
      const gone = await makeMember(ctx, soloOrg, { accessLevel: 'ADMIN', name: 'Gone' });
      await ctx.prisma.membership.update({
        where: { id: gone.membershipId },
        data: { status: 'DEACTIVATED' },
      });
      const soloUrl = (p = '') => `/api/v1/orgs/${soloOrg}/offers${p}`;
      const sid = (
        await ctx.prisma.shift.create({
          data: {
            organizationId: soloOrg,
            assignedMembershipId: solo.membershipId,
            ...slot(5, 18, 5),
          },
        })
      ).id;
      const created = await api(app, solo.cookie)
        .post(soloUrl())
        .send({ shiftId: sid, kind: 'GIVE_AWAY' });
      expect(created.status).toBe(201);
      const acc = await api(app, emp.cookie).post(soloUrl(`/${created.body.id}/acceptances`));
      expect(acc.status).toBe(201);
      const res = await api(app, solo.cookie)
        .post(soloUrl(`/${created.body.id}/approve`))
        .send({ acceptanceId: acc.body.id, version: 1 });
      expect(res.status).toBe(200);
      expect((await shift(sid)).assignedMembershipId).toBe(emp.membershipId);
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { organizationId: soloOrg, action: 'offer.approved', entityId: created.body.id },
      });
      expect(audit.metadata).toMatchObject({ selfApproved: true });
    });
  });

  describe('reject', () => {
    it('employee reject -> 403; stale version -> 409', async () => {
      const { offerId: oid } = await giveAway(anna, 13, [mia]);
      expect(
        (
          await api(app, anna.cookie)
            .post(url(`/${oid}/reject`))
            .send({ version: 1 })
        ).status,
      ).toBe(403);
      const stale = await api(app, tom.cookie)
        .post(url(`/${oid}/reject`))
        .send({ version: 3 });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('Tom rejects -> REJECTED, shift stays Anna’s, PENDING -> NOT_SELECTED', async () => {
      const { offerId: oid, shiftId: sid, acceptanceIds } = await giveAway(anna, 15, [mia]);
      const res = await api(app, tom.cookie)
        .post(url(`/${oid}/reject`))
        .send({ version: 1 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: oid, status: 'REJECTED', version: 2 });
      expect((await shift(sid)).assignedMembershipId).toBe(anna.membershipId);
      expect(await offer(oid)).toMatchObject({
        status: 'REJECTED',
        resolvedByMembershipId: tom.membershipId,
      });
      expect((await acceptance(acceptanceIds[0])).status).toBe('NOT_SELECTED');
      expect(
        await ctx.prisma.auditLog.count({
          where: { organizationId: orgId, action: 'offer.rejected', entityId: oid },
        }),
      ).toBe(1);
      const again = await api(app, tom.cookie)
        .post(url(`/${oid}/reject`))
        .send({ version: 2 });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('INVALID_TRANSITION');
    });
  });

  describe('shift side effects', () => {
    it('PATCH time -> PENDING INVALIDATED SHIFT_CHANGED, offer OPEN, expiresAt moved', async () => {
      const { offerId: oid, shiftId: sid, acceptanceIds } = await giveAway(anna, 17, [lukas, mia]);
      const before = await offer(oid);
      const moved = slot(17, 19, 5);
      const res = await api(app, tom.cookie)
        .patch(shiftUrl(`/${sid}`))
        .send({
          startAt: moved.startAt.toISOString(),
          endAt: moved.endAt.toISOString(),
          version: 1,
        });
      expect(res.status).toBe(200);
      const after = await offer(oid);
      expect(after.status).toBe('OPEN');
      expect(after.expiresAt.getTime()).toBe(moved.startAt.getTime() - LEAD_MS);
      expect(after.version).toBe(before.version + 1);
      for (const id of acceptanceIds) {
        const a = await acceptance(id);
        expect(a.status).toBe('INVALIDATED');
        expect(a.invalidatedReason).toEqual({ code: 'SHIFT_CHANGED' });
      }
      // Candidates may accept again.
      expect((await api(app, lukas.cookie).post(url(`/${oid}/acceptances`))).status).toBe(200);
    });

    it('PATCH required skills -> PENDING INVALIDATED', async () => {
      const { shiftId: sid, acceptanceIds } = await giveAway(anna, 19, [mia]);
      const skill = await ctx.prisma.skill.create({ data: { organizationId: orgId, name: 'Bar' } });
      const res = await api(app, tom.cookie)
        .patch(shiftUrl(`/${sid}`))
        .send({ requiredSkillIds: [skill.id], version: 1 });
      expect(res.status).toBe(200);
      expect((await acceptance(acceptanceIds[0])).status).toBe('INVALIDATED');
    });

    it('PATCH notes / location only -> offer and acceptances untouched', async () => {
      const { offerId: oid, shiftId: sid, acceptanceIds } = await giveAway(anna, 21, [mia]);
      const before = await offer(oid);
      const res = await api(app, tom.cookie)
        .patch(shiftUrl(`/${sid}`))
        .send({ notes: 'Bring keys', location: 'Bar', version: 1 });
      expect(res.status).toBe(200);
      const after = await offer(oid);
      expect(after).toMatchObject({
        status: 'OPEN',
        version: before.version,
        expiresAt: before.expiresAt,
      });
      expect((await acceptance(acceptanceIds[0])).status).toBe('PENDING');
    });

    it('PATCH assignee -> offer CANCELLED SHIFT_REASSIGNED, PENDING -> NOT_SELECTED', async () => {
      const { offerId: oid, shiftId: sid, acceptanceIds } = await giveAway(anna, 23, [mia]);
      const res = await api(app, tom.cookie)
        .patch(shiftUrl(`/${sid}`))
        .send({ assignedMembershipId: lukas.membershipId, version: 1 });
      expect(res.status).toBe(200);
      expect(res.body.shift.openOfferId).toBeNull();
      expect(await offer(oid)).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'SHIFT_REASSIGNED',
      });
      expect((await acceptance(acceptanceIds[0])).status).toBe('NOT_SELECTED');
    });

    it('DELETE shift -> offer CANCELLED SHIFT_DELETED, PENDING -> NOT_SELECTED', async () => {
      const { offerId: oid, shiftId: sid, acceptanceIds } = await giveAway(anna, 25, [mia]);
      const res = await api(app, tom.cookie).delete(shiftUrl(`/${sid}?version=1`));
      expect(res.status).toBe(204);
      expect(await offer(oid)).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'SHIFT_DELETED',
      });
      expect((await acceptance(acceptanceIds[0])).status).toBe('NOT_SELECTED');
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { organizationId: orgId, action: 'offer.cancelled', entityId: oid },
      });
      expect(audit.after).toMatchObject({ status: 'CANCELLED', cancelReason: 'SHIFT_DELETED' });
    });
  });

  describe('expireDue', () => {
    it('expires due OPEN offers, closes PENDING acceptances, audits with no actor', async () => {
      const service = app.get(OffersService);
      const due = await giveAway(anna, 27, [mia]);
      const notDue = await giveAway(anna, 29, [lukas]);
      await ctx.prisma.offer.update({
        where: { id: due.offerId },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });

      const count = await service.expireDue(new Date());
      expect(count).toBeGreaterThanOrEqual(1);
      expect(await offer(due.offerId)).toMatchObject({ status: 'EXPIRED', version: 2 });
      expect((await acceptance(due.acceptanceIds[0])).status).toBe('NOT_SELECTED');
      expect((await offer(notDue.offerId)).status).toBe('OPEN');
      expect((await acceptance(notDue.acceptanceIds[0])).status).toBe('PENDING');
      const audit = await ctx.prisma.auditLog.findMany({
        where: { organizationId: orgId, action: 'offer.expired', entityId: due.offerId },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0].actorMembershipId).toBeNull();

      // Nothing left to expire for that offer: a second run does not double-expire it.
      await service.expireDue(new Date());
      expect(
        await ctx.prisma.auditLog.count({
          where: { organizationId: orgId, action: 'offer.expired', entityId: due.offerId },
        }),
      ).toBe(1);
    });
  });

  describe('audit', () => {
    it('new audit rows carry IDs only', async () => {
      const rows = await ctx.prisma.auditLog.findMany({ where: { organizationId: orgId } });
      const dump = JSON.stringify(rows.map((r) => [r.before, r.after, r.metadata]));
      for (const name of ['Anna', 'Lukas', 'Mia', 'Tom', 'Sara', '@shiftswap.test', 'Bring keys']) {
        expect(dump).not.toContain(name);
      }
    });
  });
});
