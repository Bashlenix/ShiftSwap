import { ERROR_CODES } from '@shiftswap/shared';
import { DomainError, STATUS_BY_CODE } from './domain-error';

describe('STATUS_BY_CODE', () => {
  it('maps every error code', () => {
    for (const code of ERROR_CODES) expect(STATUS_BY_CODE[code]).toBeGreaterThanOrEqual(400);
  });
  it.each([
    ['LAST_ADMIN', 409],
    ['ALREADY_MEMBER', 409],
    ['INVITE_INVALID', 410],
    ['SKILL_IN_USE', 409],
    ['EMAIL_MISMATCH', 403],
    ['RATE_LIMITED', 429],
  ] as const)('%s -> %i', (code, status) => {
    expect(new DomainError(code, 'x').status).toBe(status);
  });
});
