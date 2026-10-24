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

/** e.g. `Fri 6 Nov, 18:00–23:00`; `(+1)` when it ends on the next local day;
 * the end date is spelled out when it is further away. */
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
  const dayDiff = Math.round(
    (Date.parse(key.format(end)) - Date.parse(key.format(start))) / 86_400_000,
  );
  const head = `${parts.weekday} ${parts.day} ${parts.month}, ${time.format(start)}`;
  if (dayDiff > 1) {
    const e = Object.fromEntries(
      dayFormat(timezone)
        .formatToParts(end)
        .map((p) => [p.type, p.value]),
    );
    return `${head} → ${e.weekday} ${e.day} ${e.month}, ${time.format(end)}`;
  }
  return `${head}–${time.format(end)}${dayDiff === 1 ? ' (+1)' : ''}`;
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

/** e.g. `Sat 24 Oct, 14:05` in `timezone`. */
export function formatDateTime(instant: string, timezone: string): string {
  const date = new Date(instant);
  const p = Object.fromEntries(
    dayFormat(timezone)
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return `${p.weekday} ${p.day} ${p.month}, ${timeFormat(timezone).format(date)}`;
}
