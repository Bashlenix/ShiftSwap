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
    ['INVALID_TRANSITION', 'This offer is no longer open.'],
    ['FORBIDDEN', "You don't have permission to do that."],
    ['NOT_FOUND', 'This item no longer exists.'],
  ] as const)('maps %s', (code, text) => {
    expect(errorMessage(new ApiError(409, { error: { code, message: 'x' } }))).toBe(text);
  });

  it('uses the first validation issue message for VALIDATION_FAILED', () => {
    const err = new ApiError(400, {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'x',
        details: {
          issues: [
            { path: 'endAt', message: 'A shift can be at most 16 hours' },
            { path: 'notes', message: 'second' },
          ],
        },
      },
    });
    expect(errorMessage(err)).toBe('A shift can be at most 16 hours');
  });

  it('falls back to a form hint for VALIDATION_FAILED without issues', () => {
    const err = new ApiError(400, { error: { code: 'VALIDATION_FAILED', message: 'x' } });
    expect(errorMessage(err)).toBe('Please check the form.');
  });

  it('names the candidate for INELIGIBLE when reviewing', () => {
    const err = new ApiError(422, {
      error: { code: 'INELIGIBLE', message: 'x', details: { failedRules: ['OVERLAP'] } },
    });
    expect(errorMessage(err, { candidate: 'Lukas Wolf' })).toBe(
      'Lukas Wolf can no longer take this shift: Overlaps another shift',
    );
  });

  it('falls back for unknown errors', () => {
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong. Please try again.');
    expect(errorMessage(new ApiError(500))).toBe('Something went wrong. Please try again.');
  });
});
