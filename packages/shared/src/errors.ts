export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'INVALID_TRANSITION',
  'OFFER_ALREADY_FILLED',
  'OFFER_EXPIRED',
  'OFFER_ALREADY_OPEN',
  'INELIGIBLE',
  'SELF_APPROVAL_FORBIDDEN',
  'LAST_ADMIN',
  'ALREADY_MEMBER',
  'INVITE_INVALID',
  'SKILL_IN_USE',
  'EMAIL_MISMATCH',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type RuleCode =
  | 'NOT_ACTIVE'
  | 'IS_OWNER'
  | 'MISSING_SKILL'
  | 'OVERLAP'
  | 'UNAVAILABLE'
  | 'MIN_REST'
  | 'DAILY_LIMIT'
  | 'WEEKLY_LIMIT';

export const RULE_LABELS: Record<RuleCode, string> = {
  NOT_ACTIVE: 'Not an active member',
  IS_OWNER: 'Already assigned to this shift',
  MISSING_SKILL: 'Missing a required skill',
  OVERLAP: 'Overlaps another shift',
  UNAVAILABLE: 'Marked as unavailable',
  MIN_REST: 'Less than the minimum rest between shifts',
  DAILY_LIMIT: 'Over the daily hour limit',
  WEEKLY_LIMIT: 'Over the weekly hour limit',
};

export interface ValidationIssue {
  /** Dot-joined path of the offending field. */
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
}
