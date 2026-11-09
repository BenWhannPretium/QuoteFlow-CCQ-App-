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
import { WHERE_TO_PLAY_MARKET_POINTS } from './where-to-play';
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

const MARKET_CODES = [
  'FOOD',
  'BEVERAGE',
  'NUTRITION',
  'PERSONAL_CARE',
  'HOUSEHOLD_CHEMICAL',
  'PHARMA_HEALTH',
  'INDUSTRIAL_CHEMICAL',
  'PET',
];

describe('scoring model v3 draft (F-073, F-005)', () => {
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

  it('the points cover every market in the list, from the 9-box example (provisional)', () => {
    expect(Object.keys(WHERE_TO_PLAY_MARKET_POINTS).sort()).toEqual([...MARKET_CODES].sort());
    expect(WHERE_TO_PLAY_MARKET_POINTS).toEqual({
      PERSONAL_CARE: 90, // Strategic Growth (1)
      NUTRITION: 75, // Strategic Growth (2)
      FOOD: 75,
      PET: 75,
      BEVERAGE: 60, // Strategic Growth (3)
      HOUSEHOLD_CHEMICAL: 50, // Selectively Participate
      INDUSTRIAL_CHEMICAL: 50,
      PHARMA_HEALTH: 20, // Rationalization
    });
  });

  it('T-036: two otherwise identical quotes in different markets score differently, shown in the breakdown', () => {
    const base = {
      est_annual_revenue: 100_000,
      est_annual_volume: 500_000,
      quote_needed_by: '2026-12-15',
    };
    const fit = (market: string) =>
      score(
        scoringModelV3Draft,
        { quote: { ...base, market }, customer: null, eng_review: null },
        NOW,
      ).breakdown.find((b) => b.key === 'strategic_fit')!;
    const care = fit('PERSONAL_CARE');
    const pharma = fit('PHARMA_HEALTH');
    expect([care.points, pharma.points]).toEqual([90, 20]);
    expect([care.contribution, pharma.contribution]).toEqual([13.5, 3]); // .15 × 90 and .15 × 20
    expect(care.raw).toBe('PERSONAL_CARE');
    expect(care.provisional).toBeUndefined();
    // The live model is still neutral for both.
    const live = score(
      scoringModelV2,
      { quote: { ...base, market: 'PERSONAL_CARE' }, customer: null, eng_review: null },
      NOW,
    );
    expect(live.breakdown.find((b) => b.key === 'strategic_fit')!.points).toBe(50);
  });

  /**
   * The five F-005 golden quotes (golden.test.ts) re-scored by hand under v3. Only strategic fit moves:
   * total(v3) = total(v2) + .15 × (points(v3) − 50).
   *   A FOOD 75:               83   + .15 × 25 = 86.75 → 86.8 CRITICAL (unchanged tier)
   *   B HOUSEHOLD_CHEMICAL 50: 26   + 0        = 26    LOW (unchanged)
   *   C BEVERAGE 60:           59   + .15 × 10 = 60.5  HIGH (was STANDARD: crosses the 60 edge)
   *   D PERSONAL_CARE 90:      53   + .15 × 40 = 59    STANDARD (unchanged)
   *   E NUTRITION 75:          62   + .15 × 25 = 65.75 → 65.8 HIGH (unchanged tier)
   */
  const GOLDEN = [
    {
      name: 'A',
      market: 'FOOD',
      v2: 83,
      v3: 86.8,
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
      market: 'HOUSEHOLD_CHEMICAL',
      v2: 26,
      v3: 26,
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
      market: 'BEVERAGE',
      v2: 59,
      v3: 60.5,
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
      v2: 53,
      v3: 59,
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
      market: 'NUTRITION',
      v2: 62,
      v3: 65.8,
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

  it.each(GOLDEN)('golden quote $name under v2 and the v3 draft', (g) => {
    const facts: ScoringFacts = { ...g.facts, quote: { ...g.facts.quote, market: g.market } };
    const before = score(scoringModelV2, facts, NOW);
    const after = score(scoringModelV3Draft, facts, NOW);
    expect([before.total, before.tier]).toEqual([g.v2, g.tier2]);
    expect([after.total, after.tier]).toEqual([g.v3, g.tier3]);
  });

  it('the preview shows the points moved, what moved them and the tier that changes', () => {
    const quotes = GOLDEN.map((g) => ({
      id: g.name,
      facts: { ...g.facts, quote: { ...g.facts.quote, market: g.market } },
    }));
    const p = previewScoringChange(scoringModelV2, scoringModelV3Draft, quotes, NOW);
    const row = (id: string) => p.rows[quotes.findIndex((q) => q.id === id)]!;
    expect(row('C')).toMatchObject({ pointsMoved: 1.5, tierChanged: true });
    expect(row('C').drivers).toEqual([
      { key: 'strategic_fit', label: 'Strategic fit (where to play)', before: 50, after: 60 },
    ]);
    expect(row('B')).toMatchObject({ pointsMoved: 0, tierChanged: false, drivers: [] });
    expect(row('D').pointsMoved).toBe(6);
    expect(p.summary).toMatchObject({ tierChanges: 1, maxPointsDown: 0, maxPointsUp: 6 });
    // (3.8 + 0 + 1.5 + 6 + 3.8) / 5 = 3.02 → 3
    expect(p.summary.avgPointsMoved).toBe(3);
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

  it('is seeded off, from the platform guide (1M or 3M units per platform)', () => {
    expect(INTAKE_GUARDRAILS_SEED.enabled).toBe(false);
    expect(INTAKE_GUARDRAILS_SEED.minAnnualVolumeByProcess).toEqual({
      ISBM: 3_000_000,
      RHB: 1_000_000,
      IMM: 1_000_000,
      IBM: 3_000_000,
      EBM: 1_000_000,
    });
    expect(guardrailWarning(INTAKE_GUARDRAILS_SEED, { volume: 10 })).toBeNull();
  });

  it('warns below the platform minimum with the agreed words, and not at or above it', () => {
    const w = guardrailWarning(on, { volume: 500_000, processType: 'ISBM' });
    expect(w).toMatchObject({
      code: 'BELOW_PLATFORM_MINIMUM',
      minimum: 3_000_000,
      platform: 'ISBM',
    });
    expect(w!.message).toBe(
      'Below the platform minimum for ISBM: 500,000 units/yr. You can still submit.',
    );
    expect(guardrailWarning(on, { volume: 3_000_000, processType: 'ISBM' })).toBeNull();
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
