import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import type { OrgContext } from '../tenancy/org-context.decorator';
import { durationMin, weekWindow } from './time';
import type { EligibilityContext, TargetShift } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const SWAP_HISTORY_MS = 30 * DAY_MS;

export interface LoadedCandidate {
  ctx: EligibilityContext;
  swapsLast30Days: number;
  weeklyMinutes: number;
}

interface MemberRow {
  id: string;
  userId: string | null;
  status: 'ACTIVE' | 'DEACTIVATED';
  weeklyLimitMin: number | null;
  skillIds: string[];
}

type Db = PrismaClient | Prisma.TransactionClient;

interface ShiftLike {
  id: string;
  startAt: Date;
  endAt: Date;
  assignedMembershipId: string | null;
  skills: { skillId: string }[];
}

@Injectable()
export class EligibilityLoader {
  static toTargetShift(row: ShiftLike): TargetShift {
    return {
      id: row.id,
      startAt: row.startAt,
      endAt: row.endAt,
      requiredSkillIds: row.skills.map((s) => s.skillId),
      assignedMembershipId: row.assignedMembershipId,
    };
  }

  toTargetShift(row: ShiftLike): TargetShift {
    return EligibilityLoader.toTargetShift(row);
  }

  /**
   * Everything checkEligibility and ranking need, for many members, in exactly 4 queries.
   * Omitted `membershipIds` = all ACTIVE memberships of the org.
   */
  async load(
    db: Db,
    org: OrgContext,
    shift: TargetShift,
    membershipIds?: string[],
  ): Promise<Map<string, LoadedCandidate>> {
    const week = weekWindow(shift.startAt, org.timezone);
    const from = new Date(week.startAt.getTime() - DAY_MS);
    const to = new Date(week.endAt.getTime() + DAY_MS);
    const since = new Date(Date.now() - SWAP_HISTORY_MS);
    // One raw query: Prisma's include would add a second query for skills (the join strategy
    // needs a schema preview feature), and the "4 queries" budget is part of the contract.
    const scope = membershipIds
      ? Prisma.sql`m.id = ANY(${membershipIds})`
      : Prisma.sql`m.status = 'ACTIVE'`;
    const members = await db.$queryRaw<MemberRow[]>(Prisma.sql`
      SELECT m.id, m.user_id AS "userId", m.status::text AS status,
             m.weekly_limit_min AS "weeklyLimitMin",
             COALESCE(array_agg(ms.skill_id) FILTER (WHERE ms.skill_id IS NOT NULL), '{}') AS "skillIds"
      FROM memberships m
      LEFT JOIN membership_skills ms ON ms.membership_id = m.id
      WHERE m.organization_id = ${org.orgId} AND ${scope}
      GROUP BY m.id`);
    const ids = members.map((m) => m.id);

    const [shifts, unavailability, swaps] = await Promise.all([
      db.shift.findMany({
        where: {
          organizationId: org.orgId,
          deletedAt: null,
          assignedMembershipId: { in: ids },
          startAt: { lt: to },
          endAt: { gt: from },
        },
        select: { id: true, startAt: true, endAt: true, assignedMembershipId: true },
      }),
      db.unavailability.findMany({
        where: {
          organizationId: org.orgId,
          membershipId: { in: ids },
          startAt: { lt: to },
          endAt: { gt: from },
        },
        select: { membershipId: true, startAt: true, endAt: true },
      }),
      db.acceptance.groupBy({
        by: ['membershipId'],
        where: {
          organizationId: org.orgId,
          membershipId: { in: ids },
          status: 'SELECTED',
          updatedAt: { gte: since },
        },
        _count: { _all: true },
      }),
    ]);

    const shiftsBy = new Map<string, { id: string; startAt: Date; endAt: Date }[]>();
    for (const s of shifts) {
      const list = shiftsBy.get(s.assignedMembershipId!) ?? [];
      list.push({ id: s.id, startAt: s.startAt, endAt: s.endAt });
      shiftsBy.set(s.assignedMembershipId!, list);
    }
    const unavBy = new Map<string, { startAt: Date; endAt: Date }[]>();
    for (const u of unavailability) {
      const list = unavBy.get(u.membershipId) ?? [];
      list.push({ startAt: u.startAt, endAt: u.endAt });
      unavBy.set(u.membershipId, list);
    }
    const swapsBy = new Map(swaps.map((r) => [r.membershipId, r._count._all]));

    const result = new Map<string, LoadedCandidate>();
    for (const m of members) {
      const candidateShifts = shiftsBy.get(m.id) ?? [];
      const weeklyMinutes = candidateShifts
        .filter((s) => s.id !== shift.id && s.startAt >= week.startAt && s.startAt < week.endAt)
        .reduce((sum, s) => sum + durationMin(s), 0);
      result.set(m.id, {
        ctx: {
          org: org.policy,
          candidate: {
            id: m.id,
            status: m.status,
            hasLogin: m.userId !== null,
            skillIds: m.skillIds,
            weeklyLimitMin: m.weeklyLimitMin,
          },
          candidateShifts,
          unavailability: unavBy.get(m.id) ?? [],
        },
        swapsLast30Days: swapsBy.get(m.id) ?? 0,
        weeklyMinutes,
      });
    }
    return result;
  }
}
