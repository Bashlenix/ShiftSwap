import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DateTime } from 'luxon';
import { EligibilityLoader } from '../src/matching/eligibility-loader';
import { checkEligibility } from '../src/matching/eligibility';
import type { OrgContext } from '../src/tenancy/org-context.decorator';
import { createApp } from '../src/app.factory';
import { createAuth } from '../src/auth/auth';
import { PrismaService } from '../src/prisma/prisma.service';
import type { OfferDetailDto } from '@shiftswap/shared';
import { DEMO_PASSWORD } from '../src/seed/demo-data';
import { seedDemo } from '../src/seed/seed-demo';

const COUNTS = {
  users: 6,
  organizations: 2,
  memberships: 9,
  skills: 4,
  preferences: 14,
  shifts: 10,
  offers: 2,
  acceptances: 2,
  invites: 1,
  notifications: 3,
};

describe('seedDemo', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('seeds the demo data and is idempotent', async () => {
    const auth = createAuth(prisma, process.env);
    expect(await seedDemo(prisma, auth)).toEqual(COUNTS);
    expect(await seedDemo(prisma, auth)).toEqual(COUNTS);

    const lukas = await prisma.user.findUniqueOrThrow({
      where: { email: 'lukas@shiftswap.test' },
      include: { memberships: true },
    });
    expect(lukas.memberships.filter((m) => m.status === 'ACTIVE')).toHaveLength(2);

    const paul = await prisma.membership.findFirstOrThrow({
      where: { displayName: 'Paul Weber' },
    });
    expect(paul.userId).toBeNull();
    expect(paul.email).toBeNull();
    expect(paul.accessLevel).toBe('EMPLOYEE');
  });

  it('resets tables added later that reference memberships (FK RESTRICT)', async () => {
    const auth = createAuth(prisma, process.env);
    await seedDemo(prisma, auth);
    await prisma.$executeRawUnsafe(
      `CREATE TABLE test_reset_notes (
         id serial PRIMARY KEY,
         membership_id text NOT NULL REFERENCES memberships(id) ON DELETE RESTRICT
       )`,
    );
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO test_reset_notes (membership_id) SELECT id FROM memberships LIMIT 1`,
      );
      expect(await seedDemo(prisma, auth)).toEqual(COUNTS);
      const [{ count }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) AS count FROM test_reset_notes`,
      );
      expect(Number(count)).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TABLE test_reset_notes`);
    }
  });

  it('lets a demo user sign in with a mixed-case email', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .set('Origin', 'http://localhost:5173')
      .set('X-Forwarded-For', '10.9.0.1')
      .send({ email: 'Anna@ShiftSwap.test', password: DEMO_PASSWORD })
      .expect(200);
  });

  describe('demo facts', () => {
    const loader = new EligibilityLoader();

    beforeAll(async () => {
      await seedDemo(prisma, createAuth(prisma, process.env));
    });

    async function orgCtx(name: string): Promise<OrgContext> {
      const org = await prisma.organization.findFirstOrThrow({ where: { name } });
      return {
        orgId: org.id,
        membershipId: '',
        accessLevel: 'MANAGER',
        timezone: org.timezone,
        leadTimeMin: org.offerLeadTimeMin,
        policy: {
          timezone: org.timezone,
          defaultWeeklyLimitMin: org.defaultWeeklyLimitMin,
          minRestMin: org.minRestMin,
          maxDailyMin: org.maxDailyMin,
        },
      };
    }

    async function eligibility(shiftStartDayOffset: number, hhmm: string, email: string) {
      const org = await orgCtx('Café Lindenhof');
      const today = DateTime.now().setZone('Europe/Berlin').startOf('day');
      const day = today.plus({ days: shiftStartDayOffset });
      const [h, m] = hhmm.split(':').map(Number);
      const startAt = day.set({ hour: h, minute: m }).toJSDate();
      const shift = await prisma.shift.findFirstOrThrow({
        where: { organizationId: org.orgId, startAt },
        include: { skills: true },
      });
      const member = await prisma.membership.findFirstOrThrow({
        where: { organizationId: org.orgId, email },
      });
      const target = loader.toTargetShift(shift);
      const loaded = await loader.load(prisma, org, target, [member.id]);
      return checkEligibility(loaded.get(member.id)!.ctx, target);
    }

    it('Lukas is blocked from L3 by DAILY_LIMIT; Anna is eligible', async () => {
      const lukas = await eligibility(2, '07:00', 'lukas@shiftswap.test');
      expect(lukas.eligible).toBe(false);
      // MIN_REST also fails (L4 starts 4 h after L3 ends); DAILY_LIMIT is the headline reason.
      expect(lukas.failedRules).toContain('DAILY_LIMIT');
      expect((await eligibility(2, '07:00', 'anna@shiftswap.test')).eligible).toBe(true);
    });

    it('Lukas and Mia are eligible for the give-away shift L5', async () => {
      expect((await eligibility(3, '18:00', 'lukas@shiftswap.test')).eligible).toBe(true);
      expect((await eligibility(3, '18:00', 'mia@shiftswap.test')).eligible).toBe(true);
    });

    it('every seeded shift and offer expiry lies after the seeding time', async () => {
      const now = new Date();
      const shifts = await prisma.shift.findMany();
      expect(shifts).toHaveLength(10);
      for (const s of shifts) expect(s.startAt.getTime()).toBeGreaterThan(now.getTime());
      for (const o of await prisma.offer.findMany()) {
        expect(o.expiresAt.getTime()).toBeGreaterThan(now.getTime());
      }
    });

    it("seeds Jonas Braun's pending invite without sending mail", async () => {
      const invite = await prisma.invite.findFirstOrThrow({
        include: { membership: true, createdBy: true },
      });
      expect(invite.email).toBe('jonas@shiftswap.test');
      expect(invite.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(invite.acceptedAt).toBeNull();
      expect(invite.revokedAt).toBeNull();
      const week = 7 * 24 * 3600_000;
      expect(
        Math.abs(invite.expiresAt.getTime() - (invite.createdAt.getTime() + week)),
      ).toBeLessThan(60_000);
      expect(invite.createdBy.displayName).toBe('Maria Keller');
      expect(invite.membership.displayName).toBe('Jonas Braun');
      expect(invite.membership.accessLevel).toBe('EMPLOYEE');
      expect(invite.membership.userId).toBeNull();
      const skills = await prisma.membershipSkill.findMany({
        where: { membershipId: invite.membershipId },
        include: { skill: true },
      });
      expect(skills.map((s) => s.skill.name)).toEqual(['Service']);
    });

    it('seeds unread notifications for Tom and Anna', async () => {
      const rows = await prisma.notification.findMany({
        include: { recipient: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.every((r) => r.readAt === null)).toBe(true);
      // Marked dispatched, so the email outbox never mails demo rows on start.
      expect(rows.every((r) => r.emailDispatchedAt !== null)).toBe(true);
      const summary = rows.map((r) => [r.recipient.displayName, r.type]).sort();
      expect(summary).toEqual([
        ['Anna Schmidt', 'OFFER_CREATED'],
        ['Tom Becker', 'ACCEPTANCE_RECEIVED'],
        ['Tom Becker', 'ACCEPTANCE_RECEIVED'],
      ]);
      const anna = rows.find((r) => r.recipient.displayName === 'Anna Schmidt')!;
      expect(anna.payload).toMatchObject({ kind: 'OPEN_SHIFT', role: 'eligible' });
      const tom = rows.filter((r) => r.recipient.displayName === 'Tom Becker');
      expect(tom.map((r) => r.payload)).toEqual([
        expect.objectContaining({ role: 'manager' }),
        expect.objectContaining({ role: 'manager' }),
      ]);
    });

    it('ranks the L5 give-away by seeded preferences: Lukas 40, Mia 0', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .set('Origin', 'http://localhost:5173')
        .set('X-Forwarded-For', '10.9.0.2')
        .send({ email: 'tom@shiftswap.test', password: DEMO_PASSWORD })
        .expect(200);
      const cookie = (login.headers['set-cookie'] as unknown as string[])
        .map((c) => c.split(';')[0])
        .join('; ');
      const org = await prisma.organization.findFirstOrThrow({ where: { name: 'Café Lindenhof' } });
      const give = await prisma.offer.findFirstOrThrow({ where: { kind: 'GIVE_AWAY' } });
      const res = await request(app.getHttpServer())
        .get(`/api/v1/orgs/${org.id}/offers/${give.id}`)
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', cookie)
        .expect(200);
      const detail = res.body as OfferDetailDto;
      const pref = (name: string) =>
        detail.acceptances.find((a) => a.displayName === name)!.score!.breakdown.preference;
      expect(pref('Lukas Wolf')).toBe(40);
      expect(pref('Mia Hoffmann')).toBe(0);
    });

    it('offers: give-away by Anna with Lukas first, open shift by Tom', async () => {
      const give = await prisma.offer.findFirstOrThrow({
        where: { kind: 'GIVE_AWAY' },
        include: { acceptances: { include: { membership: true }, orderBy: { createdAt: 'asc' } } },
      });
      expect(give.status).toBe('OPEN');
      expect(give.acceptances.map((a) => [a.membership.displayName, a.status])).toEqual([
        ['Lukas Wolf', 'PENDING'],
        ['Mia Hoffmann', 'PENDING'],
      ]);
      const shift = await prisma.shift.findUniqueOrThrow({ where: { id: give.shiftId } });
      expect(give.expiresAt.getTime()).toBe(shift.startAt.getTime() - 120 * 60_000);
      const open = await prisma.offer.findFirstOrThrow({
        where: { kind: 'OPEN_SHIFT' },
        include: { createdBy: true },
      });
      expect(open.createdBy.displayName).toBe('Tom Becker');
      expect(open.originalOwnerMembershipId).toBeNull();
      const l3 = await prisma.shift.findUniqueOrThrow({ where: { id: open.shiftId } });
      expect(l3.assignedMembershipId).toBeNull();
    });
  });
});
