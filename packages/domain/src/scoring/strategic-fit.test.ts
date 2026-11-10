import { describe, expect, it } from 'vitest';

import { NOW } from '../test-utils';
import { parseScoringModel } from './model';
import type { ScoringModelInput } from './model';
import { score } from './score';
import { SCORING_MODEL_V1_INPUT, scoringModelV1 } from './seeds';

/**
 * FB-04 (F-073): the strategic-fit MECHANISM. The seed map is empty (points wait for D-004), so these tests use a
 * non-empty TEST map and prove that two markets, and two segments, score differently. Nothing here is a business
 * value.
 */

const withMap = (map: Record<string, unknown>): ScoringModelInput => ({
  ...SCORING_MODEL_V1_INPUT,
  attributes: SCORING_MODEL_V1_INPUT.attributes.map((a) =>
    a.key === 'strategic_fit' ? { ...a, map: { ...a.map, ...map } } : a,
  ) as ScoringModelInput['attributes'],
});

const fit = (model: ReturnType<typeof parseScoringModel>, quote: Record<string, unknown>) =>
  score(model, { quote, customer: null, eng_review: null }, NOW).breakdown.find(
    (b) => b.key === 'strategic_fit',
  )!;

describe('strategic fit by market and segment (F-073)', () => {
  it('the seed model has an empty map: every market scores the neutral default and is flagged provisional', () => {
    const a = fit(scoringModelV1, { market: 'FOOD' });
    const b = fit(scoringModelV1, { market: 'BEVERAGE' });
    expect(a.points).toBe(50);
    expect(b.points).toBe(50);
    expect(a.provisional).toBe(true);
    expect(b.raw).toBe('BEVERAGE');
  });

  it('two markets score differently once the market map has points (and are no longer provisional)', () => {
    const model = parseScoringModel(withMap({ values: { FOOD: 90, BEVERAGE: 20 }, default: 50 }));
    const food = fit(model, { market: 'FOOD' });
    const beverage = fit(model, { market: 'BEVERAGE' });
    expect([food.points, beverage.points]).toEqual([90, 20]);
    expect(food.contribution).toBe(13.5);
    expect(food.provisional).toBeUndefined();
    // A market that is not listed still gets the default.
    expect(fit(model, { market: 'PET' }).points).toBe(50);
  });

  it('two segments score differently, and a segment beats the market', () => {
    const model = parseScoringModel(
      withMap({
        values: { FOOD: 60 },
        default: 50,
        bySegment: { by: 'market_segment', values: { SNACKS: 95, HONEY: 15 } },
      }),
    );
    const snacks = fit(model, { market: 'FOOD', market_segment: 'SNACKS' });
    const honey = fit(model, { market: 'FOOD', market_segment: 'HONEY' });
    expect([snacks.points, honey.points]).toEqual([95, 15]);
    expect(snacks.explanation).toContain('sub-market');
    expect(snacks.explanation).not.toContain('default');
    // Segment unknown or unlisted → fall back to the market, then to the default.
    expect(fit(model, { market: 'FOOD' }).points).toBe(60);
    expect(fit(model, { market: 'FOOD', market_segment: 'JERKY' }).points).toBe(60);
    expect(fit(model, { market: 'BEVERAGE' }).points).toBe(50);
  });

  it('a segment alone is enough (no market given): the unknown-market neutral score does not hide it', () => {
    const model = parseScoringModel(
      withMap({ values: {}, bySegment: { by: 'market_segment', values: { SNACKS: 95 } } }),
    );
    expect(fit(model, { market_segment: 'SNACKS' }).points).toBe(95);
    expect(fit(model, {}).unknown).toBe(true);
  });

  it('a segment map only (empty market map) is not provisional once it has values', () => {
    const model = parseScoringModel(
      withMap({
        values: {},
        default: 50,
        bySegment: { by: 'market_segment', values: { SNACKS: 95 } },
      }),
    );
    expect(fit(model, { market: 'FOOD', market_segment: 'HONEY' }).provisional).toBeUndefined();
  });

  it('rejects a malformed segment map', () => {
    expect(() =>
      parseScoringModel(withMap({ bySegment: { by: 'x', values: { A: 120 } } })),
    ).toThrow(/Scoring model failed schema validation/);
  });
});
