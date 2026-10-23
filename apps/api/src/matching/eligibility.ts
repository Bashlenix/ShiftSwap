import type { RuleCode } from '@shiftswap/shared';
import { durationMin, localDateKey, overlaps, weekWindow } from './time';
import type { EligibilityContext, EligibilityResult, TargetShift } from './types';

const MIN_MS = 60_000;

export function checkEligibility(ctx: EligibilityContext, shift: TargetShift): EligibilityResult {
  const { org, candidate } = ctx;
  const tz = org.timezone;
  const others = ctx.candidateShifts.filter((s) => s.id !== shift.id);
  const failed = new Set<RuleCode>();

  if (candidate.status !== 'ACTIVE' || !candidate.hasLogin) failed.add('NOT_ACTIVE');
  if (shift.assignedMembershipId === candidate.id) failed.add('IS_OWNER');
  if (shift.requiredSkillIds.some((id) => !candidate.skillIds.includes(id))) {
    failed.add('MISSING_SKILL');
  }
  if (others.some((s) => overlaps(s, shift))) failed.add('OVERLAP');
  if (ctx.unavailability.some((u) => overlaps(u, shift))) failed.add('UNAVAILABLE');

  const restMs = org.minRestMin * MIN_MS;
  const restBroken = others.some((s) => {
    if (overlaps(s, shift)) return false; // reported as OVERLAP only
    if (s.endAt <= shift.startAt) return shift.startAt.getTime() - s.endAt.getTime() < restMs;
    return s.startAt.getTime() - shift.endAt.getTime() < restMs;
  });
  if (restBroken) failed.add('MIN_REST');

  // Overnight shifts count toward the day/week in which they start.
  const dayKey = localDateKey(shift.startAt, tz);
  const dailyMin =
    durationMin(shift) +
    others
      .filter((s) => localDateKey(s.startAt, tz) === dayKey)
      .reduce((sum, s) => sum + durationMin(s), 0);
  if (dailyMin > org.maxDailyMin) failed.add('DAILY_LIMIT');

  const week = weekWindow(shift.startAt, tz);
  const weeklyMin =
    durationMin(shift) +
    others
      .filter((s) => s.startAt >= week.startAt && s.startAt < week.endAt)
      .reduce((sum, s) => sum + durationMin(s), 0);
  const weeklyLimit = candidate.weeklyLimitMin ?? org.defaultWeeklyLimitMin;
  if (weeklyMin > weeklyLimit) failed.add('WEEKLY_LIMIT');

  const order: RuleCode[] = [
    'NOT_ACTIVE', 'IS_OWNER', 'MISSING_SKILL', 'OVERLAP',
    'UNAVAILABLE', 'MIN_REST', 'DAILY_LIMIT', 'WEEKLY_LIMIT',
  ];
  const failedRules = order.filter((r) => failed.has(r));
  return { eligible: failedRules.length === 0, failedRules };
}
