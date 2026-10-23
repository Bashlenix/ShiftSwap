import { DateTime } from 'luxon';
import type { Interval } from './types';

export function durationMin(i: Interval): number {
  return Math.round((i.endAt.getTime() - i.startAt.getTime()) / 60_000);
}

/** Half-open [start, end): touching intervals do not overlap. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

function local(at: Date, tz: string): DateTime {
  return DateTime.fromJSDate(at, { zone: tz });
}

export function localDateKey(at: Date, tz: string): string {
  return local(at, tz).toFormat('yyyy-MM-dd');
}

/** ISO week of the org-local date, e.g. 2026-W44. */
export function weekKey(at: Date, tz: string): string {
  const d = local(at, tz);
  return `${d.weekYear}-W${String(d.weekNumber).padStart(2, '0')}`;
}

/** Monday 00:00 -> next Monday 00:00 org-local, as UTC instants. */
export function weekWindow(at: Date, tz: string): Interval {
  const start = local(at, tz).startOf('week');
  return { startAt: start.toJSDate(), endAt: start.plus({ weeks: 1 }).toJSDate() };
}
