import { describe, expect, it } from 'vitest';

import { DomainError } from '../errors';
import { NOW, KAM_ID, makeActor } from '../test-utils';
import { daysUntil, getFact, INPUT_RESOLVERS, toNumber } from './inputs';
import type { ScoringFacts } from './inputs';
import { parseScoringModel, validateScoringModel } from './model';
import type { ScoringModelInput } from './model';
import {
  exceptionNoteErrors,
  parseQualificationSettings,
  qualificationWarnings,
} from './qualification';
import { redactScore, score, tierFor } from './score';
import { SCORING_MODEL_V1_INPUT, scoringModelV1 } from './seeds';
import { canSeePriorityScore } from './visibility';

// NOW = 2026-10-20T15:00Z
const facts = (
  quote: Record<string, unknown>,
  customer: Record<string, unknown> | null = { status: 'existing' },
  engReview: Record<string, unknown> | null = null,
): ScoringFacts => ({ quote, customer, eng_review: engReview });

/** Ten representative quotes, from a big near-term opportunity to a near-empty intake. */
const FIXTURES: Record<string, ScoringFacts> = {
  '01 big, existing customer, closing in 2 weeks': facts({
    est_annual_revenue: 600_000,
    est_annual_volume: 5_000_000,
    market: 'FOOD',
    product_family: 'BOTTLE',
    resin: 'HDPE',
    expected_close_date: '2026-11-03',
  }),
  '02 mid-size, new customer, 2 months out': facts(
    {
      est_annual_revenue: 150_000,
      est_annual_volume: 750_000,
      market: 'PERSONAL_CARE',
      product_family: 'JAR',
      resin: 'PET',
      expected_close_date: '2026-12-20',
    },
    { status: 'not_yet_established' },
  ),
  '03 the $18k example (below a mold set)': facts({
    est_annual_revenue: 18_000,
    est_annual_volume: 40_000,
    market: 'HOUSEHOLD_CHEMICAL',
    product_family: 'BOTTLE',
    resin: 'HDPE',
    expected_close_date: '2027-03-01',
  }),
  '04 after G2: low capital': facts(
    {
      est_annual_revenue: 300_000,
      est_annual_volume: 1_200_000,
      market: 'BEVERAGE',
      product_family: 'PREFORM',
      resin: 'PET',
      expected_close_date: '2026-11-30',
    },
    { status: 'existing' },
    { prelim_capital_usd: 20_000, process_type: 'ISBM' },
  ),
  '05 after G2: heavy capital': facts(
    {
      est_annual_revenue: 300_000,
      est_annual_volume: 1_200_000,
      market: 'BEVERAGE',
      product_family: 'PREFORM',
      resin: 'PET',
      expected_close_date: '2026-11-30',
    },
    { status: 'existing' },
    { prelim_capital_usd: 1_500_000, process_type: 'ISBM' },
  ),
  '06 close date already passed': facts({
    est_annual_revenue: 90_000,
    est_annual_volume: 300_000,
    market: 'PHARMA_HEALTH',
    product_family: 'BOTTLE',
    resin: 'PP',
    expected_close_date: '2026-09-01',
  }),
  '07 revenue only (volume and close date missing)': facts({
    est_annual_revenue: 400_000,
    market: 'NUTRITION',
    product_family: 'CANISTER_TUB',
    resin: 'PP',
  }),
  '08 volume only, numeric strings from Postgres': facts({
    est_annual_volume: '2500000',
    est_annual_revenue: null,
    market: 'INDUSTRIAL_CHEMICAL',
    product_family: 'HANDLEWARE',
    resin: 'HDPE',
    expected_close_date: '2027-08-15',
  }),
  '09 band edges (exactly 25k / 100k / 30 days)': facts({
    est_annual_revenue: 25_000,
    est_annual_volume: 100_000,
    market: 'PET',
    product_family: 'CLOSURE',
    resin: 'PP',
    expected_close_date: '2026-11-19',
  }),
  '10 near-empty intake, unknown customer': facts({}, null),
};

describe('score() on the v1 seed model', () => {
  it.each(Object.entries(FIXTURES))('%s', (_name, f) => {
    const result = score(scoringModelV1, f, NOW);
    expect(result).toMatchSnapshot();
    // Invariants on every fixture
    const sum = result.breakdown.reduce((acc, b) => acc + b.weight * b.points, 0);
    expect(result.total).toBeCloseTo(sum, 1);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
    expect(result.modelVersion).toBe(1);
  });

  it('is deterministic', () => {
    for (const f of Object.values(FIXTURES)) {
      expect(score(scoringModelV1, f, NOW)).toEqual(score(scoringModelV1, f, NOW));
    }
  });

  it('lists capital exposure as unknown until Engineering Review and scores it neutral', () => {
    const before = score(
      scoringModelV1,
      FIXTURES['01 big, existing customer, closing in 2 weeks']!,
      NOW,
    );
    expect(before.unknowns).toEqual(['capital_exposure']);
    const capital = before.breakdown.find((b) => b.key === 'capital_exposure')!;
    expect(capital).toMatchObject({ raw: null, points: 50, unknown: true, sensitive: true });
    expect(capital.explanation).toContain('Capital exposure unknown until Engineering Review');
  });

  it('inverts capital: more capital, fewer points, lower total', () => {
    const low = score(scoringModelV1, FIXTURES['04 after G2: low capital']!, NOW);
    const high = score(scoringModelV1, FIXTURES['05 after G2: heavy capital']!, NOW);
    expect(low.breakdown.find((b) => b.key === 'capital_exposure')!.points).toBe(100);
    expect(high.breakdown.find((b) => b.key === 'capital_exposure')!.points).toBe(10);
    expect(low.total).toBeGreaterThan(high.total);
    expect(low.unknowns).toEqual([]);
  });

  it('a near-empty intake scores every attribute as unknown', () => {
    const r = score(scoringModelV1, FIXTURES['10 near-empty intake, unknown customer']!, NOW);
    expect(r.unknowns).toHaveLength(7);
    expect(r.total).toBe(50);
    expect(r.tier).toBe('STANDARD');
  });

  it('band edges: min inclusive, max exclusive', () => {
    const r = score(scoringModelV1, FIXTURES['09 band edges (exactly 25k / 100k / 30 days)']!, NOW);
    const by = (k: string) => r.breakdown.find((b) => b.key === k)!;
    expect(by('revenue').points).toBe(40);
    expect(by('volume').points).toBe(40);
    expect(by('timing')).toMatchObject({ raw: 30, points: 70 });
  });
});

describe('tiers', () => {
  it('picks the highest tier whose min is reached', () => {
    const tiers = scoringModelV1.tiers;
    expect(tierFor(tiers, 80).key).toBe('CRITICAL');
    expect(tierFor(tiers, 79.9).key).toBe('HIGH');
    expect(tierFor(tiers, 40).key).toBe('STANDARD');
    expect(tierFor(tiers, 0).key).toBe('LOW');
  });

  it('uses the key as the label when no label is configured', () => {
    const model = parseScoringModel({
      ...SCORING_MODEL_V1_INPUT,
      tiers: [{ key: 'ONLY', min: 0 }],
    });
    expect(score(model, {}, NOW)).toMatchObject({ tier: 'ONLY', tierLabel: 'ONLY' });
  });
});

describe('model validation', () => {
  const withAttrs = (attributes: ScoringModelInput['attributes']): ScoringModelInput => ({
    ...SCORING_MODEL_V1_INPUT,
    attributes,
  });

  it('accepts the v1 seed (weights sum to 1)', () => {
    expect(validateScoringModel(scoringModelV1)).toEqual([]);
  });

  it('rejects weights that do not sum to 1', () => {
    const attrs = SCORING_MODEL_V1_INPUT.attributes.map((a) =>
      a.key === 'revenue' ? { ...a, weight: 0.3 } : a,
    );
    expect(() => parseScoringModel(withAttrs(attrs))).toThrow(/sum to 1 \(they sum to 1\.1\)/);
  });

  it('rejects schema errors with a path', () => {
    expect(() => parseScoringModel({ version: 0, attributes: [], tiers: [] })).toThrow(DomainError);
    expect(() => parseScoringModel({ version: 0, attributes: [], tiers: [] })).toThrow(/version/);
  });

  it('reports duplicates, missing maps/bands, inverted bands and a tier floor', () => {
    const errors = validateScoringModel(
      parseScoringModelLoose({
        version: 2,
        attributes: [
          { key: 'a', label: 'A', weight: 0.5, input: 'map' },
          { key: 'a', label: 'A2', weight: 0.25, input: 'quote.x' },
          { key: 'b', label: 'B', weight: 0.25, input: 'quote.y', bands: [[10, 5, 50]] },
        ],
        tiers: [
          { key: 'T', min: 10 },
          { key: 'T', min: 20 },
        ],
      }),
    ).map((e) => e.message);
    expect(errors).toEqual([
      'Attribute "a" uses input "map" but has no map',
      'Duplicate scoring attribute "a"',
      'Attribute "a" needs bands for input "quote.x"',
      'Attribute "b" has a band whose min (10) is not below its max (5)',
      'Duplicate scoring tier key',
      'One scoring tier must start at 0',
    ]);
  });
});

/** Schema-parse only (no consistency check), to feed `validateScoringModel` directly. */
function parseScoringModelLoose(input: ScoringModelInput) {
  try {
    return parseScoringModel(input);
  } catch {
    // parseScoringModel validates too; rebuild the parsed shape without the consistency step.
    return {
      unknownScore: 50,
      provisional: true,
      ...input,
      attributes: input.attributes.map((a) => ({ inverse: false, provisional: true, ...a })),
    } as ReturnType<typeof parseScoringModel>;
  }
}

describe('a different attribute set is config only (the 10/14 prototype set as v2)', () => {
  const PROTOTYPE_V2: ScoringModelInput = {
    version: 2,
    attributes: [
      {
        key: 'opportunity_size',
        label: 'Opportunity size',
        weight: 0.25,
        input: 'quote.est_annual_revenue',
        bands: [
          [null, 50_000, 20],
          [50_000, 500_000, 60],
          [500_000, null, 100],
        ],
      },
      {
        key: 'risk_profile',
        label: 'Risk profile',
        weight: 0.15,
        input: 'map',
        map: { by: 'request_class', values: { CCQ: 70, OTHER_CAPITAL: 40 }, default: 50 },
      },
      {
        key: 'credit_quality',
        label: 'Credit quality',
        weight: 0.1,
        input: 'map',
        map: { by: 'customer.credit_rating', values: { A: 100, B: 70, C: 30 } },
      },
      {
        key: 'stage_momentum',
        label: 'Stage momentum',
        weight: 0.1,
        input: 'quote.days_in_stage',
        inverse: true,
        bands: [
          [0, 7, 0],
          [7, 30, 40],
          [30, null, 80],
        ],
      },
      {
        key: 'close_urgency',
        label: 'Close urgency',
        weight: 0.15,
        input: 'days_to_close',
        bands: [
          [null, 60, 100],
          [60, null, 30],
        ],
      },
      {
        key: 'client_relationship',
        label: 'Client relationship',
        weight: 0.15,
        input: 'map',
        map: { by: 'customer.status', values: { existing: 90, not_yet_established: 30 } },
      },
      {
        key: 'product_margin',
        label: 'Product margin',
        weight: 0.1,
        input: 'pricing.margin_pct',
        bands: [
          [null, 15, 10],
          [15, 30, 60],
          [30, null, 100],
        ],
      },
    ],
    tiers: [
      { key: 'P1', label: 'Priority 1', min: 70 },
      { key: 'P2', label: 'Priority 2', min: 40 },
      { key: 'P3', label: 'Priority 3', min: 0 },
    ],
  };

  it('parses and scores with no code change', () => {
    const model = parseScoringModel(PROTOTYPE_V2);
    const r = score(
      model,
      {
        quote: {
          est_annual_revenue: 700_000,
          request_class: 'CCQ',
          days_in_stage: 3,
          expected_close_date: '2026-11-15',
        },
        customer: { status: 'existing', credit_rating: 'B' },
        pricing: { margin_pct: 22 },
      },
      NOW,
    );
    expect(r).toMatchSnapshot();
    expect(r.unknowns).toEqual([]);
    expect(r.modelVersion).toBe(2);
    // margin is a commercial field, so its raw value is restricted
    expect(r.breakdown.find((b) => b.key === 'product_margin')!.sensitive).toBe(true);
  });
});

describe('inputs', () => {
  it('getFact: bare names read the quote, dotted paths are literal', () => {
    const f = { quote: { market: 'FOOD' }, customer: { status: 'existing' } };
    expect(getFact(f, 'market')).toBe('FOOD');
    expect(getFact(f, 'customer.status')).toBe('existing');
    expect(getFact(f, 'customer.status.deeper')).toBeUndefined();
    expect(getFact(f, 'nope.x')).toBeUndefined();
  });

  it('toNumber accepts finite numbers and numeric strings only', () => {
    expect(toNumber(5)).toBe(5);
    expect(toNumber('12.5')).toBe(12.5);
    expect(toNumber(' ')).toBeNull();
    expect(toNumber('abc')).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
    expect(toNumber(null)).toBeNull();
  });

  it('daysUntil counts UTC calendar days from now', () => {
    expect(daysUntil('2026-10-20', NOW)).toBe(0);
    expect(daysUntil('2026-10-21T00:00:00Z', NOW)).toBe(1);
    expect(daysUntil(new Date('2026-10-10T23:00:00Z'), NOW)).toBe(-10);
    expect(daysUntil('not a date', NOW)).toBeNull();
    expect(daysUntil('2026-13-45', NOW)).not.toBeNull(); // Date.UTC rolls over; still a number
    expect(daysUntil(42, NOW)).toBeNull();
  });

  it('map: a value missing from the map with no default is unknown', () => {
    const model = parseScoringModel({
      version: 3,
      attributes: [
        {
          key: 'c',
          label: 'Customer',
          weight: 1,
          input: 'map',
          map: { by: 'customer.status', values: { existing: 80 } },
        },
      ],
      tiers: [{ key: 'ALL', min: 0 }],
    });
    const r = score(model, { customer: { status: 'prospect' } }, NOW);
    expect(r.unknowns).toEqual(['c']);
    expect(r.breakdown[0]!.explanation).toContain('"prospect" is not listed');
    const numericCode = score(model, { customer: { status: 1 } }, NOW);
    expect(numericCode.breakdown[0]!.explanation).toContain('"1" is not listed');
  });

  it('a number outside every band is unknown', () => {
    const r = score(scoringModelV1, { quote: { est_annual_revenue: -5 } }, NOW);
    const revenue = r.breakdown.find((b) => b.key === 'revenue')!;
    expect(revenue.unknown).toBe(true);
    expect(revenue.explanation).toContain('-5 is outside every band');
  });

  it('the resolver registry is the extension point', () => {
    expect(Object.keys(INPUT_RESOLVERS).sort()).toEqual(['days_to_close', 'map']);
  });

  it('describes open-ended bands', () => {
    const model = parseScoringModel({
      version: 4,
      attributes: [
        { key: 'x', label: 'X', weight: 1, input: 'quote.x', bands: [[null, null, 55]] },
      ],
      tiers: [{ key: 'ALL', min: 0 }],
    });
    expect(score(model, { quote: { x: 1 } }, NOW).breakdown[0]!.explanation).toContain('any value');
  });
});

describe('redactScore', () => {
  const after = score(scoringModelV1, FIXTURES['05 after G2: heavy capital']!, NOW);

  it('hides the capital figure from roles without commercial access, keeping the points', () => {
    const kamView = redactScore(after, makeActor('KAM'));
    const capital = kamView.breakdown.find((b) => b.key === 'capital_exposure')!;
    expect(capital.raw).toBeNull();
    expect(capital.points).toBe(10);
    expect(capital.explanation).not.toContain('1,500,000');
    expect(kamView.total).toBe(after.total);
    // non-sensitive attributes are untouched
    expect(kamView.breakdown.find((b) => b.key === 'revenue')).toEqual(
      after.breakdown.find((b) => b.key === 'revenue'),
    );
  });

  it('leaves the result alone for commercial roles', () => {
    expect(redactScore(after, makeActor('Pricing'))).toBe(after);
  });
});

describe('qualification screens (warnings only)', () => {
  const off = parseQualificationSettings({});
  const on = parseQualificationSettings({
    minOpportunityValueUsd: 25_000,
    minVolumeByProcess: { '*': 100_000, EBM: 250_000, bad: 'x' },
    exceptionNoteOutcomes: ['G1:advance', 7],
  });
  const small = FIXTURES['03 the $18k example (below a mold set)']!;

  it('are off by default', () => {
    expect(off).toEqual({
      minOpportunityValueUsd: null,
      minVolumeByProcess: {},
      exceptionNoteOutcomes: [],
    });
    expect(qualificationWarnings(off, small)).toEqual([]);
  });

  it("warn on Darren's $18k example", () => {
    expect(on.minVolumeByProcess).toEqual({ '*': 100_000, EBM: 250_000 });
    expect(qualificationWarnings(on, small)).toEqual([
      expect.objectContaining({
        code: 'below_min_value',
        threshold: 25_000,
        actual: 18_000,
        message:
          'Below the $25,000 minimum opportunity value ($18,000); requires a strategic exception note',
      }),
      expect.objectContaining({
        code: 'below_min_volume',
        threshold: 100_000,
        message:
          'Below the 100,000-unit minimum annual volume (40,000); requires a strategic exception note',
      }),
    ]);
  });

  it('use the process-specific minimum once the process is known', () => {
    const w = qualificationWarnings(
      on,
      facts({ est_annual_volume: 200_000 }, null, { process_type: 'EBM' }),
    );
    expect(w).toEqual([expect.objectContaining({ threshold: 250_000 })]);
    expect(w[0]!.message).toContain('for EBM');
  });

  it('an exception note is required only for the configured outcomes when warned', () => {
    const warnings = qualificationWarnings(on, small);
    const req = { gateKey: 'G1', outcomeKey: 'advance' };
    expect(exceptionNoteErrors(on, warnings, req)[0]!.code).toBe('NOTE_REQUIRED');
    expect(exceptionNoteErrors(on, warnings, { ...req, note: 'Strategic account' })).toEqual([]);
    expect(exceptionNoteErrors(on, warnings, { ...req, outcomeKey: 'stop' })).toEqual([]);
    expect(exceptionNoteErrors(on, [], req)).toEqual([]);
  });
});

describe('canSeePriorityScore (kam_can_see_peer_scores)', () => {
  const kam = makeActor('KAM');
  it('everyone sees every score while the setting is on', () => {
    expect(canSeePriorityScore(kam, KAM_ID, true)).toBe(true);
  });
  it('when off, a KAM sees only their own quotes; other roles see all', () => {
    expect(canSeePriorityScore(kam, KAM_ID, false)).toBe(false);
    expect(canSeePriorityScore(makeActor('KAM', { userId: KAM_ID }), KAM_ID, false)).toBe(true);
    expect(canSeePriorityScore(makeActor(['KAM', 'SalesLeader']), KAM_ID, false)).toBe(true);
  });
});
