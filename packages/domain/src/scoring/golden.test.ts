import { describe, expect, it } from 'vitest';

import { NOW } from '../test-utils';
import type { ScoringFacts } from './inputs';
import { parseScoringModel } from './model';
import { score } from './score';
import { SCORING_MODEL_V1_INPUT, scoringModelV1, scoringModelV2 } from './seeds';

/**
 * FB-04 (F-005): "is the score calculating correctly?" Five representative quotes, scored BY HAND from
 * SCORING_MODEL_V1 (weights revenue .20, volume .15, strategic_fit .15, capital .15, customer_risk .10,
 * product_fit .15, timing .10; tiers CRITICAL >= 80, HIGH >= 60, STANDARD >= 40, LOW below).
 * The working is next to each quote. The weights and bands are provisional (D-004, FB-10) and are NOT
 * changed here; if FB-10 changes them, this file is the thing to update, by hand.
 *
 * Reference points (today = NOW = 2026-10-20, UTC calendar days):
 *   revenue  : <25k 10 | 25k-<100k 40 | 100k-<250k 70 | 250k+ 100
 *   volume   : <100k 10 | 100k-<500k 40 | 500k-<2M 70 | 2M+ 100
 *   capital  : known: <50k 100 | 50k-<250k 70 | 250k-<1M 40 | 1M+ 10 (inverse of 0/30/60/90); unknown 50
 *   customer : existing 80 | not yet established 40
 *   timing   : <30 days 100 | 30-<90 70 | 90-<180 40 | 180+ 20
 *   strategic_fit and product_fit: empty maps, so every known value scores the default 50 (F-073, D-004)
 */

interface GoldenQuote {
  name: string;
  quote: Record<string, unknown>;
  /** Days from NOW to the close / need-by date, written out so the timing points are checkable. */
  customer: Record<string, unknown> | null;
  eng: Record<string, unknown> | null;
  /** attribute → [points, contribution] */
  expected: Record<string, [number, number]>;
  total: number;
  tier: string;
}

const GOLDEN: GoldenQuote[] = [
  {
    // Strong on every measurable input.
    name: 'A: big, near-term, existing customer, low capital',
    quote: {
      est_annual_revenue: 600_000, // 250k+ → 100
      est_annual_volume: 5_000_000, // 2M+ → 100
      market: 'FOOD', // not listed → 50
      product_family: 'BOTTLE',
      resin: 'HDPE', // BOTTLE+HDPE not listed → 50
      date: '2026-11-03', // 14 days → 100
    },
    customer: { status: 'existing' }, // 80
    eng: { prelim_capital_usd: 20_000 }, // <50k → base 0 → inverse 100
    expected: {
      revenue: [100, 20], // .20 × 100
      volume: [100, 15], // .15 × 100
      strategic_fit: [50, 7.5], // .15 × 50
      capital_exposure: [100, 15], // .15 × 100
      customer_risk: [80, 8], // .10 × 80
      product_fit: [50, 7.5], // .15 × 50
      timing: [100, 10], // .10 × 100
    },
    total: 83, // 20 + 15 + 7.5 + 15 + 8 + 7.5 + 10
    tier: 'CRITICAL',
  },
  {
    // Weak on every measurable input.
    name: 'B: small, far out, new customer, heavy capital',
    quote: {
      est_annual_revenue: 18_000, // <25k → 10
      est_annual_volume: 40_000, // <100k → 10
      market: 'HOUSEHOLD_CHEMICAL',
      product_family: 'BOTTLE',
      resin: 'HDPE',
      date: '2027-06-01', // 224 days → 20
    },
    customer: { status: 'not_yet_established' }, // 40
    eng: { prelim_capital_usd: 1_500_000 }, // 1M+ → base 90 → inverse 10
    expected: {
      revenue: [10, 2],
      volume: [10, 1.5],
      strategic_fit: [50, 7.5],
      capital_exposure: [10, 1.5],
      customer_risk: [40, 4],
      product_fit: [50, 7.5],
      timing: [20, 2],
    },
    total: 26, // 2 + 1.5 + 7.5 + 1.5 + 4 + 7.5 + 2
    tier: 'LOW',
  },
  {
    // Strong revenue, weak volume, capital not known until Engineering Review → neutral 50 (not inverted).
    name: 'C: strong revenue, weak volume, capital unknown (one point under HIGH)',
    quote: {
      est_annual_revenue: 300_000, // 100
      est_annual_volume: 80_000, // 10
      market: 'BEVERAGE',
      product_family: 'PREFORM',
      resin: 'PET',
      date: '2026-12-15', // 56 days → 70
    },
    customer: { status: 'existing' }, // 80
    eng: null, // capital unknown → 50
    expected: {
      revenue: [100, 20],
      volume: [10, 1.5],
      strategic_fit: [50, 7.5],
      capital_exposure: [50, 7.5],
      customer_risk: [80, 8],
      product_fit: [50, 7.5],
      timing: [70, 7],
    },
    total: 59, // 20 + 1.5 + 7.5 + 7.5 + 8 + 7.5 + 7 → STANDARD, 1 below the HIGH edge
    tier: 'STANDARD',
  },
  {
    // Band edges: the max of a band is exclusive, the min inclusive.
    name: 'D: revenue 24,999 vs volume exactly 2,000,000, capital exactly 250,000, exactly 30 days',
    quote: {
      est_annual_revenue: 24_999, // <25k → 10
      est_annual_volume: 2_000_000, // 2M is the min of the top band → 100
      market: 'PERSONAL_CARE',
      product_family: 'JAR',
      resin: 'PET',
      date: '2026-11-19', // exactly 30 days → band 30-<90 → 70
    },
    customer: { status: 'existing' }, // 80
    eng: { prelim_capital_usd: 250_000 }, // 250k is the min of 250k-<1M → base 60 → inverse 40
    expected: {
      revenue: [10, 2],
      volume: [100, 15],
      strategic_fit: [50, 7.5],
      capital_exposure: [40, 6],
      customer_risk: [80, 8],
      product_fit: [50, 7.5],
      timing: [70, 7],
    },
    total: 53, // 2 + 15 + 7.5 + 6 + 8 + 7.5 + 7 → STANDARD
    tier: 'STANDARD',
  },
  {
    // Mid-size, every band at its lower edge.
    name: 'E: mid-size, every band at its lower edge',
    quote: {
      est_annual_revenue: 100_000, // min of 100k-<250k → 70
      est_annual_volume: 500_000, // min of 500k-<2M → 70
      market: 'NUTRITION',
      product_family: 'CANISTER_TUB',
      resin: 'PP',
      date: '2027-01-18', // exactly 90 days → band 90-<180 → 40
    },
    customer: { status: 'existing' }, // 80
    eng: { prelim_capital_usd: 50_000 }, // min of 50k-<250k → base 30 → inverse 70
    expected: {
      revenue: [70, 14],
      volume: [70, 10.5],
      strategic_fit: [50, 7.5],
      capital_exposure: [70, 10.5],
      customer_risk: [80, 8],
      product_fit: [50, 7.5],
      timing: [40, 4],
    },
    total: 62, // 14 + 10.5 + 7.5 + 10.5 + 8 + 7.5 + 4 → HIGH
    tier: 'HIGH',
  },
];

const factsFor = (
  g: GoldenQuote,
  dateKey: 'expected_close_date' | 'quote_needed_by',
): ScoringFacts => {
  const { date, ...rest } = g.quote;
  return { quote: { ...rest, [dateKey]: date }, customer: g.customer, eng_review: g.eng };
};

describe.each([
  ['v1 (timing reads the Salesforce close date)', scoringModelV1, 'expected_close_date'],
  ['v2 (FB-02: timing reads the KAM "Quote needed by")', scoringModelV2, 'quote_needed_by'],
] as const)('golden scores, scoring model %s', (_label, model, dateKey) => {
  it.each(GOLDEN)('$name', (g) => {
    const result = score(model, factsFor(g, dateKey), NOW);
    for (const item of result.breakdown) {
      const [points, contribution] = g.expected[item.key]!;
      expect(item.points, `${item.key} points`).toBe(points);
      expect(item.contribution, `${item.key} contribution`).toBe(contribution);
    }
    expect(result.total).toBe(g.total);
    expect(result.tier).toBe(g.tier);
  });

  it('the hand weights are the seed weights (so this file fails if they change without a re-check)', () => {
    const weights = Object.fromEntries(model.attributes.map((a) => [a.key, a.weight]));
    expect(weights).toEqual({
      revenue: 0.2,
      volume: 0.15,
      strategic_fit: 0.15,
      capital_exposure: 0.15,
      customer_risk: 0.1,
      product_fit: 0.15,
      timing: 0.1,
    });
    expect(model.tiers.map((t) => [t.key, t.min])).toEqual([
      ['CRITICAL', 80],
      ['HIGH', 60],
      ['STANDARD', 40],
      ['LOW', 0],
    ]);
  });
});

describe('F-005 findings', () => {
  it('a quote with only a Quote needed by date has its timing driven by that date under the current model', () => {
    const base = { est_annual_revenue: 100_000, est_annual_volume: 500_000, market: 'FOOD' };
    const soon = score(
      scoringModelV2,
      { quote: { ...base, quote_needed_by: '2026-11-01' }, customer: null, eng_review: null },
      NOW,
    );
    const late = score(
      scoringModelV2,
      { quote: { ...base, quote_needed_by: '2027-08-01' }, customer: null, eng_review: null },
      NOW,
    );
    expect(soon.breakdown.find((b) => b.key === 'timing')!.points).toBe(100);
    expect(late.breakdown.find((b) => b.key === 'timing')!.points).toBe(20);
    expect(soon.total).toBeGreaterThan(late.total);
  });

  it('floating-point weights never push a total off its hand value (no 82.99999 or 59.00000001)', () => {
    for (const g of GOLDEN) {
      const total = score(scoringModelV1, factsFor(g, 'expected_close_date'), NOW).total;
      expect(Number.isInteger(total * 10)).toBe(true);
    }
  });

  it('the seed model parses as written', () => {
    expect(() => parseScoringModel(SCORING_MODEL_V1_INPUT)).not.toThrow();
  });
});
