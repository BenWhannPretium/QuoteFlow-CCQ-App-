import { proposalCalendarDate } from '../final-review/release';

/** The to-qualify digest goes out at 7:00 US Central (B-18; the hour is a constant, not a business rule). */
export const DIGEST_HOUR_CENTRAL = 7;
/**
 * A restart or an outage at 7:00 still sends the day's digest, but only until this many hours later:
 * a digest that arrives mid-afternoon, or a second one because something was added after 7:00, is noise.
 */
export const DIGEST_CATCHUP_HOURS = 3;

/** US Central wall-clock hour (0–23) of an instant. */
export function centralHour(now: Date): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(now);
  return Number(hour);
}

/**
 * The digest for the US Central day of `now` is due from 7:00 until the catch-up window closes.
 * Returns that day's `YYYY-MM-DD` (the dedupe key, so a restart or a second instance never sends it
 * twice), or null outside the window.
 */
export function dueDigestDay(now: Date): string | null {
  const hour = centralHour(now);
  return hour >= DIGEST_HOUR_CENTRAL && hour < DIGEST_HOUR_CENTRAL + DIGEST_CATCHUP_HOURS
    ? proposalCalendarDate(now)
    : null;
}
