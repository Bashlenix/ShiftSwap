import { DateTime } from 'luxon';
import { demoInstant, demoShiftWindow } from './demo-data';

const TZ = 'Europe/Berlin';

describe('demoInstant', () => {
  const day = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).startOf('day');

  it('maps org-local wall time to the UTC instant', () => {
    expect(demoInstant(day('2026-07-01'), 1, '07:00', TZ).toISOString()).toBe(
      '2026-07-02T05:00:00.000Z',
    );
    expect(demoInstant(day('2026-12-01'), 0, '07:00', TZ).toISOString()).toBe(
      '2026-12-01T06:00:00.000Z',
    );
  });

  it('handles the autumn DST day (shift starts 2026-10-24, clocks go back that night)', () => {
    const today = day('2026-10-24');
    // Overnight: end <= start rolls to the next day; 22:00 CEST -> 06:00 CET = 9 h.
    const { startAt: start, endAt: end } = demoShiftWindow(
      today,
      { dayOffset: 0, start: '22:00', end: '06:00' },
      TZ,
    );
    expect(demoInstant(today, 0, '22:00', TZ).getTime()).toBe(start.getTime());
    expect(start.toISOString()).toBe('2026-10-24T20:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-25T05:00:00.000Z');
    expect((end.getTime() - start.getTime()) / 60000).toBe(540);
  });
});
