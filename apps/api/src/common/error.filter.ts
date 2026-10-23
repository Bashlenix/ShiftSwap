import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ErrorCode } from '@shiftswap/shared';
import type { Response } from 'express';
import { DomainError, STATUS_BY_CODE } from './domain-error';
import { InvalidTransitionError } from '../offers/offer-state';
import { isErrorCode } from './error-codes';

interface Rendered {
  status: number;
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

const OPEN_OFFER_INDEX = 'offers_one_open_per_shift';

/** Prisma 7 + pg adapter puts the violated index in meta.driverAdapterError.cause.constraint. */
function isOpenOfferViolation(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { code?: unknown; meta?: unknown; message?: unknown };
  if (err.code !== 'P2002') return false;
  return (
    JSON.stringify(err.meta ?? null).includes(OPEN_OFFER_INDEX) ||
    String(err.message ?? '').includes(OPEN_OFFER_INDEX)
  );
}

function fromHttpException(e: HttpException): Rendered {
  const status = e.getStatus();
  if (status === 401) return { status, code: 'UNAUTHENTICATED', message: 'Not signed in' };
  if (status === 403) return { status, code: 'FORBIDDEN', message: 'Forbidden' };
  if (status === 404) return { status, code: 'NOT_FOUND', message: 'Not found' };
  if (status === 409) return { status, code: 'INVALID_TRANSITION', message: 'Conflict' };
  if (status < 500) return { status, code: 'VALIDATION_FAILED', message: 'Invalid request' };
  return internal();
}

const internal = (): Rendered => ({
  status: 500,
  code: 'INTERNAL',
  message: 'Internal server error',
});

export function renderError(e: unknown): Rendered {
  if (e instanceof DomainError) {
    return { status: e.status, code: e.code, message: e.message, details: e.details };
  }
  if (e instanceof InvalidTransitionError && isErrorCode(e.code)) {
    return { status: STATUS_BY_CODE[e.code], code: e.code, message: e.message };
  }
  if (isOpenOfferViolation(e)) {
    return {
      status: STATUS_BY_CODE.OFFER_ALREADY_OPEN,
      code: 'OFFER_ALREADY_OPEN',
      message: 'This shift already has an open offer',
    };
  }
  if (e instanceof HttpException) return fromHttpException(e);
  // body-parser / express errors carry a 4xx status (malformed JSON, payload too large).
  const status = (e as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return { status, code: 'VALIDATION_FAILED', message: 'Invalid request' };
  }
  return internal();
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    // Readiness probe contract ({status:'unavailable'}) is not part of the API error format.
    if (exception instanceof ServiceUnavailableException) {
      res.status(503).json(exception.getResponse());
      return;
    }
    const r = renderError(exception);
    if (r.status >= 500) {
      // Never log the message of unknown errors verbatim to the client; log name only.
      this.logger.error(
        `Unhandled error: ${exception instanceof Error ? exception.name : typeof exception}`,
      );
    }
    const error: { code: ErrorCode; message: string; details?: Record<string, unknown> } = {
      code: r.code,
      message: r.message,
    };
    if (r.details) error.details = r.details;
    res.status(r.status).json({ error });
  }
}
