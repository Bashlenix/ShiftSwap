import type { ErrorCode } from '@shiftswap/shared';

/** HTTP status per error code (SDD §24). */
export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  INVALID_TRANSITION: 409,
  OFFER_ALREADY_FILLED: 409,
  OFFER_EXPIRED: 409,
  OFFER_ALREADY_OPEN: 409,
  INELIGIBLE: 422,
  SELF_APPROVAL_FORBIDDEN: 403,
  LAST_ADMIN: 409,
  ALREADY_MEMBER: 409,
  INVITE_INVALID: 410,
  SKILL_IN_USE: 409,
  EMAIL_MISMATCH: 403,
  INTERNAL: 500,
};

export class DomainError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
    this.status = STATUS_BY_CODE[code];
  }
}
