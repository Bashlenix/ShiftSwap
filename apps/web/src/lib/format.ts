const dayFormat = (timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short' });
const timeFormat = (timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
const keyFormat = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });

/** e.g. `Fri 6 Nov, 18:00–23:00`; `(+1)` when the shift ends on the next local day. */
export function formatShiftTime(startAt: string, endAt: string, timezone: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const parts = Object.fromEntries(
    dayFormat(timezone)
      .formatToParts(start)
      .map((p) => [p.type, p.value]),
  );
  const time = timeFormat(timezone);
  const key = keyFormat(timezone);
  const nextDay = key.format(end) !== key.format(start);
  return `${parts.weekday} ${parts.day} ${parts.month}, ${time.format(start)}–${time.format(end)}${nextDay ? ' (+1)' : ''}`;
}

/** Offset of `timeZone` from UTC at `instant`, in ms (positive east of UTC). */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(instant))
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Turns a `datetime-local` value (`2026-11-10T09:00`) in `timeZone` into an ISO instant (Z). */
export function localToInstant(local: string, timeZone: string): string {
  const [date, time] = local.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall - zoneOffsetMs(wall, timeZone);
  guess = wall - zoneOffsetMs(guess, timeZone);
  return new Date(guess).toISOString();
}
