import { RULE_LABELS, type RuleCode, type ValidationIssue } from '@shiftswap/shared';
import { ApiError } from './api';

const GENERIC = 'Something went wrong. Please try again.';

/**
 * `candidate` is set where a manager reads the error about someone else (approving a
 * colleague), so INELIGIBLE names them instead of saying "You".
 */
export function errorMessage(err: unknown, opts: { candidate?: string } = {}): string {
  if (!(err instanceof ApiError)) return GENERIC;
  switch (err.code) {
    case 'INELIGIBLE': {
      const rules = (err.details?.failedRules as RuleCode[] | undefined) ?? [];
      const reasons = rules.map((r) => RULE_LABELS[r] ?? r).join(', ');
      return opts.candidate
        ? `${opts.candidate} can no longer take this shift: ${reasons}`
        : `You can't take this shift: ${reasons}`;
    }
    case 'OFFER_ALREADY_FILLED':
      return 'Someone else claimed this shift first.';
    case 'OFFER_EXPIRED':
      return 'This offer has expired.';
    case 'VERSION_CONFLICT':
      return 'This was changed by someone else. The page has been refreshed.';
    case 'OFFER_ALREADY_OPEN':
      return 'This shift is already offered.';
    case 'SELF_APPROVAL_FORBIDDEN':
      return 'Another manager has to approve your own shift.';
    case 'INVALID_TRANSITION':
      return 'This offer is no longer open.';
    case 'VALIDATION_FAILED': {
      const issues = err.details?.issues as ValidationIssue[] | undefined;
      return issues?.[0]?.message || 'Please check the form.';
    }
    case 'FORBIDDEN':
      return "You don't have permission to do that.";
    case 'NOT_FOUND':
      return 'This item no longer exists.';
    case 'LAST_ADMIN':
      return 'An organisation needs at least one admin.';
    case 'ALREADY_MEMBER':
      // The server words the deactivated-email case differently; keep that.
      return err.serverMessage || 'This email already belongs to a member.';
    case 'INVITE_INVALID':
      return 'This invite is no longer valid.';
    case 'SKILL_IN_USE':
      return 'This skill is still required by upcoming shifts.';
    case 'EMAIL_MISMATCH':
      return 'This invite is for a different email address.';
    case 'RATE_LIMITED':
      return 'Too many requests. Please wait a moment and try again.';
    default:
      return GENERIC;
  }
}
