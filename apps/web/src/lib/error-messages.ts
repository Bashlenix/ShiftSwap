import { RULE_LABELS, type RuleCode } from '@shiftswap/shared';
import { ApiError } from './api';

const GENERIC = 'Something went wrong. Please try again.';

export function errorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return GENERIC;
  switch (err.code) {
    case 'INELIGIBLE': {
      const rules = (err.details?.failedRules as RuleCode[] | undefined) ?? [];
      return "You can't take this shift: " + rules.map((r) => RULE_LABELS[r] ?? r).join(', ');
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
    default:
      return GENERIC;
  }
}
