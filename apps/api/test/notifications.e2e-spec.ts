import type { INestApplication } from '@nestjs/common';
import type { NotificationType } from '@shiftswap/shared';
import { DateTime } from 'luxon';
import { OffersService } from '../src/offers/offers.service';
import { api, createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

type Member = { membershipId: string; cookie?: string };

const TZ = 'Europe/Berlin';
let dayCounter = 10;

/** Fresh 5h slot, 3 days apart from the previous one (no overlap/rest/weekly interference). */
function nextSlot() {
  dayCounter += 3;
  const start = DateTime.now()
    .setZone(TZ)
    .plus({ days: dayCounter })
    .set({ hour: 12, minute: 0, second: 0, millisecond: 0 });
  return { startAt: start.toJSDate(), endAt: start.plus({ hours: 5 }).toJSDate() };
}

describe('in-app notifications', () => {
  let ctx: TestCtx;
  let app: INestApplication;
  let orgId: string;
  let otherOrgId: string;
  let owner: Member;
  let e1: Member;
  let e2: Member;
  let deactivated: Member;
  let mgr: Member;
  let mgrElig: Member;
  let admin: Member;
  let outsider: Member;

  const url = (p = '') => `/api/v1/orgs/${orgId}/offers${p}`;
  const ids = (...m: Member[]) => m.map((x) => x.membershipId).sort();

  const makeShift = async (assignee: string | null, when = nextSlot()) =>
    (
      await ctx.prisma.shift.create({
        data: {
          organizationId: orgId,
          assignedMembershipId: assignee,
          ...when,
          skills: { create: [{ skillId: barSkillId }] },
        },
      })
    ).id;
  let barSkillId: string;

  const giveAway = async (acceptors: Member[] = []) => {
    const shiftId = await makeShift(owner.membershipId);
    const res = await api(app, owner.cookie).post(url()).send({ shiftId, kind: 'GIVE_AWAY' });
    expect(res.status).toBe(201);
    const offerId = res.body.id as string;
    const acceptanceIds: string[] = [];
    for (const m of acceptors) {
      const a = await api(app, m.cookie).post(url(`/${offerId}/acceptances`));
      expect(a.status).toBe(201);
      acceptanceIds.push(a.body.id);
    }
    return { shiftId, offerId, acceptanceIds };
  };

  /** recipient -> role for one type on one offer (empty when none). */
  const rows = async (type: NotificationType, offerId: string) => {
    const all = await ctx.prisma.notification.findMany({
      where: { organizationId: orgId, type },
    });
    return all.filter((n) => (n.payload as { offerId?: string }).offerId === offerId);
  };
  const recipients = async (type: NotificationType, offerId: string) =>
    (await rows(type, offerId)).map((n) => n.recipientMembershipId).sort();
  const roleOf = async (type: NotificationType, offerId: string, m: Member) =>
    (
      (await rows(type, offerId)).find((n) => n.recipientMembershipId === m.membershipId)
        ?.payload as { role?: string } | undefined
    )?.role;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    orgId = (await makeOrg(ctx.prisma)).orgId;
    otherOrgId = (await makeOrg(ctx.prisma)).orgId;
    const mk = (accessLevel: 'EMPLOYEE' | 'MANAGER' | 'ADMIN', skills: string[], login = true) =>
      makeMember(ctx, orgId, {
        accessLevel,
        skillNames: skills,
        withLogin: login,
      });
    owner = await mk('EMPLOYEE', ['Bar']);
    e1 = await mk('EMPLOYEE', ['Bar']);
    e2 = await mk('EMPLOYEE', ['Bar']);
    await mk('EMPLOYEE', ['Kitchen']); // ineligible: lacks the required skill
    await mk('EMPLOYEE', ['Bar'], false); // placeholder: no login
    deactivated = await mk('EMPLOYEE', ['Bar']);
    mgr = await mk('MANAGER', ['Kitchen']);
    mgrElig = await mk('MANAGER', ['Bar']);
    admin = await mk('ADMIN', ['Kitchen']);
    await ctx.prisma.membership.update({
      where: { id: deactivated.membershipId },
      data: { status: 'DEACTIVATED' },
    });
    outsider = await makeMember(ctx, otherOrgId, { accessLevel: 'EMPLOYEE' });
    barSkillId = (
      await ctx.prisma.skill.findFirstOrThrow({ where: { organizationId: orgId, name: 'Bar' } })
    ).id;
  });
  afterAll(async () => {
    await app?.close();
  });

  describe('OFFER_CREATED', () => {
    it('give-away: eligible members + managers; owner, ineligible, placeholder, deactivated none', async () => {
      const { offerId, shiftId } = await giveAway();
      expect(await recipients('OFFER_CREATED', offerId)).toEqual(ids(e1, e2, mgrElig, mgr, admin));
      expect(await roleOf('OFFER_CREATED', offerId, e1)).toBe('eligible');
      expect(await roleOf('OFFER_CREATED', offerId, mgr)).toBe('manager');
      // eligible AND manager: one notification, role eligible
      expect(await roleOf('OFFER_CREATED', offerId, mgrElig)).toBe('eligible');
      const row = (await rows('OFFER_CREATED', offerId))[0];
      const s = await ctx.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
      expect(row.payload).toEqual({
        offerId,
        shiftId,
        shiftStartAt: s.startAt.toISOString(),
        shiftEndAt: s.endAt.toISOString(),
        kind: 'GIVE_AWAY',
        role: expect.any(String),
      });
      expect(row.readAt).toBeNull();
    });

    it('open shift: eligible members only (managers only when eligible); actor excluded', async () => {
      const shiftId = await makeShift(null);
      const res = await api(app, mgr.cookie).post(url()).send({ shiftId, kind: 'OPEN_SHIFT' });
      expect(res.status).toBe(201);
      expect(await recipients('OFFER_CREATED', res.body.id)).toEqual(ids(owner, e1, e2, mgrElig));
    });
  });

  describe('ACCEPTANCE_RECEIVED', () => {
    it('managers + owner; actor excluded; repeat while PENDING and reactivation', async () => {
      const { offerId } = await giveAway();
      const a = await api(app, e1.cookie).post(url(`/${offerId}/acceptances`));
      expect(a.status).toBe(201);
      expect(await recipients('ACCEPTANCE_RECEIVED', offerId)).toEqual(
        ids(owner, mgr, mgrElig, admin),
      );
      expect(await roleOf('ACCEPTANCE_RECEIVED', offerId, owner)).toBe('owner');
      expect(await roleOf('ACCEPTANCE_RECEIVED', offerId, mgr)).toBe('manager');

      const again = await api(app, e1.cookie).post(url(`/${offerId}/acceptances`));
      expect(again.status).toBe(200);
      expect(await recipients('ACCEPTANCE_RECEIVED', offerId)).toEqual(
        ids(owner, mgr, mgrElig, admin),
      );

      expect((await api(app, e1.cookie).delete(url(`/${offerId}/acceptances/me`))).status).toBe(
        204,
      );
      expect((await api(app, e1.cookie).post(url(`/${offerId}/acceptances`))).status).toBe(200);
      const all = (await rows('ACCEPTANCE_RECEIVED', offerId)).map((n) => n.recipientMembershipId);
      expect(all.sort()).toEqual(
        [...ids(owner, mgr, mgrElig, admin), ...ids(owner, mgr, mgrElig, admin)].sort(),
      );
    });

    it('a manager accepting does not notify themselves', async () => {
      const { offerId } = await giveAway();
      const a = await api(app, mgrElig.cookie).post(url(`/${offerId}/acceptances`));
      expect(a.status).toBe(201);
      expect(await recipients('ACCEPTANCE_RECEIVED', offerId)).toEqual(ids(owner, mgr, admin));
    });
  });

  describe('OFFER_APPROVED', () => {
    it('selected, owner, non-selected; approving manager gets none', async () => {
      const { offerId, acceptanceIds } = await giveAway([e1, e2]);
      const res = await api(app, mgr.cookie)
        .post(url(`/${offerId}/approve`))
        .send({ acceptanceId: acceptanceIds[0], version: 1 });
      expect(res.status).toBe(200);
      expect(await recipients('OFFER_APPROVED', offerId)).toEqual(ids(owner, e1, e2));
      expect(await roleOf('OFFER_APPROVED', offerId, e1)).toBe('selected');
      expect(await roleOf('OFFER_APPROVED', offerId, owner)).toBe('owner');
      expect(await roleOf('OFFER_APPROVED', offerId, e2)).toBe('notSelected');
    });
  });

  describe('negative and multi-org cases', () => {
    it('failed approve (stale version -> 409) writes no OFFER_APPROVED rows', async () => {
      const { offerId, acceptanceIds } = await giveAway([e1]);
      const res = await api(app, mgr.cookie)
        .post(url(`/${offerId}/approve`))
        .send({ acceptanceId: acceptanceIds[0], version: 99 });
      expect(res.status).toBe(409);
      expect(await recipients('OFFER_APPROVED', offerId)).toEqual([]);
    });

    it('expireDue across two orgs: each org rows carry that org id', async () => {
      const mkOrg = async () => {
        const { orgId: oid } = await makeOrg(ctx.prisma);
        const m = await makeMember(ctx, oid, { accessLevel: 'MANAGER' });
        const shift = await ctx.prisma.shift.create({
          data: { organizationId: oid, assignedMembershipId: null, ...nextSlot() },
        });
        const offer = await ctx.prisma.offer.create({
          data: {
            organizationId: oid,
            shiftId: shift.id,
            kind: 'OPEN_SHIFT',
            createdByMembershipId: m.membershipId,
            expiresAt: new Date(Date.now() - 1000),
          },
        });
        return { oid, m, offerId: offer.id };
      };
      const [x, y] = [await mkOrg(), await mkOrg()];
      await app.get(OffersService).expireDue(new Date());
      for (const o of [x, y]) {
        const n = await ctx.prisma.notification.findMany({
          where: { type: 'OFFER_EXPIRED', payload: { path: ['offerId'], equals: o.offerId } },
        });
        expect(n.map((r) => [r.organizationId, r.recipientMembershipId])).toEqual([
          [o.oid, o.m.membershipId],
        ]);
      }
    });
  });

  describe('lock interplay', () => {
    it('approve notifying a member while that member accepts elsewhere never deadlocks (x5)', async () => {
      const mkE = () => makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', skillNames: ['Bar'] });
      const setups = await Promise.all(
        Array.from({ length: 5 }, async () => {
          const [o, a, b] = [await mkE(), await mkE(), await mkE()];
          // X owned by o, candidates a (to be approved) and b; Y owned by a, b accepts it.
          const shiftX = await makeShift(o.membershipId);
          const shiftY = await makeShift(a.membershipId);
          const mkOffer = async (owner: Member, shiftId: string) =>
            (await api(app, owner.cookie).post(url()).send({ shiftId, kind: 'GIVE_AWAY' })).body
              .id as string;
          const x = await mkOffer(o, shiftX);
          const y = await mkOffer(a, shiftY);
          const accA = await api(app, a.cookie).post(url(`/${x}/acceptances`));
          expect((await api(app, b.cookie).post(url(`/${x}/acceptances`))).status).toBe(201);
          return { a, b, x, y, accId: accA.body.id as string };
        }),
      );
      const results = await Promise.all(
        setups.flatMap((s) => [
          api(app, mgr.cookie)
            .post(url(`/${s.x}/approve`))
            .send({ acceptanceId: s.accId, version: 1 }),
          api(app, s.b.cookie).post(url(`/${s.y}/acceptances`)),
        ]),
      );
      for (const r of results) expect(r.status).toBeLessThan(500);
    });
  });

  describe('OFFER_REJECTED', () => {
    it('owner + PENDING candidates; rejecting manager none', async () => {
      const { offerId } = await giveAway([e1, e2]);
      const res = await api(app, mgr.cookie)
        .post(url(`/${offerId}/reject`))
        .send({ version: 1 });
      expect(res.status).toBe(200);
      expect(await recipients('OFFER_REJECTED', offerId)).toEqual(ids(owner, e1, e2));
      expect(await roleOf('OFFER_REJECTED', offerId, e1)).toBe('candidate');
      expect(await roleOf('OFFER_REJECTED', offerId, owner)).toBe('owner');
    });
  });

  describe('OFFER_EXPIRED', () => {
    it('lazy expiry notifies owner + managers (system actor)', async () => {
      const { offerId } = await giveAway([e1]);
      await ctx.prisma.offer.update({
        where: { id: offerId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await api(app, e2.cookie).post(url(`/${offerId}/acceptances`));
      expect(res.status).toBe(409);
      expect(await recipients('OFFER_EXPIRED', offerId)).toEqual(ids(owner, mgr, mgrElig, admin));
      expect(await roleOf('OFFER_EXPIRED', offerId, owner)).toBe('owner');
      expect(await roleOf('OFFER_EXPIRED', offerId, admin)).toBe('manager');
    });

    it('scheduler sweep notifies owner + managers; open shift has no owner', async () => {
      const { offerId } = await giveAway();
      const shiftId = await makeShift(null);
      const open = await api(app, mgr.cookie).post(url()).send({ shiftId, kind: 'OPEN_SHIFT' });
      await ctx.prisma.offer.updateMany({
        where: { id: { in: [offerId, open.body.id] } },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await app.get(OffersService).expireDue(new Date());
      expect(await recipients('OFFER_EXPIRED', offerId)).toEqual(ids(owner, mgr, mgrElig, admin));
      expect(await recipients('OFFER_EXPIRED', open.body.id)).toEqual(ids(mgr, mgrElig, admin));
    });
  });

  describe('ACCEPTANCE_INVALIDATED', () => {
    it('shift time change invalidates candidates and notifies them (manager actor excluded)', async () => {
      const { offerId, shiftId, acceptanceIds } = await giveAway([e1, e2]);
      const s = await ctx.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
      const res = await api(app, mgr.cookie)
        .patch(`/api/v1/orgs/${orgId}/shifts/${shiftId}`)
        .send({
          version: s.version,
          endAt: new Date(s.endAt.getTime() + 3600_000).toISOString(),
        });
      expect(res.status).toBe(200);
      expect(acceptanceIds.length).toBe(2);
      expect(await recipients('ACCEPTANCE_INVALIDATED', offerId)).toEqual(ids(e1, e2));
      expect(await roleOf('ACCEPTANCE_INVALIDATED', offerId, e1)).toBe('candidate');
    });

    it('failed re-check on approve notifies that candidate', async () => {
      const { offerId, shiftId, acceptanceIds } = await giveAway([e1]);
      const s = await ctx.prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
      await ctx.prisma.unavailability.create({
        data: {
          organizationId: orgId,
          membershipId: e1.membershipId,
          startAt: s.startAt,
          endAt: s.endAt,
        },
      });
      const res = await api(app, mgr.cookie)
        .post(url(`/${offerId}/approve`))
        .send({ acceptanceId: acceptanceIds[0], version: 1 });
      expect(res.status).toBe(422);
      expect(await recipients('ACCEPTANCE_INVALIDATED', offerId)).toEqual(ids(e1));
      expect(await recipients('OFFER_APPROVED', offerId)).toEqual([]);
    });

    it('cancelling does not notify (not a §23 event)', async () => {
      const { offerId } = await giveAway([e1]);
      const before = await ctx.prisma.notification.count({ where: { organizationId: orgId } });
      const res = await api(app, owner.cookie)
        .post(url(`/${offerId}/cancel`))
        .send({ version: 1 });
      expect(res.status).toBe(200);
      expect(await ctx.prisma.notification.count({ where: { organizationId: orgId } })).toBe(
        before,
      );
    });
  });

  describe('OPEN_SHIFT_FILLED', () => {
    it('notifies managers; the claimant (actor) is excluded', async () => {
      const shiftId = await makeShift(null);
      const open = await api(app, mgr.cookie).post(url()).send({ shiftId, kind: 'OPEN_SHIFT' });
      const res = await api(app, e1.cookie).post(url(`/${open.body.id}/claim`));
      expect(res.status).toBe(200);
      expect(await recipients('OPEN_SHIFT_FILLED', open.body.id)).toEqual(ids(mgr, mgrElig, admin));
      expect(await roleOf('OPEN_SHIFT_FILLED', open.body.id, mgr)).toBe('manager');
    });
  });

  describe('endpoints', () => {
    let reader: Member;
    const nUrl = (p = '') => `/api/v1/orgs/${orgId}/notifications${p}`;

    beforeAll(async () => {
      reader = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
      const base = Date.now();
      await ctx.prisma.notification.createMany({
        data: Array.from({ length: 5 }, (_, i) => ({
          organizationId: orgId,
          recipientMembershipId: reader.membershipId,
          type: 'OFFER_CREATED' as const,
          payload: { offerId: `n${i}` },
          createdAt: new Date(base - i * 1000),
        })),
      });
      // someone else's row must never show up
      await ctx.prisma.notification.create({
        data: {
          organizationId: orgId,
          recipientMembershipId: e2.membershipId,
          type: 'OFFER_CREATED',
          payload: { offerId: 'foreign' },
        },
      });
    });

    it('lists own newest first and paginates with an opaque nextCursor', async () => {
      const p1 = await api(app, reader.cookie).get(nUrl('?limit=2'));
      expect(p1.status).toBe(200);
      expect(p1.body.items.map((n: { payload: { offerId: string } }) => n.payload.offerId)).toEqual(
        ['n0', 'n1'],
      );
      expect(typeof p1.body.nextCursor).toBe('string');
      const p2 = await api(app, reader.cookie).get(
        nUrl(`?limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`),
      );
      expect(p2.body.items.map((n: { payload: { offerId: string } }) => n.payload.offerId)).toEqual(
        ['n2', 'n3'],
      );
      const p3 = await api(app, reader.cookie).get(
        nUrl(`?limit=2&cursor=${encodeURIComponent(p2.body.nextCursor)}`),
      );
      expect(p3.body.items.map((n: { payload: { offerId: string } }) => n.payload.offerId)).toEqual(
        ['n4'],
      );
      expect(p3.body.nextCursor).toBeNull();
      expect(Object.keys(p1.body.items[0]).sort()).toEqual([
        'createdAt',
        'id',
        'payload',
        'readAt',
        'type',
      ]);
    });

    it('same-createdAt rows with limit=1 are each returned exactly once', async () => {
      const m = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
      const at = new Date();
      await ctx.prisma.notification.createMany({
        data: ['t0', 't1', 't2'].map((o) => ({
          organizationId: orgId,
          recipientMembershipId: m.membershipId,
          type: 'OFFER_CREATED' as const,
          payload: { offerId: o },
          createdAt: at,
        })),
      });
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 5; i++) {
        const res = await api(app, m.cookie).get(
          nUrl(`?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
        );
        seen.push(
          ...res.body.items.map((n: { payload: { offerId: string } }) => n.payload.offerId),
        );
        cursor = res.body.nextCursor;
        if (!cursor) break;
      }
      expect(seen.sort()).toEqual(['t0', 't1', 't2']);
    });

    it('rejects a bad limit or cursor with 400', async () => {
      expect((await api(app, reader.cookie).get(nUrl('?limit=0'))).status).toBe(400);
      expect((await api(app, reader.cookie).get(nUrl('?limit=51'))).status).toBe(400);
      expect((await api(app, reader.cookie).get(nUrl('?cursor=garbage'))).status).toBe(400);
    });

    it('rejects non-digit limits and repeated params with 400 VALIDATION_FAILED, never 500', async () => {
      const p1 = await api(app, reader.cookie).get(nUrl('?limit=2'));
      const cursor = encodeURIComponent(p1.body.nextCursor);
      for (const q of [
        '?limit=1e1',
        '?limit=2.0',
        '?limit=1&limit=2',
        `?cursor=${cursor}&cursor=${cursor}`,
      ]) {
        const res = await api(app, reader.cookie).get(nUrl(q));
        expect([q, res.status]).toEqual([q, 400]);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('unread-count, read selected ids (scoped), then read all', async () => {
      const count = async () =>
        (await api(app, reader.cookie).get(nUrl('/unread-count'))).body.count as number;
      expect(await count()).toBe(5);

      const list = (await api(app, reader.cookie).get(nUrl('?limit=50'))).body.items as {
        id: string;
      }[];
      const foreign = await ctx.prisma.notification.findFirstOrThrow({
        where: {
          recipientMembershipId: e2.membershipId,
          payload: { path: ['offerId'], equals: 'foreign' },
        },
      });
      const one = await api(app, reader.cookie)
        .post(nUrl('/read'))
        .send({ ids: [list[0].id, foreign.id] });
      expect(one.status).toBe(204);
      expect(await count()).toBe(4);
      expect(
        (await ctx.prisma.notification.findUniqueOrThrow({ where: { id: foreign.id } })).readAt,
      ).toBeNull();

      const all = await api(app, reader.cookie).post(nUrl('/read')).send({});
      expect(all.status).toBe(204);
      expect(await count()).toBe(0);
      const rowsRead = await ctx.prisma.notification.findMany({
        where: { recipientMembershipId: reader.membershipId },
      });
      expect(rowsRead.every((r) => r.readAt !== null)).toBe(true);
    });

    it('rejects non-uuid ids with 400', async () => {
      const res = await api(app, reader.cookie)
        .post(nUrl('/read'))
        .send({ ids: ['x'] });
      expect(res.status).toBe(400);
    });

    it("404 for another org's id", async () => {
      const res = await api(app, outsider.cookie).get(nUrl());
      expect(res.status).toBe(404);
    });
  });
});
