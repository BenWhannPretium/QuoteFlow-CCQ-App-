/** Chart and tile formatting. A missing value is an en dash, never 0: "no data" is not "zero". */
export const DASH = '–';

export const fmtCount = (v: number | null | undefined) =>
  v === null || v === undefined ? DASH : new Intl.NumberFormat('en-US').format(v);

export const fmtPct = (v: number | null | undefined) =>
  v === null || v === undefined ? DASH : `${Math.round(v * 1000) / 10}%`;

export const fmtDays = (v: number | null | undefined) =>
  v === null || v === undefined ? DASH : `${Math.round(v * 10) / 10} d`;

const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const usdFull = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
export const fmtUsdCompact = (v: number | null | undefined) =>
  v === null || v === undefined ? DASH : usdCompact.format(v);
export const fmtUsd = (v: number | null | undefined) =>
  v === null || v === undefined ? DASH : usdFull.format(v);

/** "Oct 12" for a week starting 2026-10-12 (a calendar day: no time zone shifts it). */
export function weekLabel(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, d)));
}

/** "Oct 12 – Oct 18, 2026" style range from two calendar days. */
export function dayRange(from: string, to: string): string {
  return `${weekLabel(from)} – ${weekLabel(to)}, ${to.slice(0, 4)}`;
}
