const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** "3 d 4 h", "5 h", "< 1 h" (calendar time, for time-in-stage). */
export function formatDuration(ms: number): string {
  if (ms < HOUR) return '< 1 h';
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  if (days === 0) return `${hours} h`;
  return hours === 0 ? `${days} d` : `${days} d ${hours} h`;
}

/** "4 business days", "1 business day". */
export const businessDays = (n: number) => `${n} business day${n === 1 ? '' : 's'}`;
