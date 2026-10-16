/** Times are stored in UTC and shown in the user's own locale and time zone (CLAUDE.md "Time"). */

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

/** "Oct 27, 2026, 10:00 AM" in the user's time zone (or `timeZone`). */
export function absoluteTime(iso: string, opts: { locale?: string; timeZone?: string } = {}) {
  return new Intl.DateTimeFormat(opts.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  }).format(new Date(iso));
}

/** `2026-10-30T15:00:00.000Z` (or now) → the `datetime-local` input value in the browser's zone. */
export function toLocalInput(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
