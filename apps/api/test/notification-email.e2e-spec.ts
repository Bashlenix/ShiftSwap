import type { INestApplication } from '@nestjs/common';
import {
  EMAIL_NOTIFICATION_TYPES,
  notificationText,
  type NotificationPayload,
  type NotificationType,
} from '@shiftswap/shared';
import { DateTime } from 'luxon';
import { MailService } from '../src/mail/mail.service';
import { NotificationMailer } from '../src/notifications/notification-mailer';
import { createApp } from '../src/app.factory';
import { OffersService } from '../src/offers/offers.service';
import {
  api,
  createTestApp,
  TEST_ORIGIN,
  makeMember,
  makeOrg,
  type TestCtx,
} from './helpers/test-app';

type Member = { membershipId: string; userId?: string; cookie?: string };

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

describe('notification emails (outbox dispatch, SDD §23)', () => {
  let ctx: TestCtx;
  let app: INestApplication;
  let mailer: NotificationMailer;
  let mail: MailService;
  let orgId: string;
  let orgName: string;
  let owner: Member;
  let e1: Member;
  let e2: Member;
  let mgr: Member;
  let barSkillId: string;

  const url = (p = '') => `/api/v1/orgs/${orgId}/offers${p}`;
  const emailOf = async (m: Member) =>
    (await ctx.prisma.user.findUniqueOrThrow({ where: { id: m.userId! } })).email;
  const subjectOf = (type: NotificationType, payload: NotificationPayload) =>
    `${orgName}: ${notificationText({ type, payload }, TZ).replace(/\.$/, '')}`;
  const pending = () => ctx.prisma.notification.findMany({ where: { emailDispatchedAt: null } });

  /** Empties the outbox (rows left by other spec files) and the captured mails. */
  const drain = async () => {
    // Loop on rows, not on the return value: a batch of skipped recipients returns 0.
    while ((await pending()).length > 0) await mailer.dispatchPending(1000);
    mail.sent.length = 0;
  };

  const makeShift = async (assignee: string | null) =>
    (
      await ctx.prisma.shift.create({
        data: {
          organizationId: orgId,
          assignedMembershipId: assignee,
          ...nextSlot(),
          skills: { create: [{ skillId: barSkillId }] },
        },
      })
    ).id;

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
    return { offerId, acceptanceIds };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    mailer = app.get(NotificationMailer);
    mail = app.get(MailService);
    orgId = (await makeOrg(ctx.prisma, { timezone: TZ })).orgId;
    orgName = (await ctx.prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).name;
    const mk = (accessLevel: 'EMPLOYEE' | 'MANAGER', skills: string[]) =>
      makeMember(ctx, orgId, { accessLevel, skillNames: skills });
    owner = await mk('EMPLOYEE', ['Bar']);
    e1 = await mk('EMPLOYEE', ['Bar']);
    e2 = await mk('EMPLOYEE', ['Bar']);
    mgr = await mk('MANAGER', ['Kitchen']);
    barSkillId = (
      await ctx.prisma.skill.findFirstOrThrow({ where: { organizationId: orgId, name: 'Bar' } })
    ).id;
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(drain);

  it('give-away flow: one email per committed email-type row; approval reaches all three', async () => {
    const { offerId, acceptanceIds } = await giveAway([e1, e2]);
    const res = await api(app, mgr.cookie)
      .post(url(`/${offerId}/approve`))
      .send({ acceptanceId: acceptanceIds[0], version: 1 });
    expect(res.status).toBe(200);

    const rows = await pending();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => EMAIL_NOTIFICATION_TYPES.includes(r.type))).toBe(true);

    const sent = await mailer.dispatchPending();
    expect(sent).toBe(rows.length);
    expect(mail.sent).toHaveLength(rows.length);

    const approved = rows.filter((r) => r.type === 'OFFER_APPROVED');
    expect(approved).toHaveLength(3);
    for (const m of [e1, owner, e2]) {
      const row = approved.find((r) => r.recipientMembershipId === m.membershipId)!;
      const subject = subjectOf('OFFER_APPROVED', row.payload as NotificationPayload);
      const to = await emailOf(m);
      expect(mail.sent.filter((s) => s.to === to && s.subject === subject)).toHaveLength(1);
    }
    expect(await pending()).toEqual([]);
    expect(await mailer.dispatchPending()).toBe(0);
  });

  it('MEMBER_DEACTIVATED rows are created dispatched and never emailed', async () => {
    const admin = await makeMember(ctx, orgId, { accessLevel: 'ADMIN' });
    const target = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
    const res = await api(app, admin.cookie).post(
      `/api/v1/orgs/${orgId}/members/${target.membershipId}/deactivate`,
    );
    expect(res.status).toBe(200);
    const rows = await ctx.prisma.notification.findMany({
      where: { organizationId: orgId, type: 'MEMBER_DEACTIVATED' },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.emailDispatchedAt !== null)).toBe(true);

    await mailer.dispatchPending();
    const subject = subjectOf('MEMBER_DEACTIVATED', {});
    expect(mail.sent.filter((s) => s.subject === subject)).toEqual([]);
  });

  it('recipient deactivated or deleted before dispatch: no email, row still marked dispatched', async () => {
    const gone = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', skillNames: ['Bar'] });
    const deleted = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', skillNames: ['Bar'] });
    const { offerId } = await giveAway();
    const [goneEmail, deletedEmail] = [await emailOf(gone), await emailOf(deleted)];
    await ctx.prisma.membership.update({
      where: { id: gone.membershipId },
      data: { status: 'DEACTIVATED' },
    });
    await ctx.prisma.user.update({
      where: { id: deleted.userId! },
      data: { deletedAt: new Date() },
    });

    const rows = await pending();
    const skipped = rows.filter((r) =>
      [gone.membershipId, deleted.membershipId].includes(r.recipientMembershipId),
    );
    expect(skipped).toHaveLength(2);
    expect(skipped.every((r) => (r.payload as { offerId?: string }).offerId === offerId)).toBe(
      true,
    );

    const sent = await mailer.dispatchPending();
    expect(sent).toBe(rows.length - 2);
    expect(mail.sent.map((s) => s.to)).not.toContain(goneEmail);
    expect(mail.sent.map((s) => s.to)).not.toContain(deletedEmail);
    const after = await ctx.prisma.notification.findMany({
      where: { id: { in: skipped.map((r) => r.id) } },
    });
    expect(after.every((r) => r.emailDispatchedAt !== null)).toBe(true);

    // Reactivating does not resurrect the skipped rows.
    await ctx.prisma.membership.update({
      where: { id: gone.membershipId },
      data: { status: 'ACTIVE' },
    });
    expect(await mailer.dispatchPending()).toBe(0);
    // Keep both out of later give-aways (exact counts below).
    await ctx.prisma.membership.updateMany({
      where: { id: { in: [gone.membershipId, deleted.membershipId] } },
      data: { status: 'DEACTIVATED' },
    });
  });

  it('concurrent dispatchers send each pending email exactly once', async () => {
    // One acceptance per offer: every (recipient, subject) pair is then unique by construction.
    const seed = async () => {
      await giveAway([e1]);
      await giveAway([e2]);
      await giveAway([e1]);
      const count = (await pending()).length;
      expect(count).toBeGreaterThan(1);
      return count;
    };
    const assertOnce = (count: number) => {
      expect(mail.sent).toHaveLength(count);
      const pairs = mail.sent.map((s) => `${s.to}|${s.subject}`);
      expect(new Set(pairs).size).toBe(pairs.length);
    };

    const count = await seed();
    const [a, b] = await Promise.all([mailer.dispatchPending(), mailer.dispatchPending()]);
    expect(a + b).toBe(count);
    assertOnce(count);
    expect(await pending()).toEqual([]);

    // Small batches so both dispatchers really interleave on the same pending rows.
    mail.sent.length = 0;
    const again = await seed();
    let total = 0;
    for (;;) {
      const [x, y] = await Promise.all([mailer.dispatchPending(2), mailer.dispatchPending(2)]);
      if (x + y === 0) break;
      total += x + y;
    }
    expect(total).toBe(again);
    assertOnce(again);
  });

  it('rows written by expireDue are emailed', async () => {
    const { offerId } = await giveAway();
    await drain();
    await ctx.prisma.offer.update({
      where: { id: offerId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await app.get(OffersService).expireDue(new Date());

    const rows = (await pending()).filter((r) => r.type === 'OFFER_EXPIRED');
    expect(rows.length).toBeGreaterThan(0);
    await mailer.dispatchPending();
    for (const row of rows) {
      const recipient = await ctx.prisma.membership.findUniqueOrThrow({
        where: { id: row.recipientMembershipId },
        include: { user: true },
      });
      const subject = subjectOf('OFFER_EXPIRED', row.payload as NotificationPayload);
      expect(mail.sent).toContainEqual(
        expect.objectContaining({ to: recipient.user!.email, subject }),
      );
      expect(mail.sent.find((s) => s.subject === subject)?.text).toContain(`/orgs/${orgId}/`);
    }
  });
  it('outside NODE_ENV=test a successful write dispatches, linking to the x-app-origin', async () => {
    const live = await createApp({ env: { ...process.env, NODE_ENV: 'development' } });
    await live.init();
    try {
      const liveMail = live.get(MailService);
      const shiftId = await makeShift(owner.membershipId);
      const res = await api(live, owner.cookie)
        .post(url())
        .set('x-app-origin', TEST_ORIGIN)
        .send({ shiftId, kind: 'GIVE_AWAY' });
      expect(res.status).toBe(201);
      const deadline = Date.now() + 5000;
      while ((await pending()).length > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(await pending()).toEqual([]);
      const to = await emailOf(e1);
      const sent = liveMail.sent.find((s) => s.to === to);
      expect(sent?.text).toContain(`${TEST_ORIGIN}/orgs/${orgId}/offers`);
    } finally {
      await live.close();
    }
  });
});
