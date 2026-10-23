import { describe, expect, it } from 'vitest';
import { formatShiftTime } from './format';

describe('formatShiftTime', () => {
  it('formats a same-day shift in the org timezone', () => {
    // 17:00Z-22:00Z in November = CET (UTC+1)
    expect(formatShiftTime('2026-11-06T17:00:00Z', '2026-11-06T22:00:00Z', 'Europe/Berlin')).toBe(
      'Fri 6 Nov, 18:00–23:00',
    );
  });

  it('marks shifts that end on the next day with (+1)', () => {
    expect(formatShiftTime('2026-11-08T21:00:00Z', '2026-11-09T05:00:00Z', 'Europe/Berlin')).toBe(
      'Sun 8 Nov, 22:00–06:00 (+1)',
    );
  });

  it('uses summer time before the October DST switch', () => {
    // 2026-10-24 is still CEST (UTC+2)
    expect(formatShiftTime('2026-10-24T16:00:00Z', '2026-10-24T20:00:00Z', 'Europe/Berlin')).toBe(
      'Sat 24 Oct, 18:00–22:00',
    );
  });

  it('handles the DST switch night (22:00 to 06:00 across 25 Oct)', () => {
    expect(formatShiftTime('2026-10-25T20:00:00Z', '2026-10-26T05:00:00Z', 'Europe/Berlin')).toBe(
      'Sun 25 Oct, 21:00–06:00 (+1)',
    );
  });
});

describe('localToInstant', () => {
  it('converts winter and summer wall time', async () => {
    const { localToInstant } = await import('./format');
    expect(localToInstant('2026-11-10T09:00', 'Europe/Berlin')).toBe('2026-11-10T08:00:00.000Z');
    expect(localToInstant('2026-10-24T09:00', 'Europe/Berlin')).toBe('2026-10-24T07:00:00.000Z');
    expect(localToInstant('2026-10-26T09:00', 'Europe/Berlin')).toBe('2026-10-26T08:00:00.000Z');
  });
});
