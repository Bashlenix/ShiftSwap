import { DateTime } from 'luxon';
import type { PreferenceEntry, PreferenceSlot } from '@shiftswap/shared';
import type { Preference } from './ranking';
import type { Interval } from './types';

/** Slot boundaries in org-local hours: MORNING 05-12, AFTERNOON 12-17, EVENING 17-05. */
const BOUNDARY_HOURS = [5, 12, 17];

export function slotOf(localHour: number): PreferenceSlot {
  if (localHour >= 5 && localHour < 12) return 'MORNING';
  if (localHour >= 12 && localHour < 17) return 'AFTERNOON';
  return 'EVENING';
}

function nextBoundary(from: DateTime): DateTime {
  const day = from.startOf('day');
  for (const h of BOUNDARY_HOURS) {
    const candidate = day.set({ hour: h });
    if (candidate > from) return candidate;
  }
  return day.plus({ days: 1 }).set({ hour: BOUNDARY_HOURS[0] });
}

function localStart(shift: Interval, tz: string): DateTime {
  const start = DateTime.fromJSDate(shift.startAt, { zone: tz });
  if (!start.isValid) throw new Error(`Invalid timezone: ${tz}`);
  return start;
}

/** Distinct slots the half-open shift touches, in the order first touched. */
export function touchedSlots(shift: Interval, tz: string): PreferenceSlot[] {
  const end = DateTime.fromJSDate(shift.endAt, { zone: tz });
  const slots: PreferenceSlot[] = [];
  let cursor = localStart(shift, tz);
  while (cursor < end) {
    const slot = slotOf(cursor.hour);
    if (!slots.includes(slot)) slots.push(slot);
    cursor = nextBoundary(cursor);
  }
  return slots;
}

/** Worst value over the touched slots (AVOID < NEUTRAL < PREFERRED); weekday = local start date. */
export function preferenceForShift(
  entries: readonly PreferenceEntry[],
  shift: Interval,
  tz: string,
): Preference {
  if (entries.length === 0) return 'NEUTRAL';
  const weekday = localStart(shift, tz).weekday - 1;
  const values = touchedSlots(shift, tz).map(
    (slot): Preference =>
      entries.find((e) => e.weekday === weekday && e.slot === slot)?.value ?? 'NEUTRAL',
  );
  if (values.includes('AVOID')) return 'AVOID';
  if (values.length > 0 && values.every((v) => v === 'PREFERRED')) return 'PREFERRED';
  return 'NEUTRAL';
}
