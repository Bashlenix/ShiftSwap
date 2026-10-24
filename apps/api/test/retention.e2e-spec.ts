import { DateTime } from 'luxon';
import { RetentionService } from '../src/retention/retention.service';
import { createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

describe('retention purge (SDD §27)', () => {
  let ctx: TestCtx;
  let retention: RetentionService;
  // Fixed and in the past: every row other specs leave in the shared DB is newer than the cutoffs,
  // so the global purge only ever touches this file's rows. All fixture timestamps are explicit.
  const now = new Date('2001-06-15T12:00:00.000Z');
  const utc = DateTime.fromJSDate(now, { zone: 'utc' });
  const shiftCutoff = utc.minus({ months: 24 }).toJSDate();
  const notifCutoff = utc.minus({ days: 90 }).toJSDate();
  const unavailCutoff = utc.minus({ days: 30 }).toJSDate();
  const before = (d: Date) => new Date(d.getTime() - 1);

  beforeAll(async () => {
    ctx = await createTestApp();
    retention = ctx.app.get(RetentionService);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  /** One shift with skill row, offer and acceptance, ending at `endAt`. */
  async function seedShift(
    orgId: string,
    owner: string,
    other: string,
    endAt: Date,
    deletedAt: Date | null = null,
  ) {
    const startAt = new Date(endAt.getTime() - 3_600_000);
    const skill = await ctx.prisma.skill.create({
      data: { organizationId: orgId, name: `s-${Math.random()}` },
    });
    const shift = await ctx.prisma.shift.create({
      data: {
        organizationId: orgId,
        startAt,
        endAt,
        assignedMembershipId: owner,
        deletedAt,
        skills: { create: { skillId: skill.id } },
      },
    });
    const offer = await ctx.prisma.offer.create({
      data: {
        organizationId: orgId,
        shiftId: shift.id,
        kind: 'GIVE_AWAY',
        status: 'EXPIRED',
        originalOwnerMembershipId: owner,
        createdByMembershipId: owner,
        expiresAt: startAt,
      },
    });
    await ctx.prisma.acceptance.create({
      data: {
        organizationId: orgId,
        offerId: offer.id,
        membershipId: other,
        status: 'NOT_SELECTED',
      },
    });
    return shift.id;
  }

  it('purges only rows strictly older than the cutoffs, globally, and is idempotent', async () => {
    const orgs = [await makeOrg(ctx.prisma), await makeOrg(ctx.prisma)];
    const keptShifts: string[] = [];
    const goneShifts: string[] = [];
    const keptNotifs: string[] = [];
    const keptUnavail: string[] = [];
    const keptAudit: bigint[] = [];

    for (const { orgId } of orgs) {
      const a = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', withLogin: false });
      const b = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', withLogin: false });
      goneShifts.push(await seedShift(orgId, a.membershipId, b.membershipId, before(shiftCutoff)));
      goneShifts.push(
        await seedShift(orgId, a.membershipId, b.membershipId, before(shiftCutoff), now),
      );
      keptShifts.push(await seedShift(orgId, a.membershipId, b.membershipId, shiftCutoff));

      const audit = (createdAt: Date) =>
        ctx.prisma.auditLog.create({
          data: {
            organizationId: orgId,
            actorMembershipId: a.membershipId,
            action: 'x',
            entityType: 'Shift',
            entityId: 'e',
            createdAt,
          },
        });
      await audit(before(shiftCutoff));
      keptAudit.push((await audit(shiftCutoff)).id);

      const notif = (createdAt: Date) =>
        ctx.prisma.notification.create({
          data: {
            organizationId: orgId,
            recipientMembershipId: a.membershipId,
            type: 'OFFER_CREATED',
            payload: {},
            createdAt,
            emailDispatchedAt: null,
          },
        });
      await notif(before(notifCutoff));
      keptNotifs.push((await notif(notifCutoff)).id);

      const unavail = (endAt: Date) =>
        ctx.prisma.unavailability.create({
          data: {
            organizationId: orgId,
            membershipId: a.membershipId,
            startAt: new Date(endAt.getTime() - 3_600_000),
            endAt,
          },
        });
      await unavail(before(unavailCutoff));
      keptUnavail.push((await unavail(unavailCutoff)).id);
    }

    const counts = await retention.purge(now);
    expect(counts).toEqual({
      shifts: 4,
      offers: 4,
      acceptances: 4,
      auditLogs: 2,
      notifications: 2,
      unavailabilities: 2,
    });

    expect(await ctx.prisma.shift.count({ where: { id: { in: goneShifts } } })).toBe(0);
    expect(await ctx.prisma.shift.count({ where: { id: { in: keptShifts } } })).toBe(2);
    expect(await ctx.prisma.offer.count({ where: { shiftId: { in: keptShifts } } })).toBe(2);
    expect(
      await ctx.prisma.acceptance.count({ where: { offer: { shiftId: { in: keptShifts } } } }),
    ).toBe(2);
    expect(await ctx.prisma.shiftSkill.count({ where: { shiftId: { in: goneShifts } } })).toBe(0);
    expect(await ctx.prisma.shiftSkill.count({ where: { shiftId: { in: keptShifts } } })).toBe(2);
    expect(await ctx.prisma.auditLog.count({ where: { id: { in: keptAudit } } })).toBe(2);
    expect(await ctx.prisma.notification.count({ where: { id: { in: keptNotifs } } })).toBe(2);
    expect(await ctx.prisma.unavailability.count({ where: { id: { in: keptUnavail } } })).toBe(2);

    expect(await retention.purge(now)).toEqual({
      shifts: 0,
      offers: 0,
      acceptances: 0,
      auditLogs: 0,
      notifications: 0,
      unavailabilities: 0,
    });
  });

  it('keeps purging the other categories when the shift category fails', async () => {
    const { orgId } = await makeOrg(ctx.prisma);
    const m = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', withLogin: false });
    const audit = await ctx.prisma.auditLog.create({
      data: {
        organizationId: orgId,
        actorMembershipId: m.membershipId,
        action: 'x',
        entityType: 'Shift',
        entityId: 'e',
        createdAt: before(shiftCutoff),
      },
    });
    const notif = await ctx.prisma.notification.create({
      data: {
        organizationId: orgId,
        recipientMembershipId: m.membershipId,
        type: 'OFFER_CREATED',
        payload: {},
        createdAt: before(notifCutoff),
      },
    });
    const unavail = await ctx.prisma.unavailability.create({
      data: {
        organizationId: orgId,
        membershipId: m.membershipId,
        startAt: new Date(before(unavailCutoff).getTime() - 3_600_000),
        endAt: before(unavailCutoff),
      },
    });

    const other = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', withLogin: false });
    await seedShift(orgId, m.membershipId, other.membershipId, before(shiftCutoff));
    const spy = jest
      .spyOn(ctx.prisma, '$transaction')
      .mockRejectedValueOnce(new TypeError('boom') as never);
    await expect(retention.purge(now)).rejects.toBeInstanceOf(AggregateError);
    spy.mockRestore();

    expect(await ctx.prisma.auditLog.count({ where: { id: audit.id } })).toBe(0);
    expect(await ctx.prisma.notification.count({ where: { id: notif.id } })).toBe(0);
    expect(await ctx.prisma.unavailability.count({ where: { id: unavail.id } })).toBe(0);
  });
});
