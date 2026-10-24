import { DomainError } from '../common/domain-error';
import { canonicalTimeZone } from './time-zone';

describe('canonicalTimeZone', () => {
  it('fixes the casing of an IANA name', () => {
    expect(canonicalTimeZone('europe/berlin')).toBe('Europe/Berlin');
  });

  it('keeps UTC as UTC', () => {
    expect(canonicalTimeZone('UTC')).toBe('UTC');
  });

  it.each(['+01:00', '-05:00'])('rejects the offset-style value %s', (tz) => {
    expect.assertions(3);
    try {
      canonicalTimeZone(tz);
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe('VALIDATION_FAILED');
      expect((e as DomainError).message).toBe('Choose a time zone like Europe/Berlin');
    }
  });
});
