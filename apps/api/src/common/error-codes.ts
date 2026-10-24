import { ERROR_CODES, type ErrorCode } from '@shiftswap/shared';

export function isErrorCode(x: string): x is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(x);
}
