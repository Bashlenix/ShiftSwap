import { DomainError } from '../common/domain-error';

/**
 * Returns the canonical IANA name ('europe/berlin' -> 'Europe/Berlin').
 * Offset-style values ('+01:00') are valid for Intl but have no DST rules, so we reject them.
 */
export function canonicalTimeZone(tz: string): string {
  const message = 'Choose a time zone like Europe/Berlin';
  if (tz.startsWith('+') || tz.startsWith('-')) {
    throw new DomainError('VALIDATION_FAILED', message);
  }
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    throw new DomainError('VALIDATION_FAILED', message);
  }
}
