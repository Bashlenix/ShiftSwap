import { describe, expect, it } from 'vitest';
import { localParts, shiftWeek, weekParam, weekRange } from './week';

describe('weekParam', () => {
  it('puts Sunday 23:30 Berlin in the Monday-start week, not the next one', () => {
    // 2026-11-08 23:30 Berlin (CET) = 22:30Z
    expect(weekParam(new Date('2026-11-08T22:30:00Z'), 'Europe/Berlin')).toBe('2026-W45');
    expect(weekParam(new Date('2026-11-08T23:30:00Z'), 'Europe/Berlin')).toBe('2026-W46');
  });

  it('uses the org zone, not the zone of the machine', () => {
    // 2026-11-08 23:30Z is already Monday in Berlin but still Sunday in New York
    expect(weekParam(new Date('2026-11-08T23:30:00Z'), 'America/New_York')).toBe('2026-W45');
  });

  it('handles the ISO year boundary', () => {
    expect(weekParam(new Date('2027-01-01T12:00:00Z'), 'Europe/Berlin')).toBe('2026-W53');
    expect(weekParam(new Date('2025-12-29T12:00:00Z'), 'Europe/Berlin')).toBe('2026-W01');
  });
});

describe('weekRange', () => {
  it('returns Monday 00:00 to next Monday 00:00 org-local with seven day keys', () => {
    const r = weekRange('2026-W45', 'Europe/Berlin');
    expect(r.days).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
    expect(r.from.toISOString()).toBe('2026-11-01T23:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-11-08T23:00:00.000Z');
  });

  it('spans 169 hours in the week the clocks go back', () => {
    const r = weekRange('2026-W43', 'Europe/Berlin'); // 2026-10-25 is the last Sunday of October
    expect((r.to.getTime() - r.from.getTime()) / 3_600_000).toBe(169);
  });
});

describe('shiftWeek', () => {
  it('moves across the year boundary', () => {
    expect(shiftWeek('2026-W01', -1, 'Europe/Berlin')).toBe('2025-W52');
    expect(shiftWeek('2026-W53', 1, 'Europe/Berlin')).toBe('2027-W01');
  });
});

describe('localParts', () => {
  it('reads date and time in the org zone', () => {
    expect(localParts('2026-11-08T22:30:00Z', 'Europe/Berlin')).toEqual({
      date: '2026-11-08',
      time: '23:30',
    });
  });
});
