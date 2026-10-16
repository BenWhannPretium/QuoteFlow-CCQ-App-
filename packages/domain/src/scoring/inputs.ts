import type { ScoringAttribute } from './model';

/**
 * What the scorer knows about a quote, grouped by source, e.g.
 * `{ quote: { est_annual_revenue, market, expected_close_date, … }, customer: { status }, eng_review: { prelim_capital_usd } }`.
 * The service layer assembles it; a missing or null value means "unknown".
 */
export type ScoringFacts = Readonly<Record<string, unknown>>;

export interface InputResolution {
  /** The value the attribute was scored on (null = unknown). */
  raw: string | number | null;
  /** Set by resolvers that map straight to points (`map`); otherwise the attribute's bands decide. */
  points?: number;
  /** Extra words for the explanation, e.g. "45 days to expected close". */
  detail?: string;
}

export interface InputResolver {
  /** True when the resolver yields points itself (the attribute needs a `map`, not `bands`). */
  mapsToPoints?: boolean;
  resolve(attribute: ScoringAttribute, facts: ScoringFacts, now: Date): InputResolution;
}

/** `market` means `quote.market`; dotted paths are used as written. */
export function getFact(facts: ScoringFacts, path: string): unknown {
  const parts = path.includes('.') ? path.split('.') : ['quote', path];
  let value: unknown = facts;
  for (const part of parts) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Whole days from `now` (UTC calendar day) to `date`; negative when the date has passed. */
export function daysUntil(date: unknown, now: Date): number | null {
  let target: number;
  if (date instanceof Date) {
    target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  } else if (typeof date === 'string' && ISO_DATE.test(date)) {
    const [, y, m, d] = ISO_DATE.exec(date)!;
    target = Date.UTC(Number(y), Number(m) - 1, Number(d));
  } else {
    return null;
  }
  if (Number.isNaN(target)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / DAY_MS);
}

function code(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** Any `input` that is not a registered resolver: the numeric fact at that path. */
export const factPathResolver: InputResolver = {
  resolve: (attribute, facts) => ({ raw: toNumber(getFact(facts, attribute.input)) }),
};

/**
 * Input resolvers by name. To add a new kind of input (e.g. "days in stage"), add an entry here;
 * models then reference it by name with no other code change.
 */
export const INPUT_RESOLVERS: Readonly<Record<string, InputResolver>> = {
  /** Code lookup: `map.by` is one fact path or several joined with `+` (all must be known). */
  map: {
    mapsToPoints: true,
    resolve: (attribute, facts) => {
      const map = attribute.map!;
      const parts = map.by.split('+').map((p) => code(getFact(facts, p.trim())));
      if (parts.some((p) => p === null)) return { raw: null };
      const raw = parts.join('+');
      if (raw in map.values) return { raw, points: map.values[raw]! };
      if (map.default !== undefined) return { raw, points: map.default, detail: 'not listed' };
      return { raw: null, detail: `"${raw}" is not listed` };
    },
  },
  /** Days from today to `quote.expected_close_date`; banded. */
  days_to_close: {
    resolve: (_attribute, facts, now) => {
      const days = daysUntil(getFact(facts, 'quote.expected_close_date'), now);
      return { raw: days };
    },
  },
};

export function resolverFor(input: string): InputResolver {
  return INPUT_RESOLVERS[input] ?? factPathResolver;
}
