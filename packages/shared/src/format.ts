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
