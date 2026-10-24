import { DateTime } from 'luxon';
import type { PreferenceEntry } from '@shiftswap/shared';
import { preferenceForShift, slotOf, touchedSlots } from './preference';

const TZ = 'Europe/Berlin';
// 2026-11-04 is a Wednesday (weekday 2), 2026-11-07 a Saturday (weekday 5), 2026-11-08 a Sunday (6).
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();
const shift = (from: string, to: string) => ({ startAt: at(from), endAt: at(to) });
const entry = (
  weekday: number,
  slot: PreferenceEntry['slot'],
  value: PreferenceEntry['value'],
): PreferenceEntry => ({ weekday, slot, value });

describe('slotOf', () => {
  it('maps local hours to slots', () => {
    expect(slotOf(4)).toBe('EVENING');
    expect(slotOf(5)).toBe('MORNING');
    expect(slotOf(11)).toBe('MORNING');
    expect(slotOf(12)).toBe('AFTERNOON');
    expect(slotOf(16)).toBe('AFTERNOON');
    expect(slotOf(17)).toBe('EVENING');
    expect(slotOf(0)).toBe('EVENING');
  });
});

describe('touchedSlots', () => {
  it('lists slots in the order first touched', () => {
    expect(touchedSlots(shift('2026-11-04T10:00', '2026-11-04T14:00'), TZ)).toEqual([
      'MORNING',
      'AFTERNOON',
    ]);
  });
  it('treats the end as exclusive', () => {
    expect(touchedSlots(shift('2026-11-04T12:00', '2026-11-04T17:00'), TZ)).toEqual(['AFTERNOON']);
  });
  it('covers overnight shifts', () => {
    expect(touchedSlots(shift('2026-11-07T22:00', '2026-11-08T06:00'), TZ)).toEqual([
      'EVENING',
      'MORNING',
    ]);
  });
  it('treats 04:00-05:00 as evening', () => {
    expect(touchedSlots(shift('2026-11-04T04:00', '2026-11-04T05:00'), TZ)).toEqual(['EVENING']);
  });
});

describe('preferenceForShift', () => {
  it('returns PREFERRED for a matching preferred slot', () => {
    expect(
      preferenceForShift(
        [entry(2, 'EVENING', 'PREFERRED')],
        shift('2026-11-04T18:00', '2026-11-04T23:00'),
        TZ,
      ),
    ).toBe('PREFERRED');
  });
  it('the worst touched slot wins', () => {
    expect(
      preferenceForShift(
        [entry(2, 'MORNING', 'PREFERRED'), entry(2, 'AFTERNOON', 'AVOID')],
        shift('2026-11-04T10:00', '2026-11-04T14:00'),
        TZ,
      ),
    ).toBe('AVOID');
  });
  it('uses the start weekday for overnight shifts', () => {
    const s = shift('2026-11-07T22:00', '2026-11-08T06:00');
    expect(preferenceForShift([entry(5, 'MORNING', 'AVOID')], s, TZ)).toBe('AVOID');
    expect(preferenceForShift([entry(6, 'MORNING', 'AVOID')], s, TZ)).toBe('NEUTRAL');
  });
  it('is NEUTRAL without entries', () => {
    expect(preferenceForShift([], shift('2026-11-04T10:00', '2026-11-04T14:00'), TZ)).toBe(
      'NEUTRAL',
    );
  });
  it('mixes PREFERRED with untouched neutral as NEUTRAL', () => {
    expect(
      preferenceForShift(
        [entry(2, 'MORNING', 'PREFERRED')],
        shift('2026-11-04T10:00', '2026-11-04T14:00'),
        TZ,
      ),
    ).toBe('NEUTRAL');
  });
});
