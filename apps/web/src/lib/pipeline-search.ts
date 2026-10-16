import {
  QUOTE_SORT_DEFAULT_DIR,
  QUOTE_SORT_KEYS,
  type QuoteSortKey,
  type QuoteStatusFilter,
} from '@ccq/contracts';

import type { FilterValue } from '@/components/FiltersPopover';

/**
 * B-14: the pipeline views' filters live in the URL, so a link shows the same quotes to whoever opens
 * it (within their own scope). Multi-value filters are comma-joined (`stage=QUOTING,FINAL_REVIEW`):
 * readable and short. The API accepts the same keys.
 */
export const MULTI_KEYS = [
  'stage',
  'tier',
  'kam',
  'engineer',
  'productFamily',
  'market',
  'resin',
] as const;
export type MultiKey = (typeof MULTI_KEYS)[number];

const STATUSES: QuoteStatusFilter[] = ['open', 'active', 'on_hold', 'closed'];

/** Every key is optional and may be explicitly `undefined` (that clears it from the URL). */
export interface PipelineSearch extends Partial<Record<MultiKey, string | undefined>> {
  q?: string | undefined;
  status?: QuoteStatusFilter | undefined;
  agedOverDays?: number | undefined;
  closeDateFrom?: string | undefined;
  closeDateTo?: string | undefined;
  hasWarnings?: boolean | undefined;
  sfMismatch?: boolean | undefined;
  sort?: QuoteSortKey | undefined;
  dir?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
}

const text = (v: unknown, max = 200): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
const list = (v: unknown): string | undefined => {
  const raw = Array.isArray(v) ? v.join(',') : typeof v === 'string' ? v : undefined;
  const parts = raw
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts?.length ? [...new Set(parts)].join(',') : undefined;
};
const bool = (v: unknown): boolean | undefined =>
  v === true || v === 'true' ? true : v === false || v === 'false' ? false : undefined;
const int = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};
const date = (v: unknown): string | undefined =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;

/** Drop undefined keys (TanStack Router keeps `key=undefined` out of the URL, but tests compare). */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** `validateSearch` for /quotes and /board: anything unknown or malformed is dropped, never an error. */
export function parsePipelineSearch(raw: Record<string, unknown>): PipelineSearch {
  const sort = QUOTE_SORT_KEYS.includes(raw.sort as QuoteSortKey)
    ? (raw.sort as QuoteSortKey)
    : undefined;
  return compact({
    q: text(raw.q),
    ...Object.fromEntries(MULTI_KEYS.map((k) => [k, list(raw[k])])),
    status: STATUSES.includes(raw.status as QuoteStatusFilter)
      ? (raw.status as QuoteStatusFilter)
      : undefined,
    agedOverDays: int(raw.agedOverDays, 0, 3650),
    closeDateFrom: date(raw.closeDateFrom),
    closeDateTo: date(raw.closeDateTo),
    hasWarnings: bool(raw.hasWarnings),
    sfMismatch: bool(raw.sfMismatch),
    sort,
    dir: raw.dir === 'asc' || raw.dir === 'desc' ? raw.dir : undefined,
    page: int(raw.page, 1, 10_000),
  });
}

/** The API query for the list / board / export: the same keys, as strings. */
export function pipelineApiQuery(
  s: PipelineSearch,
  extra: Record<string, string | number | boolean | undefined> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...s, ...extra })) {
    if (v === undefined || v === '') continue;
    out[k] = String(v);
  }
  return out;
}

/** The checkbox-group part of the filters (the Filters popover's value). */
export function filterValueFromSearch(s: PipelineSearch): FilterValue {
  const value: FilterValue = {};
  for (const k of MULTI_KEYS) {
    const v = s[k];
    if (v) value[k] = v.split(',');
  }
  if (s.status) value.status = [s.status];
  if (s.hasWarnings !== undefined) value.hasWarnings = [String(s.hasWarnings)];
  if (s.sfMismatch !== undefined) value.sfMismatch = [String(s.sfMismatch)];
  return value;
}

/**
 * The popover's value written back to the search. Single-choice groups (status, warnings, SF
 * mismatch) keep the latest pick. Changing filters resets paging.
 */
export function searchWithFilterValue(s: PipelineSearch, value: FilterValue): PipelineSearch {
  const last = (key: string) => value[key]?.[value[key].length - 1];
  const status = last('status') as QuoteStatusFilter | undefined;
  return compact({
    ...s,
    ...Object.fromEntries(
      MULTI_KEYS.map((k) => [k, value[k]?.length ? value[k].join(',') : undefined]),
    ),
    status,
    hasWarnings: bool(last('hasWarnings')),
    sfMismatch: bool(last('sfMismatch')),
    page: undefined,
  });
}

/** How many filters are set (the "Filters (n)" count also covers aging and the close-date range). */
export function activePipelineFilterCount(s: PipelineSearch): number {
  const multi = MULTI_KEYS.reduce((n, k) => n + (s[k] ? s[k].split(',').length : 0), 0);
  return (
    multi +
    [s.status, s.agedOverDays, s.closeDateFrom, s.closeDateTo, s.hasWarnings, s.sfMismatch].filter(
      (v) => v !== undefined,
    ).length
  );
}

/** The search without any filter (search text, sort and view-specific keys kept). */
export function clearPipelineFilters(s: PipelineSearch): PipelineSearch {
  return compact({ q: s.q, sort: s.sort, dir: s.dir });
}

export function sortDirFor(
  s: PipelineSearch,
  fallback: QuoteSortKey,
): ['asc' | 'desc', QuoteSortKey] {
  const sort = s.sort ?? fallback;
  return [s.dir ?? QUOTE_SORT_DEFAULT_DIR[sort], sort];
}
