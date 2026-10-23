import type { RuleCode } from '@shiftswap/shared';

export interface Interval {
  startAt: Date;
  endAt: Date;
}

export interface ScheduledShift extends Interval {
  id: string;
}

export interface OrgPolicy {
  timezone: string;
  defaultWeeklyLimitMin: number;
  minRestMin: number;
  maxDailyMin: number;
}

export interface Candidate {
  id: string;
  status: 'ACTIVE' | 'DEACTIVATED';
  hasLogin: boolean;
  skillIds: string[];
  weeklyLimitMin: number | null;
}

export interface TargetShift extends Interval {
  id: string;
  requiredSkillIds: string[];
  assignedMembershipId: string | null;
}

export interface EligibilityContext {
  org: OrgPolicy;
  candidate: Candidate;
  candidateShifts: ScheduledShift[];
  unavailability: Interval[];
}

export interface EligibilityResult {
  eligible: boolean;
  failedRules: RuleCode[];
}
