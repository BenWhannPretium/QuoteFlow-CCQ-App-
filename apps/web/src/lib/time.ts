/**
 * Times are stored in UTC. DR-kam-sales-leader-13: they are shown in ONE style, in US Central (Pretium HQ,
 * CLAUDE.md "Time"), with the zone named ("Nov 10, 2026, 4:03 PM CST"), whatever the browser's zone.
 * Calendar dates (need-by, review, validity) are shown as "Nov 30, 2026".
 */

/** Pretium HQ's time zone: every time on screen is shown here, with its name. */
export const DISPLAY_TIME_ZONE = 'America/Chicago';

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "3 hours ago", "in 2 days", "just now". */
export function relativeTime(iso: string, now: Date = new Date(), locale?: string): string {
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  if (abs < 45_000) return 'just now';
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, ms] of UNITS) {
    if (abs >= ms || unit === 'minute') return fmt.format(Math.round(diff / ms), unit);
  }
  return fmt.format(Math.round(diff / 60_000), 'minute');
}

/** "Oct 27, 2026, 10:00 AM CDT": US Central (or `timeZone`), with the zone named. */
export function absoluteTime(iso: string, opts: { locale?: string; timeZone?: string } = {}) {
  const d = new Date(iso);
  const timeZone = opts.timeZone ?? DISPLAY_TIME_ZONE;
  const text = new Intl.DateTimeFormat(opts.locale ?? 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(d);
  const zone =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(d)
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
  return zone ? `${text} ${zone}` : text;
}

/**
 * A calendar date (`YYYY-MM-DD`, no time of day) as "Nov 30, 2026" (DR-kam-sales-leader-13). It is a
 * date, not an instant, so it is never shifted by a time zone. Anything else is returned as it is.
 */
export function calendarDate(ymd: string | null | undefined, fallback = ''): string {
  if (!ymd) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${ymd}T12:00:00Z`),
  );
}

/** Today's calendar date in US Central (`YYYY-MM-DD`), e.g. the earliest review date a hold accepts. */
export function todayCentral(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TIME_ZONE }).format(now);
}

/** `2026-10-30T15:00:00.000Z` (or now) → the `datetime-local` input value in the browser's zone. */
export function toLocalInput(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
