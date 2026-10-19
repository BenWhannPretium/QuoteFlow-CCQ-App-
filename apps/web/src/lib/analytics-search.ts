import type { AnalyticsQueryParams } from './api';
import type { PipelineSearch } from './pipeline-search';

/**
 * B-17: the analytics page's filters live in the URL, so a link shows the same view to whoever opens it.
 * Dates are US Central calendar days (the API's); the dimensions are single values (comma-joined lists
 * from a hand-edited URL are passed through). Anything malformed is dropped, never an error.
 */
export interface AnalyticsSearch {
  from?: string | undefined;
  to?: string | undefined;
  market?: string | undefined;
  productFamily?: string | undefined;
  kam?: string | undefined;
  region?: string | undefined;
}

const DIMENSIONS = ['market', 'productFamily', 'kam', 'region'] as const;

const day = (v: unknown): string | undefined =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
const text = (v: unknown): string | undefined => {
  const raw = Array.isArray(v) ? v.join(',') : typeof v === 'string' ? v : undefined;
  const parts = raw
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts?.length ? [...new Set(parts)].join(',').slice(0, 200) : undefined;
};

export function parseAnalyticsSearch(raw: Record<string, unknown>): AnalyticsSearch {
  const out: AnalyticsSearch = {};
  const from = day(raw.from);
  const to = day(raw.to);
  if (from) out.from = from;
  if (to) out.to = to;
  for (const k of DIMENSIONS) {
    const v = text(raw[k]);
    if (v) out[k] = v;
  }
  return out;
}

export const analyticsApiQuery = (s: AnalyticsSearch): AnalyticsQueryParams => ({ ...s });

/** How many filters are set (the dates count as one). */
export const activeFilterCount = (s: AnalyticsSearch): number =>
  DIMENSIONS.filter((k) => s[k]).length + (s.from || s.to ? 1 : 0);

const addDays = (isoDay: string, n: number): string =>
  new Date(Date.parse(`${isoDay}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The last `days` days ending `today`, both inclusive. */
export const lastDays = (days: number, today: string): { from: string; to: string } => ({
  from: addDays(today, -(days - 1)),
  to: today,
});

/**
 * The B-14 quote list for a chart drill-down: the chart's own slice (`extra`) plus the dimension
 * filters the list understands. Region is an analytics filter the list does not have, so it is not
 * carried over; the dates are not either (the list filters on what a quote is now, not when it moved).
 */
export function drillDown(s: AnalyticsSearch, extra: PipelineSearch = {}): PipelineSearch {
  return {
    ...(s.market ? { market: s.market } : {}),
    ...(s.productFamily ? { productFamily: s.productFamily } : {}),
    ...(s.kam ? { kam: s.kam } : {}),
    ...extra,
  };
}
