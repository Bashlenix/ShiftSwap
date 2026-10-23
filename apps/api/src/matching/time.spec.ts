import { DateTime } from 'luxon';
import { durationMin, localDateKey, overlaps, weekKey, weekWindow } from './time';

const TZ = 'Europe/Berlin';
const at = (s: string) => DateTime.fromISO(s, { zone: TZ }).toJSDate();

describe('time helpers', () => {
  it('counts 540 min for 22:00-06:00 across DST end', () => {
    expect(durationMin({ startAt: at('2026-10-24T22:00'), endAt: at('2026-10-25T06:00') })).toBe(540);
  });

  it('uses half-open overlap', () => {
    const a = { startAt: at('2026-11-06T10:00'), endAt: at('2026-11-06T12:00') };
    const b = { startAt: at('2026-11-06T12:00'), endAt: at('2026-11-06T14:00') };
    expect(overlaps(a, b)).toBe(false);
    expect(overlaps(a, { startAt: at('2026-11-06T11:59'), endAt: at('2026-11-06T13:00') })).toBe(true);
  });

  it('localDateKey uses the org zone', () => {
    expect(localDateKey(at('2026-11-01T23:30'), TZ)).toBe('2026-11-01');
  });

  it('weekKey is the ISO week of the local date', () => {
    expect(weekKey(at('2026-11-01T23:30'), TZ)).toBe('2026-W44');
    expect(weekKey(at('2026-11-02T00:00'), TZ)).toBe('2026-W45');
  });

  it('weekWindow starts Monday 00:00 local', () => {
    const w = weekWindow(at('2026-11-04T12:00'), TZ);
    expect(w.startAt).toEqual(at('2026-11-02T00:00'));
    expect(w.endAt).toEqual(at('2026-11-09T00:00'));
  });

  it('weekWindow spans 169 h in the DST-end week', () => {
    const w = weekWindow(at('2026-10-21T12:00'), TZ);
    expect(durationMin(w)).toBe(169 * 60);
  });

  it('throws on an invalid timezone', () => {
    expect(() => localDateKey(at('2026-11-01T12:00'), 'Mars/Olympus')).toThrow('Invalid timezone: Mars/Olympus');
    expect(() => weekWindow(at('2026-11-01T12:00'), 'Mars/Olympus')).toThrow('Invalid timezone: Mars/Olympus');
  });
});
