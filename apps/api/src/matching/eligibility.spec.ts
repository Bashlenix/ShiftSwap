import { DateTime } from 'luxon';
import { checkEligibility } from './eligibility';
import type { Candidate, EligibilityContext, OrgPolicy, ScheduledShift, TargetShift } from './types';

const TZ = 'Europe/Berlin';
const at = (s: string) => DateTime.fromISO(s, { zone: TZ }).toJSDate();
const sh = (id: string, a: string, b: string): ScheduledShift => ({ id, startAt: at(a), endAt: at(b) });

const org: OrgPolicy = { timezone: TZ, defaultWeeklyLimitMin: 2400, minRestMin: 660, maxDailyMin: 600 };
const candidate: Candidate = { id: 'm1', status: 'ACTIVE', hasLogin: true, skillIds: ['S'], weeklyLimitMin: null };
const target: TargetShift = {
  id: 't', startAt: at('2026-11-06T18:00'), endAt: at('2026-11-06T23:00'),
  requiredSkillIds: ['S'], assignedMembershipId: 'other',
};
const ctx = (over: Partial<EligibilityContext> = {}): EligibilityContext => ({
  org, candidate, candidateShifts: [], unavailability: [], ...over,
});

describe('checkEligibility', () => {
  it('passes the base case', () => {
    expect(checkEligibility(ctx(), target)).toEqual({ eligible: true, failedRules: [] });
  });

  it('NOT_ACTIVE when deactivated', () => {
    expect(checkEligibility(ctx({ candidate: { ...candidate, status: 'DEACTIVATED' } }), target).failedRules).toEqual(['NOT_ACTIVE']);
  });

  it('NOT_ACTIVE without login', () => {
    expect(checkEligibility(ctx({ candidate: { ...candidate, hasLogin: false } }), target).failedRules).toEqual(['NOT_ACTIVE']);
  });

  it('IS_OWNER', () => {
    expect(checkEligibility(ctx(), { ...target, assignedMembershipId: 'm1' }).failedRules).toEqual(['IS_OWNER']);
  });

  it('MISSING_SKILL', () => {
    expect(checkEligibility(ctx({ candidate: { ...candidate, skillIds: [] } }), target).failedRules).toEqual(['MISSING_SKILL']);
  });

  it('OVERLAP', () => {
    const r = checkEligibility(ctx({ candidateShifts: [sh('x', '2026-11-06T20:00', '2026-11-06T22:00')] }), target);
    expect(r.failedRules).toEqual(['OVERLAP']);
  });

  it('UNAVAILABLE', () => {
    const r = checkEligibility(ctx({ unavailability: [{ startAt: at('2026-11-06T17:00'), endAt: at('2026-11-06T19:00') }] }), target);
    expect(r.failedRules).toEqual(['UNAVAILABLE']);
  });

  it('MIN_REST after an earlier shift', () => {
    const r = checkEligibility(ctx({ candidateShifts: [sh('x', '2026-11-06T04:00', '2026-11-06T08:00')] }), target);
    expect(r.failedRules).toEqual(['MIN_REST']);
  });

  it('MIN_REST before a later shift', () => {
    const r = checkEligibility(ctx({ candidateShifts: [sh('x', '2026-11-07T09:00', '2026-11-07T12:00')] }), target);
    expect(r.failedRules).toEqual(['MIN_REST']);
  });

  it('DAILY_LIMIT only', () => {
    const r = checkEligibility(
      ctx({ org: { ...org, maxDailyMin: 360 }, candidateShifts: [sh('x', '2026-11-06T05:00', '2026-11-06T07:00')] }),
      target,
    );
    expect(r.failedRules).toEqual(['DAILY_LIMIT']);
  });

  it('WEEKLY_LIMIT with member limit', () => {
    const r = checkEligibility(
      ctx({ candidate: { ...candidate, weeklyLimitMin: 600 }, candidateShifts: [sh('x', '2026-11-03T08:00', '2026-11-03T16:00')] }),
      target,
    );
    expect(r.failedRules).toEqual(['WEEKLY_LIMIT']);
  });

  it('null member limit uses the org default', () => {
    const r = checkEligibility(
      ctx({ org: { ...org, defaultWeeklyLimitMin: 600 }, candidateShifts: [sh('x', '2026-11-03T08:00', '2026-11-03T16:00')] }),
      target,
    );
    expect(r.failedRules).toEqual(['WEEKLY_LIMIT']);
  });

  describe('overnight shift on Sunday', () => {
    const night: TargetShift = { ...target, startAt: at('2026-11-01T22:00'), endAt: at('2026-11-02T06:00') };
    const six = (days: string[]) => days.map((d, i) => sh(`w${i}`, `${d}T10:00`, `${d}T16:00`));

    it('counts toward the week it starts in', () => {
      const week = six(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
      expect(checkEligibility(ctx({ candidateShifts: week }), night).failedRules).toEqual(['WEEKLY_LIMIT']);
    });

    it('ignores 36 h in the next week', () => {
      const next = six(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
      expect(checkEligibility(ctx({ candidateShifts: next }), night)).toEqual({ eligible: true, failedRules: [] });
    });
  });

  it('returns multiple failures in RuleCode order', () => {
    const r = checkEligibility(ctx({ candidate: { ...candidate, status: 'DEACTIVATED', skillIds: [] } }), target);
    expect(r.failedRules).toEqual(['NOT_ACTIVE', 'MISSING_SKILL']);
    expect(r.eligible).toBe(false);
  });

  it('ignores the target shift itself in candidateShifts', () => {
    const r = checkEligibility(ctx({ candidateShifts: [sh('t', '2026-11-06T18:00', '2026-11-06T23:00')] }), target);
    expect(r).toEqual({ eligible: true, failedRules: [] });
  });

  it('back-to-back shift is MIN_REST, not OVERLAP', () => {
    const r = checkEligibility(ctx({ candidateShifts: [sh('x', '2026-11-06T14:00', '2026-11-06T18:00')] }), target);
    expect(r).toEqual({ eligible: false, failedRules: ['MIN_REST'] });
  });

  it('unavailability ending exactly at target start is fine', () => {
    const r = checkEligibility(ctx({ unavailability: [{ startAt: at('2026-11-06T15:00'), endAt: at('2026-11-06T18:00') }] }), target);
    expect(r).toEqual({ eligible: true, failedRules: [] });
  });

  it('previous-day overnight shift is not in the daily total', () => {
    const r = checkEligibility(
      ctx({ org: { ...org, maxDailyMin: 360 }, candidateShifts: [sh('x', '2026-11-05T22:00', '2026-11-06T06:00')] }),
      target,
    );
    expect(r).toEqual({ eligible: true, failedRules: [] });
  });

  it('shift starting exactly next Monday 00:00 is excluded from the weekly total', () => {
    const r = checkEligibility(
      ctx({ candidate: { ...candidate, weeklyLimitMin: 360 }, candidateShifts: [sh('x', '2026-11-09T00:00', '2026-11-09T06:00')] }),
      target,
    );
    expect(r).toEqual({ eligible: true, failedRules: [] });
  });

  it('DST-end overnight shift counts 540 min toward its week', () => {
    const dst: TargetShift = { ...target, startAt: at('2026-10-24T22:00'), endAt: at('2026-10-25T06:00') };
    // 1900 existing min: 1900 + 480 = 2380 would pass, 1900 + 540 = 2440 fails.
    const existing = [
      sh('a', '2026-10-19T10:00', '2026-10-19T20:00'),
      sh('b', '2026-10-20T10:00', '2026-10-20T20:00'),
      sh('c', '2026-10-21T10:00', '2026-10-21T20:00'),
      sh('d', '2026-10-22T10:00', '2026-10-22T11:40'),
    ];
    const r = checkEligibility(ctx({ candidateShifts: existing }), dst);
    expect(r).toEqual({ eligible: false, failedRules: ['WEEKLY_LIMIT'] });
  });
});
