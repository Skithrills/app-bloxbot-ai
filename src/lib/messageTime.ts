const DAY_MS = 24 * 60 * 60 * 1000;

const clock = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const dayOfYear = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const dayWithYear = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * When a message was sent, as the day and a 24-hour time: "Today 14:00", "Yesterday 04:14",
 * "Friday 21:36" within the last week, and the date before that.
 */
export function messageDayAndTime(
  timestamp: number,
  now = Date.now(),
): { day: string; time: string } {
  const sent = new Date(timestamp);
  const today = new Date(now);
  const daysAgo = Math.round((startOfDay(today) - startOfDay(sent)) / DAY_MS);
  const day =
    daysAgo === 0
      ? "Today"
      : daysAgo === 1
        ? "Yesterday"
        : daysAgo > 1 && daysAgo < 7
          ? weekday.format(sent)
          : sent.getFullYear() === today.getFullYear()
            ? dayOfYear.format(sent)
            : dayWithYear.format(sent);
  return { day, time: clock.format(sent) };
}

/** How long a stretch of work took: "32s", "2m 22s", "1h 5m". */
export function workedFor(milliseconds: number): string {
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "always" });
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** How long ago a message was sent: "just now", "5 minutes ago", "11 hours ago", "3 days ago". */
export function timeAgo(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return relative.format(-Math.floor(elapsed / MINUTE_MS), "minute");
  if (elapsed < DAY_MS) return relative.format(-Math.floor(elapsed / HOUR_MS), "hour");
  if (elapsed < 30 * DAY_MS) return relative.format(-Math.floor(elapsed / DAY_MS), "day");
  // Past a month the date says more than a count of days.
  return messageDayAndTime(timestamp, now).day;
}
