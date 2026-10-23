import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { errorMessage } from './error-messages';

describe('errorMessage', () => {
  it('lists failed rules for INELIGIBLE', () => {
    const err = new ApiError(422, {
      error: {
        code: 'INELIGIBLE',
        message: 'x',
        details: { failedRules: ['OVERLAP', 'MISSING_SKILL'] },
      },
    });
    expect(errorMessage(err)).toBe(
      "You can't take this shift: Overlaps another shift, Missing a required skill",
    );
  });

  it.each([
    ['OFFER_ALREADY_FILLED', 'Someone else claimed this shift first.'],
    ['OFFER_EXPIRED', 'This offer has expired.'],
    ['VERSION_CONFLICT', 'This was changed by someone else. The page has been refreshed.'],
    ['OFFER_ALREADY_OPEN', 'This shift is already offered.'],
    ['SELF_APPROVAL_FORBIDDEN', 'Another manager has to approve your own shift.'],
  ] as const)('maps %s', (code, text) => {
    expect(errorMessage(new ApiError(409, { error: { code, message: 'x' } }))).toBe(text);
  });

  it('falls back for unknown errors', () => {
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong. Please try again.');
    expect(errorMessage(new ApiError(500))).toBe('Something went wrong. Please try again.');
  });
});
