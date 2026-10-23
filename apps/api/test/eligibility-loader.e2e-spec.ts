import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { checkEligibility } from '../src/matching/eligibility';
import { EligibilityLoader } from '../src/matching/eligibility-loader';
import type { OrgContext } from '../src/tenancy/org-context.decorator';
import { createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

const H = 60 * 60 * 1000;
const DAY = 24 * H;

function median(xs: number[]): number {
  return [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
}

describe('EligibilityLoader', () => {
  let ctx: TestCtx;
  let counting: PrismaClient;
  const queries: string[] = [];
  let org: OrgContext;
  let orgId: string;
  let owner: { membershipId: string };
  let placeholderId: string;
  let targetId: string;
  // Monday 2030-01-07 10:00 UTC in a quiet week.
  const monday = new Date('2030-01-07T08:00:00Z');

  const loader = new EligibilityLoader();
  const target = () => ({
    id: targetId,
    startAt: monday,
    endAt: new Date(monday.getTime() + 8 * H),
    requiredSkillIds: [],
    assignedMembershipId: owner.membershipId,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    orgId = (await makeOrg(ctx.prisma)).orgId;
    const row = await ctx.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    org = {
      orgId,
      membershipId: 'x',
      accessLevel: 'MANAGER',
      timezone: row.timezone,
      leadTimeMin: row.offerLeadTimeMin,
      policy: {
        timezone: row.timezone,
        defaultWeeklyLimitMin: row.defaultWeeklyLimitMin,
        minRestMin: row.minRestMin,
        maxDailyMin: row.maxDailyMin,
      },
    };
    owner = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
    const placeholder = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE', withLogin: false });
    placeholderId = placeholder.membershipId;
    await ctx.prisma.membership.createMany({
      data: Array.from({ length: 28 }, (_, i) => ({
        organizationId: orgId,
        displayName: `Bulk ${i}`,
        accessLevel: 'EMPLOYEE' as const,
      })),
    });
    const t = await ctx.prisma.shift.create({
      data: {
        organizationId: orgId,
        startAt: monday,
        endAt: new Date(monday.getTime() + 8 * H),
        assignedMembershipId: owner.membershipId,
      },
    });
    targetId = t.id;

    counting = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
      log: [{ emit: 'event', level: 'query' }],
    });
    // Prisma 7 + driver adapter still emits 'query' events; the generic log typing resolves to never.
    (counting as unknown as { $on(ev: 'query', cb: (e: { query: string }) => void): void }).$on(
      'query',
      (e) => queries.push(e.query),
    );
  });
  afterAll(async () => {
    await counting?.$disconnect();
    await ctx?.app.close();
  });

  it('30 members: at most 4 queries, under 200 ms (median of 5 after warm-up)', async () => {
    await loader.load(counting, org, target());
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      queries.length = 0;
      const t0 = performance.now();
      const map = await loader.load(counting, org, target());
      times.push(performance.now() - t0);
      expect(map.size).toBe(30);
      expect(queries.length).toBeGreaterThan(0);
      expect(queries.length).toBeLessThanOrEqual(4);
    }
    expect(median(times)).toBeLessThan(200);
  });

  it('works inside an interactive transaction', async () => {
    const map = await ctx.prisma.$transaction((tx) =>
      loader.load(tx, org, target(), [owner.membershipId]),
    );
    expect([...map.keys()]).toEqual([owner.membershipId]);
  });

  it('placeholder (no login) fails NOT_ACTIVE via checkEligibility', async () => {
    const map = await loader.load(ctx.prisma, org, target(), [placeholderId]);
    const entry = map.get(placeholderId)!;
    expect(checkEligibility(entry.ctx, target()).failedRules).toContain('NOT_ACTIVE');
  });

  it('weekly minutes: same-week shifts count, target excluded, other weeks ignored, deleted ignored', async () => {
    const m = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
    const mk = (start: Date, hours: number, deletedAt: Date | null = null) =>
      ctx.prisma.shift.create({
        data: {
          organizationId: orgId,
          startAt: start,
          endAt: new Date(start.getTime() + hours * H),
          assignedMembershipId: m.membershipId,
          deletedAt,
        },
      });
    await mk(new Date(monday.getTime() + 2 * DAY), 4); // Wed, counts
    await mk(new Date(monday.getTime() + 14 * DAY), 8); // two weeks away
    await mk(new Date(monday.getTime() + 3 * DAY), 6, new Date()); // deleted
    const map = await loader.load(ctx.prisma, org, target(), [m.membershipId]);
    const e = map.get(m.membershipId)!;
    expect(e.weeklyMinutes).toBe(240);
    expect(e.ctx.candidateShifts).toHaveLength(1);
  });

  it('counts SELECTED acceptances from the last 30 days only', async () => {
    const m = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
    const sh = await ctx.prisma.shift.create({
      data: {
        organizationId: orgId,
        startAt: new Date(monday.getTime() + 30 * DAY),
        endAt: new Date(monday.getTime() + 31 * DAY),
      },
    });
    const offer = await ctx.prisma.offer.create({
      data: {
        organizationId: orgId,
        shiftId: sh.id,
        kind: 'GIVE_AWAY',
        createdByMembershipId: owner.membershipId,
        expiresAt: new Date(),
      },
    });
    await ctx.prisma.acceptance.create({
      data: {
        organizationId: orgId,
        offerId: offer.id,
        membershipId: m.membershipId,
        status: 'SELECTED',
      },
    });
    const map = await loader.load(ctx.prisma, org, target(), [m.membershipId]);
    expect(map.get(m.membershipId)!.swapsLast30Days).toBe(1);
  });

  describe('review fixes', () => {
    const newOffer = async (orgForOffer: string, creatorId: string, startOffsetDays: number) => {
      const start = new Date(monday.getTime() + startOffsetDays * DAY);
      const sh = await ctx.prisma.shift.create({
        data: {
          organizationId: orgForOffer,
          startAt: start,
          endAt: new Date(start.getTime() + H),
        },
      });
      return ctx.prisma.offer.create({
        data: {
          organizationId: orgForOffer,
          shiftId: sh.id,
          kind: 'GIVE_AWAY',
          createdByMembershipId: creatorId,
          expiresAt: new Date(),
        },
      });
    };

    it('maps skills exactly: two skills, none (empty array, not [null])', async () => {
      const withSkills = await makeMember(ctx, orgId, {
        accessLevel: 'EMPLOYEE',
        skillNames: ['sk-a', 'sk-b'],
      });
      const without = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
      const skills = await ctx.prisma.skill.findMany({
        where: { organizationId: orgId, name: { in: ['sk-a', 'sk-b'] } },
      });
      const skillA = skills.find((x) => x.name === 'sk-a')!;
      const map = await loader.load(ctx.prisma, org, target(), [
        withSkills.membershipId,
        without.membershipId,
      ]);
      const a = map.get(withSkills.membershipId)!;
      const b = map.get(without.membershipId)!;
      expect([...a.ctx.candidate.skillIds].sort()).toEqual(skills.map((x) => x.id).sort());
      expect(b.ctx.candidate.skillIds).toEqual([]);

      const needsA = { ...target(), requiredSkillIds: [skillA.id] };
      expect(checkEligibility(a.ctx, needsA).failedRules).toEqual([]);
      expect(checkEligibility(b.ctx, needsA).failedRules).toEqual(['MISSING_SKILL']);
    });

    it('swap count: only recent SELECTED rows of this org', async () => {
      const m = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
      const otherOrgId = (await makeOrg(ctx.prisma)).orgId;
      const foreign = await makeMember(ctx, otherOrgId, { accessLevel: 'EMPLOYEE' });
      const mkAcc = async (
        orgForRow: string,
        memberId: string,
        status: 'SELECTED' | 'PENDING',
        offerOffset: number,
      ) => {
        const offer = await newOffer(orgForRow, memberId, offerOffset);
        return ctx.prisma.acceptance.create({
          data: { organizationId: orgForRow, offerId: offer.id, membershipId: memberId, status },
        });
      };
      await mkAcc(orgId, m.membershipId, 'SELECTED', 40); // recent, counts
      const old = await mkAcc(orgId, m.membershipId, 'SELECTED', 41);
      await ctx.prisma
        .$executeRaw`UPDATE acceptances SET updated_at = now() - interval '31 days' WHERE id = ${old.id}`;
      await mkAcc(orgId, m.membershipId, 'PENDING', 42);
      await mkAcc(otherOrgId, foreign.membershipId, 'SELECTED', 43);

      const map = await loader.load(ctx.prisma, org, target(), [m.membershipId]);
      expect(map.get(m.membershipId)!.swapsLast30Days).toBe(1);
    });

    it('foreign-org id and empty id list return empty maps', async () => {
      const otherOrgId = (await makeOrg(ctx.prisma)).orgId;
      const foreign = await makeMember(ctx, otherOrgId, { accessLevel: 'EMPLOYEE' });
      expect((await loader.load(ctx.prisma, org, target(), [foreign.membershipId])).size).toBe(0);
      expect((await loader.load(ctx.prisma, org, target(), [])).size).toBe(0);
    });

    it('neighbouring-week shift is in candidateShifts but not in weeklyMinutes', async () => {
      const m = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
      const start = new Date('2030-01-06T18:00:00Z'); // Sunday evening Berlin, previous week
      await ctx.prisma.shift.create({
        data: {
          organizationId: orgId,
          startAt: start,
          endAt: new Date(start.getTime() + 2 * H),
          assignedMembershipId: m.membershipId,
        },
      });
      const e = (await loader.load(ctx.prisma, org, target(), [m.membershipId])).get(
        m.membershipId,
      )!;
      expect(e.ctx.candidateShifts).toHaveLength(1);
      expect(e.weeklyMinutes).toBe(0);
    });
  });
});
