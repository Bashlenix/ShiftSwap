import { localToInstant } from '../../lib/format';

const DAY_MS = 86_400_000;

const keyFormat = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = (timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

/** `YYYY-MM-DD` of an instant on the wall clock of `timeZone`. */
export function dayKey(at: Date | string, timeZone: string): string {
  return keyFormat(timeZone).format(new Date(at));
}

/** Date and `HH:mm` of an ISO instant in `timeZone` (for form fields). */
export function localParts(iso: string, timeZone: string): { date: string; time: string } {
  return { date: dayKey(iso, timeZone), time: timeFormat(timeZone).format(new Date(iso)) };
}

/** Adds whole calendar days to a `YYYY-MM-DD` key (zone-free arithmetic). */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function isoWeekOfKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = (date.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(date.getTime() + (3 - dow) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** ISO week (Monday start) of `date` as seen in the org zone, e.g. `2026-W45`. */
export function weekParam(date: Date, timeZone: string): string {
  return isoWeekOfKey(dayKey(date, timeZone));
}

export function isWeekParam(param: string | null): param is string {
  return param !== null && /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(param);
}

function mondayKey(param: string): string {
  const [, y, w] = /^(\d{4})-W(\d{2})$/.exec(param)!;
  const jan4 = new Date(Date.UTC(+y, 0, 4));
  const dow = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4.getTime() - dow * DAY_MS);
  return new Date(week1Monday.getTime() + (+w - 1) * 7 * DAY_MS).toISOString().slice(0, 10);
}

/** Monday 00:00 to next Monday 00:00 in the org zone, plus the seven day keys. */
export function weekRange(
  param: string,
  timeZone: string,
): { from: Date; to: Date; days: string[] } {
  const monday = mondayKey(param);
  return {
    from: new Date(localToInstant(`${monday}T00:00`, timeZone)),
    to: new Date(localToInstant(`${addDays(monday, 7)}T00:00`, timeZone)),
    days: Array.from({ length: 7 }, (_, i) => addDays(monday, i)),
  };
}

export function shiftWeek(param: string, delta: number, timeZone: string): string {
  void timeZone;
  return isoWeekOfKey(addDays(mondayKey(param), delta * 7));
}
