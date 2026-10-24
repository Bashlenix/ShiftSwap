import { DomainError } from './domain-error';

const invalid = (path: string, message: string) =>
  new DomainError('VALIDATION_FAILED', 'Request validation failed', {
    issues: [{ path, message }],
  });

/**
 * A query parameter that must appear at most once. Express parses `?a=1&a=2` into an array,
 * which would otherwise reach string checks or Prisma and end in a 500.
 */
export function singleQueryParam(raw: unknown, path: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') throw invalid(path, 'Give this parameter at most once');
  return raw;
}

/** Page size from `?limit=`: digits only, 1..max; absent = the default. */
export function parseLimit(raw: unknown, opts: { defaultLimit: number; max: number }): number {
  const value = singleQueryParam(raw, 'limit');
  if (value === undefined) return opts.defaultLimit;
  const n = Number(value);
  if (!/^\d+$/.test(value) || n < 1 || n > opts.max) {
    throw invalid('limit', `Must be an integer from 1 to ${opts.max}`);
  }
  return n;
}
