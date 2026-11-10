import { sql } from 'drizzle-orm';

import type { DbOrTx } from './client';

/**
 * FB-12 report (read only): what migration 0037 does, or did, to THIS database, and which quotes sit on a
 * market code that is no longer offered. Run it before and after deploying FB-12
 * (`pnpm --filter @ccq/db fb12:report`) and keep the output with the release notes. It never changes a row
 * and never remaps a quote: a real quote keeps its market code (it shows "(no longer offered)").
 * Quote numbers only: no customer or user names.
 */

/** The five market codes FB-12 retires, and what each became (docs/build-guide/feedback/inputs/markets.md). */
export const MARKET_OLD_TO_NEW: Readonly<
  Record<string, { suggested: string; automatic: boolean; note: string }>
> = {
  NUTRITION: {
    suggested: 'NUTRITION_WELLNESS',
    automatic: true,
    note: 'Nutrition & Wellness',
  },
  HOUSEHOLD_CHEMICAL: { suggested: 'HOME_CARE', automatic: true, note: 'Home Care' },
  PET: {
    suggested: 'HOME_CARE',
    automatic: true,
    note: 'Home Care, sub-market Pet Care (HC_PET_CARE)',
  },
  PHARMA_HEALTH: {
    suggested: 'OTC_HEALTH or CLINICAL',
    automatic: false,
    note: 'split between OTC Health and Clinical: the KAM chooses',
  },
  INDUSTRIAL_CHEMICAL: {
    suggested: 'AUTO_COMMERCIAL_CHEMICAL',
    automatic: false,
    note: 'Auto & Commercial Chemical, mostly: the KAM confirms',
  },
};

/** The strategic-fit map FB-10 seeded in the draft (market points), which migration 0037 re-keys. */
const FB10_FIT_MAP = {
  by: 'market',
  values: {
    PERSONAL_CARE: 90,
    NUTRITION: 75,
    FOOD: 75,
    PET: 75,
    BEVERAGE: 60,
    HOUSEHOLD_CHEMICAL: 50,
    INDUSTRIAL_CHEMICAL: 50,
    PHARMA_HEALTH: 20,
  },
  default: 50,
};

export type Fb12Outcome =
  'will change' | 'already done' | 'skipped: approved' | 'skipped: admin changed' | 'missing';

export interface Fb12Report {
  /** Open and closed quotes on a retired market code, with the market they would move to. */
  retiredMarketQuotes: {
    quoteNumber: string;
    market: string;
    status: string;
    stageKey: string;
    suggested: string;
    automatic: boolean;
  }[];
  /** Quotes counted by retired market code. */
  retiredMarketCounts: Record<string, number>;
  /** Each market row the migration touches, and whether it will change, is done, or is skipped. */
  markets: { code: string; active: boolean | null; version: number | null; outcome: Fb12Outcome }[];
  /** The FB-10 draft scoring model. */
  draft: { modelVersion: number | null; outcome: Fb12Outcome; detail: string };
}

const rows = async <R>(db: DbOrTx, query: ReturnType<typeof sql>) =>
  (await db.execute(query)) as unknown as R[];

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  }
  return v;
}

const KEPT = ['FOOD', 'BEVERAGE', 'PERSONAL_CARE'];
const NEW = [
  'NUTRITION_WELLNESS',
  'OTC_HEALTH',
  'CLINICAL',
  'HOME_CARE',
  'AUTO_COMMERCIAL_CHEMICAL',
];

export async function fb12Report(db: DbOrTx): Promise<Fb12Report> {
  const retired = Object.keys(MARKET_OLD_TO_NEW);
  const quotes = await rows<{
    quote_number: string;
    market: string;
    status: string;
    stage_key: string;
  }>(
    db,
    sql`select quote_number, market, status, stage_key from quote
        where market in (${sql.join(
          retired.map((c) => sql`${c}`),
          sql`, `,
        )})
        order by market, quote_number`,
  );
  const retiredMarketCounts: Record<string, number> = {};
  for (const q of quotes) retiredMarketCounts[q.market] = (retiredMarketCounts[q.market] ?? 0) + 1;

  const marketRows = await rows<{
    code: string;
    active: boolean;
    version: number;
    provisional: boolean;
    approved_at: Date | null;
  }>(
    db,
    sql`select code, active, version, provisional, approved_at from value_list where list_key = 'market'`,
  );
  const byCode = new Map(marketRows.map((r) => [r.code, r]));
  const untouched = (r: (typeof marketRows)[number]) =>
    r.provisional && r.approved_at === null && r.version === 1;
  const markets: Fb12Report['markets'] = [...KEPT, ...NEW, ...retired].map((code) => {
    const r = byCode.get(code);
    let outcome: Fb12Outcome;
    if (!r) outcome = 'missing';
    else if (NEW.includes(code)) outcome = 'already done';
    else if (KEPT.includes(code)) {
      outcome =
        !r.provisional && r.approved_at !== null
          ? 'already done'
          : untouched(r)
            ? 'will change'
            : r.approved_at
              ? 'skipped: approved'
              : 'skipped: admin changed';
    } else {
      outcome = !r.active
        ? 'already done'
        : untouched(r)
          ? 'will change'
          : r.approved_at
            ? 'skipped: approved'
            : 'skipped: admin changed';
    }
    return { code, active: r?.active ?? null, version: r?.version ?? null, outcome };
  });
  // A new market that is not there yet will be added (when the list exists at all).
  for (const m of markets) {
    if (m.outcome === 'missing' && NEW.includes(m.code) && marketRows.length > 0) {
      m.outcome = 'will change';
    }
  }

  const drafts = await rows<{
    model_version: number;
    version: number;
    provisional: boolean;
    approved_at: Date | null;
    change_reason: string;
    fit_map: unknown;
  }>(
    db,
    sql`select m.model_version, m.version, m.provisional, m.approved_at, m.change_reason,
          (select a.e->'map' from jsonb_array_elements(m.attributes) as a(e) where a.e->>'key' = 'strategic_fit') as fit_map
        from scoring_model m where m.effective_from is null`,
  );
  const d = drafts[0];
  const draft: Fb12Report['draft'] = !d
    ? {
        modelVersion: null,
        outcome: 'missing',
        detail: 'No draft: it was discarded or activated, so nothing is changed',
      }
    : (d.fit_map as { bySegment?: unknown } | null)?.bySegment
      ? {
          modelVersion: d.model_version,
          outcome: 'already done',
          detail: 'Already scores by sub-market',
        }
      : d.approved_at
        ? {
            modelVersion: d.model_version,
            outcome: 'skipped: approved',
            detail: 'The draft is approved',
          }
        : d.version === 1 &&
            d.change_reason.startsWith('FB-10') &&
            sameJson(d.fit_map, FB10_FIT_MAP)
          ? {
              modelVersion: d.model_version,
              outcome: 'will change',
              detail: 'Still exactly what FB-10 seeded: re-keyed in place to sub-market',
            }
          : {
              modelVersion: d.model_version,
              outcome: 'skipped: admin changed',
              detail: 'An Admin has edited it: left alone',
            };

  return {
    retiredMarketQuotes: quotes.map((q) => ({
      quoteNumber: q.quote_number,
      market: q.market,
      status: q.status,
      stageKey: q.stage_key,
      suggested: MARKET_OLD_TO_NEW[q.market]!.suggested,
      automatic: MARKET_OLD_TO_NEW[q.market]!.automatic,
    })),
    retiredMarketCounts,
    markets,
    draft,
  };
}

export function renderFb12Report(report: Fb12Report, at: Date): string {
  const out: string[] = [];
  out.push(`FB-12 report, ${at.toISOString()} (read only; no quote is remapped)`);
  out.push('');
  out.push('Quotes on a market code that is no longer offered (old -> suggested, from markets.md)');
  const counts = Object.entries(report.retiredMarketCounts);
  if (counts.length === 0) out.push('  none');
  for (const [code, n] of counts) {
    const m = MARKET_OLD_TO_NEW[code]!;
    out.push(
      `  ${code}: ${n} quote(s) -> ${m.note}${m.automatic ? '' : ' (no automatic mapping)'}`,
    );
  }
  for (const q of report.retiredMarketQuotes) {
    out.push(`  ${q.quoteNumber}  ${q.market}  ${q.status}/${q.stageKey}  -> ${q.suggested}`);
  }
  out.push('');
  out.push(
    'Market list rows (0037 changes only rows still provisional, unapproved and at version 1)',
  );
  for (const m of report.markets) {
    out.push(
      `  ${m.code.padEnd(26)} ${m.outcome}${m.active === null ? '' : m.active ? ' (active)' : ' (inactive)'}`,
    );
  }
  out.push('');
  out.push(
    `Draft scoring model${report.draft.modelVersion ? ` v${report.draft.modelVersion}` : ''}: ${report.draft.outcome}. ${report.draft.detail}`,
  );
  out.push('');
  return out.join('\n');
}
