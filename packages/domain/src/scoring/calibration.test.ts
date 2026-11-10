import { describe, expect, it } from 'vitest';

import type { ScoringFacts } from './inputs';
import { score } from './score';
import { SCORING_MODEL_V3_INPUT, scoringModelV2, scoringModelV3Draft } from './seeds';
import {
  parseVolumeRouting,
  routeByVolumeBand,
  VOLUME_ROUTING_SEED,
  workflowForRoute,
} from './volume-routing';
import {
  WHERE_TO_PLAY_BAND_POINTS,
  WHERE_TO_PLAY_SUB_MARKET_POINTS,
  WHERE_TO_PLAY_UNSCORED_SUB_MARKETS,
} from './where-to-play';
import { previewScoringChange } from '../config-admin/scoring-preview';
import { parseSettingValue } from '../config-admin/settings';
import {
  guardrailWarning,
  INTAKE_GUARDRAILS_SEED,
  parseIntakeGuardrails,
} from '../intake/guardrails';
import { evaluateIntake, parseIntakeConfig } from '../intake/intake';
import { NOW } from '../test-utils';
import { buildHybridConfig } from '../workflow/seeds/hybrid';

/**
 * FB-10 (F-005, F-073, F-066, T-011, T-025, T-036). Everything here is a PROVISIONAL, INACTIVE draft
 * (D-004 open): the live model stays v2. Hand working is next to each number.
 */

describe('scoring model v3 draft, by sub-market (F-073, F-005, FB-12)', () => {
  it('equals v2 in weights, tiers, bands and every attribute except strategic fit', () => {
    const rest = (m: typeof scoringModelV2) => ({
      tiers: m.tiers,
      unknownScore: m.unknownScore,
      attributes: m.attributes.filter((a) => a.key !== 'strategic_fit'),
    });
    expect(rest(scoringModelV3Draft)).toEqual(rest(scoringModelV2));
    const weight = (m: typeof scoringModelV2, key: string) =>
      m.attributes.find((a) => a.key === key)!.weight;
    expect(weight(scoringModelV3Draft, 'strategic_fit')).toBe(
      weight(scoringModelV2, 'strategic_fit'),
    );
    expect(SCORING_MODEL_V3_INPUT.version).toBe(3);
  });

  it('only the strategic-fit map changes: no market points, sub-market points, neutral default', () => {
    const map = (m: typeof scoringModelV2) => m.attributes.find((a) => a.key === 'strategic_fit')!;
    const fit = map(scoringModelV3Draft);
    expect(fit.input).toBe(map(scoringModelV2).input);
    expect(fit.map).toEqual({
      by: 'market',
      values: {},
      default: 50,
      bySegment: { by: 'sub_market', values: { ...WHERE_TO_PLAY_SUB_MARKET_POINTS } },
      defaultNote: 'Pick a sub-market to score strategic fit',
    });
    expect(map(scoringModelV2).map).toEqual({ by: 'market', values: {}, default: 50 });
    expect(fit.unknownExplanation).toBe(map(scoringModelV2).unknownExplanation);
  });

  it('the points are Melanie Rasche’s colours (80 / 50 / 20) for 27 sub-markets; three are unscored', () => {
    expect(WHERE_TO_PLAY_BAND_POINTS).toEqual({
      strategic_growth: 80,
      selectively_participate: 50,
      rationalization: 20,
    });
    const points = Object.values(WHERE_TO_PLAY_SUB_MARKET_POINTS);
    expect(points).toHaveLength(27);
    expect([80, 50, 20].map((p) => points.filter((x) => x === p).length)).toEqual([8, 10, 9]);
    for (const code of WHERE_TO_PLAY_UNSCORED_SUB_MARKETS) {
      expect(WHERE_TO_PLAY_SUB_MARKET_POINTS).not.toHaveProperty(code);
    }
    expect(WHERE_TO_PLAY_UNSCORED_SUB_MARKETS).toEqual([
      'CLIN_HISTOLOGY',
      'CLIN_TUBES_VIALS',
      'HC_NON_CORE',
    ]);
  });

  const base = {
    est_annual_revenue: 100_000,
    est_annual_volume: 500_000,
    quote_needed_by: '2026-12-15',
  };
  const fitOf = (model: typeof scoringModelV2, quote: Record<string, unknown>) =>
    score(model, { quote: { ...base, ...quote }, customer: null, eng_review: null }, NOW);
  const strategicFit = (r: ReturnType<typeof score>) =>
    r.breakdown.find((b) => b.key === 'strategic_fit')!;

  it('resolves a scored sub-market to 80 / 50 / 20, an unscored one and no sub-market to the neutral 50, no market to the unknown 50', () => {
    const draft = (quote: Record<string, unknown>) =>
      strategicFit(fitOf(scoringModelV3Draft, quote));
    expect(draft({ market: 'FOOD', sub_market: 'FOOD_SNACKS' })).toMatchObject({
      points: 80,
      raw: 'FOOD_SNACKS',
      unknown: false,
    });
    expect(draft({ market: 'FOOD', sub_market: 'FOOD_OILS' }).points).toBe(50);
    expect(draft({ market: 'FOOD', sub_market: 'FOOD_HONEY_SWEETENERS' }).points).toBe(20);
    for (const sub_market of ['CLIN_HISTOLOGY', 'CLIN_TUBES_VIALS', 'HC_NON_CORE', 'NOT_A_CODE']) {
      const r = draft({ market: 'CLINICAL', sub_market });
      expect(r).toMatchObject({ points: 50, unknown: false, raw: 'CLINICAL' });
      expect(r.explanation).toBe(
        'Pick a sub-market to score strategic fit (neutral default) → 50 points',
      );
    }
    const none = draft({ market: 'FOOD' });
    expect(none).toMatchObject({ points: 50, unknown: false });
    expect(none.explanation).toContain('Pick a sub-market to score strategic fit');
    const noMarket = draft({});
    expect(noMarket).toMatchObject({ points: 50, unknown: true, raw: null });
    expect(noMarket.explanation).toBe('Market not given; scored a neutral 50');
    // No market-level points: a market alone never moves the score.
    for (const market of [
      'FOOD',
      'BEVERAGE',
      'CLINICAL',
      'HOME_CARE',
      'OTC_HEALTH',
      'NUTRITION_WELLNESS',
    ]) {
      expect(draft({ market }).points).toBe(50);
    }
  });

  it('T-036: two quotes identical except sub-market score differently under the draft and identically under live v2', () => {
    const snacks = { market: 'FOOD', sub_market: 'FOOD_SNACKS' }; // Strategic Growth, 80
    const honey = { market: 'FOOD', sub_market: 'FOOD_HONEY_SWEETENERS' }; // Rationalization, 20
    const a = fitOf(scoringModelV3Draft, snacks);
    const b = fitOf(scoringModelV3Draft, honey);
    expect([strategicFit(a).points, strategicFit(b).points]).toEqual([80, 20]);
    // .15 × 80 and .15 × 20, shown in the breakdown
    expect([strategicFit(a).contribution, strategicFit(b).contribution]).toEqual([12, 3]);
    expect(a.total - b.total).toBeCloseTo(9, 5); // .15 × (80 − 20)
    expect(strategicFit(a).provisional).toBeUndefined();
    const liveA = fitOf(scoringModelV2, snacks);
    const liveB = fitOf(scoringModelV2, honey);
    expect([strategicFit(liveA).points, strategicFit(liveB).points]).toEqual([50, 50]);
    expect(liveA.total).toBe(liveB.total);
  });

  /**
   * The five F-005 golden quotes (golden.test.ts) re-scored by hand under the v3 draft. Their markets are
   * placed on the new list (the golden facts carry no sub-market). Only strategic fit moves:
   * total(v3) = total(v2) + .15 × (points(v3) − 50), because v2 scores strategic fit a neutral 50.
   *   A Food › Snacks & Confections 80:     83   + .15 × 30 = 87.5  CRITICAL (unchanged tier)
   *   B Home Care › Pet Care 20:            26   − .15 × 30 = 21.5  LOW (unchanged)
   *   C Nutrition & Wellness › VMS 80:      59   + .15 × 30 = 63.5  HIGH (was STANDARD: crosses the 60 edge)
   *   D Personal Care › Bath & Shower 80:   53   + .15 × 30 = 57.5  STANDARD (unchanged)
   *   E Nutrition & Wellness › Liquid Supplements 50: 62 + 0 = 62   HIGH (unchanged)
   * The v2 totals are the F-005 results and must not change.
   */
  const GOLDEN = [
    {
      name: 'A',
      market: 'FOOD',
      subMarket: 'FOOD_SNACKS',
      v2: 83,
      v3: 87.5,
      tier2: 'CRITICAL',
      tier3: 'CRITICAL',
      facts: {
        quote: {
          est_annual_revenue: 600_000,
          est_annual_volume: 5_000_000,
          product_family: 'BOTTLE',
          resin: 'HDPE',
          quote_needed_by: '2026-11-03',
        },
        customer: { status: 'existing' },
        eng_review: { prelim_capital_usd: 20_000 },
      },
    },
    {
      name: 'B',
      market: 'HOME_CARE',
      subMarket: 'HC_PET_CARE',
      v2: 26,
      v3: 21.5,
      tier2: 'LOW',
      tier3: 'LOW',
      facts: {
        quote: {
          est_annual_revenue: 18_000,
          est_annual_volume: 40_000,
          product_family: 'BOTTLE',
          resin: 'HDPE',
          quote_needed_by: '2027-06-01',
        },
        customer: { status: 'not_yet_established' },
        eng_review: { prelim_capital_usd: 1_500_000 },
      },
    },
    {
      name: 'C',
      market: 'NUTRITION_WELLNESS',
      subMarket: 'NW_VMS',
      v2: 59,
      v3: 63.5,
      tier2: 'STANDARD',
      tier3: 'HIGH',
      facts: {
        quote: {
          est_annual_revenue: 300_000,
          est_annual_volume: 80_000,
          product_family: 'PREFORM',
          resin: 'PET',
          quote_needed_by: '2026-12-15',
        },
        customer: { status: 'existing' },
        eng_review: null,
      },
    },
    {
      name: 'D',
      market: 'PERSONAL_CARE',
      subMarket: 'PC_BATH_SHOWER',
      v2: 53,
      v3: 57.5,
      tier2: 'STANDARD',
      tier3: 'STANDARD',
      facts: {
        quote: {
          est_annual_revenue: 24_999,
          est_annual_volume: 2_000_000,
          product_family: 'JAR',
          resin: 'PET',
          quote_needed_by: '2026-11-19',
        },
        customer: { status: 'existing' },
        eng_review: { prelim_capital_usd: 250_000 },
      },
    },
    {
      name: 'E',
      market: 'NUTRITION_WELLNESS',
      subMarket: 'NW_LIQUID_SUPPLEMENTS',
      v2: 62,
      v3: 62,
      tier2: 'HIGH',
      tier3: 'HIGH',
      facts: {
        quote: {
          est_annual_revenue: 100_000,
          est_annual_volume: 500_000,
          product_family: 'CANISTER_TUB',
          resin: 'PP',
          quote_needed_by: '2027-01-18',
        },
        customer: { status: 'existing' },
        eng_review: { prelim_capital_usd: 50_000 },
      },
    },
  ];
  const goldenFacts = (g: (typeof GOLDEN)[number]): ScoringFacts => ({
    ...g.facts,
    quote: { ...g.facts.quote, market: g.market, sub_market: g.subMarket },
  });

  it.each(GOLDEN)('golden quote $name under v2 and the v3 draft', (g) => {
    const before = score(scoringModelV2, goldenFacts(g), NOW);
    const after = score(scoringModelV3Draft, goldenFacts(g), NOW);
    expect([before.total, before.tier]).toEqual([g.v2, g.tier2]);
    expect([after.total, after.tier]).toEqual([g.v3, g.tier3]);
    // The sub-market is the only thing that moved.
    expect(after.breakdown.filter((b) => b.key !== 'strategic_fit')).toEqual(
      before.breakdown.filter((b) => b.key !== 'strategic_fit'),
    );
  });

  it('the preview shows the points moved, what moved them and the tier that changes', () => {
    const quotes = GOLDEN.map((g) => ({ id: g.name, facts: goldenFacts(g) }));
    const p = previewScoringChange(scoringModelV2, scoringModelV3Draft, quotes, NOW);
    const row = (id: string) => p.rows[quotes.findIndex((q) => q.id === id)]!;
    expect(row('C')).toMatchObject({ pointsMoved: 4.5, tierChanged: true });
    expect(row('C').drivers).toEqual([
      { key: 'strategic_fit', label: 'Strategic fit (where to play)', before: 50, after: 80 },
    ]);
    expect(row('B')).toMatchObject({ pointsMoved: -4.5, tierChanged: false });
    expect(row('E')).toMatchObject({ pointsMoved: 0, tierChanged: false, drivers: [] });
    expect(p.summary).toMatchObject({ tierChanges: 1, maxPointsDown: -4.5, maxPointsUp: 4.5 });
    // (4.5 − 4.5 + 4.5 + 4.5 + 0) / 5 = 1.8
    expect(p.summary.avgPointsMoved).toBe(1.8);
  });

  it('until a KAM picks a sub-market, every quote previews at the neutral 50 (no movement)', () => {
    const quotes = GOLDEN.map((g) => ({
      id: g.name,
      facts: { ...g.facts, quote: { ...g.facts.quote, market: g.market } },
    }));
    const p = previewScoringChange(scoringModelV2, scoringModelV3Draft, quotes, NOW);
    expect(p.rows.every((r) => r.pointsMoved === 0 && r.drivers.length === 0)).toBe(true);
    expect(p.summary.tierChanges).toBe(0);
  });
});

describe('volume-band routing (T-011)', () => {
  const on = { ...VOLUME_ROUTING_SEED, enabled: true };
  const facts = (v: unknown): ScoringFacts => ({ quote: { est_annual_volume: v } });

  it('is seeded off: nothing is routed', () => {
    expect(VOLUME_ROUTING_SEED.enabled).toBe(false);
    expect(routeByVolumeBand(VOLUME_ROUTING_SEED, facts(10))).toEqual({
      applies: false,
      route: null,
      inBand: null,
      reason: null,
    });
  });

  it('below the band goes to the sales leader; at and above the minimum goes to Engineering', () => {
    expect(routeByVolumeBand(on, facts(999_999)).route).toBe('sales_leader');
    expect(routeByVolumeBand(on, facts(1_000_000))).toMatchObject({
      route: 'engineering',
      inBand: true,
    });
    expect(routeByVolumeBand(on, facts(5_000_000)).route).toBe('engineering');
  });

  it('above a maximum goes to the sales leader too (the max is exclusive)', () => {
    const banded = { ...on, min: 1_000_000, max: 10_000_000 };
    expect(routeByVolumeBand(banded, facts(9_999_999)).route).toBe('engineering');
    expect(routeByVolumeBand(banded, facts(10_000_000)).route).toBe('sales_leader');
    expect(routeByVolumeBand(banded, facts(10_000_000)).reason).toContain(
      'outside the 1,000,000 to under 10,000,000 band',
    );
  });

  it('a missing value cannot be shown to be in the band, so a person qualifies it', () => {
    const r = routeByVolumeBand(on, facts(null));
    expect(r).toMatchObject({ route: 'sales_leader', inBand: null });
    expect(r.reason).toContain('No annual volume given');
  });

  it('the metric can be revenue (the tracker words T-011 as revenue bands)', () => {
    const revenue = { ...on, metric: 'est_annual_revenue' as const, min: 100_000, max: null };
    expect(routeByVolumeBand(revenue, { quote: { est_annual_revenue: 99_999 } }).route).toBe(
      'sales_leader',
    );
    expect(routeByVolumeBand(revenue, { quote: { est_annual_revenue: 100_000 } }).route).toBe(
      'engineering',
    );
  });

  it('turns G1 on and SUBMIT off for the sales leader route, and the reverse for Engineering', () => {
    for (const g1Enabled of [true, false]) {
      const wf = buildHybridConfig({ g1Enabled });
      const enabled = (w: typeof wf, k: string) => w.gates.find((g) => g.key === k)!.enabled;
      const toLeader = workflowForRoute(wf, routeByVolumeBand(on, facts(1)));
      expect([enabled(toLeader, 'G1'), enabled(toLeader, 'SUBMIT')]).toEqual([true, false]);
      const toEng = workflowForRoute(wf, routeByVolumeBand(on, facts(2_000_000)));
      expect([enabled(toEng, 'G1'), enabled(toEng, 'SUBMIT')]).toEqual([false, true]);
    }
  });

  it('leaves the workflow untouched when the switch is off, and never mutates it', () => {
    const wf = buildHybridConfig({ g1Enabled: true });
    expect(workflowForRoute(wf, routeByVolumeBand(VOLUME_ROUTING_SEED, facts(1)))).toBe(wf);
    workflowForRoute(wf, routeByVolumeBand(on, facts(2_000_000)));
    expect(wf.gates.find((g) => g.key === 'G1')!.enabled).toBe(true);
  });

  it('a malformed setting reads as off; the console parser rejects it', () => {
    expect(parseVolumeRouting({ enabled: 'yes' }).enabled).toBe(false);
    expect(() => parseSettingValue('g1_volume_routing', { ...on, min: 5, max: 5 })).toThrow(
      /minimum must be below/,
    );
    expect(() => parseSettingValue('g1_volume_routing', { ...on, extra: 1 })).toThrow();
    expect(parseSettingValue('g1_volume_routing', on)).toEqual(on);
  });
});

describe('platform-minimum guardrail (F-066, T-025)', () => {
  const on = { ...INTAKE_GUARDRAILS_SEED, enabled: true };

  it('is seeded off, from Danielle Leu’s corrected platform table (1M or 3M units per platform)', () => {
    expect(INTAKE_GUARDRAILS_SEED.enabled).toBe(false);
    expect(INTAKE_GUARDRAILS_SEED.minAnnualVolumeByProcess).toEqual({
      ISBM: 1_000_000,
      RHB: 1_000_000,
      IMM: 3_000_000,
      IBM: 3_000_000,
      EBM: 1_000_000,
    });
    expect(guardrailWarning(INTAKE_GUARDRAILS_SEED, { volume: 10 })).toBeNull();
  });

  it('warns below the platform minimum with the agreed words, and not at or above it', () => {
    const w = guardrailWarning(on, { volume: 2_500_000, processType: 'IMM' });
    expect(w).toMatchObject({
      code: 'BELOW_PLATFORM_MINIMUM',
      minimum: 3_000_000,
      platform: 'IMM',
    });
    expect(w!.message).toBe(
      'Below the platform minimum for IMM: 2,500,000 units/yr. You can still submit.',
    );
    expect(guardrailWarning(on, { volume: 3_000_000, processType: 'IMM' })).toBeNull();
    expect(guardrailWarning(on, { volume: 2_500_000, processType: 'ISBM' })).toBeNull(); // ISBM minimum is 1M (Danielle, 2026-11-09)
    expect(guardrailWarning(on, { volume: 2_999_999, processType: 'RHB' })).toBeNull(); // RHB minimum is 1M
  });

  it('while the platform is unknown, only a volume under every platform minimum warns', () => {
    expect(guardrailWarning(on, { volume: 1_000_000 })).toBeNull();
    const w = guardrailWarning(on, { volume: 400_000 });
    expect(w).toMatchObject({ minimum: 1_000_000, platform: null });
    expect(w!.message).toContain('our machine platforms');
  });

  it('ignores a missing or non-positive volume', () => {
    expect(guardrailWarning(on, { volume: null })).toBeNull();
    expect(guardrailWarning(on, { volume: 0 })).toBeNull();
  });

  it('a malformed setting reads as off; the console parser rejects it', () => {
    expect(parseIntakeGuardrails({ nope: 1 }).enabled).toBe(false);
    expect(() =>
      parseSettingValue('intake_guardrails', { ...on, minAnnualVolumeByProcess: { ISBM: -1 } }),
    ).toThrow();
    expect(parseSettingValue('intake_guardrails', on)).toEqual(on);
  });

  it('the intake evaluation shows it as an amber warning that never blocks the submit', () => {
    const config = parseIntakeConfig({
      requiredFields: [],
      volumePlaceholder: {},
      defaultRequestClass: 'CCQ',
      allowedRequestClasses: ['CCQ'],
      redirectMessage: 'x',
      drawingProvidedCodes: [],
      guardrails: on,
    });
    const values = { request_class: 'CCQ', est_annual_volume: 400_000, drawing_status: 'NONE' };
    const e = evaluateIntake(values, config, NOW);
    const hit = e.warnings.filter((w) => w.code === 'BELOW_PLATFORM_MINIMUM');
    expect(hit).toHaveLength(1);
    expect(hit[0]!.field).toBe('est_annual_volume');
    expect(e.blocking.some((b) => b.code === ('BELOW_PLATFORM_MINIMUM' as never))).toBe(false);
    // Off (the default): no warning.
    const { guardrails: _g, ...rest } = config;
    const off = parseIntakeConfig(rest);
    expect(
      evaluateIntake(values, off, NOW).warnings.some((w) => w.code === 'BELOW_PLATFORM_MINIMUM'),
    ).toBe(false);
  });
});
