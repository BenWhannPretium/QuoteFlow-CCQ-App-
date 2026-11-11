import { describe, expect, it } from 'vitest';

import { scoreExplanationText } from './value-label';

/** DR-kam-sales-leader-03: score explanations show labels, not stored codes. */
describe('scoreExplanationText', () => {
  const config = {
    valueLists: {
      market: [{ code: 'HOME_CARE', label: 'Home Care', sort: 1, provisional: false, meta: {} }],
      product_family: [{ code: 'BOTTLE', label: 'Bottle', sort: 1, provisional: false, meta: {} }],
      resin: [{ code: 'HDPE', label: 'HDPE', sort: 1, provisional: false, meta: {} }],
    },
    retiredValues: { market: { FOOD_OLD: 'Food (old)' } },
  } as never;

  it('replaces the codes with their labels and explains "not listed"', () => {
    expect(
      scoreExplanationText(config, 'HOME_CARE', 'HOME_CARE (not listed, default) → 50 points'),
    ).toBe('Home Care (no points set for it: neutral default) → 50 points');
    expect(scoreExplanationText(config, 'BOTTLE+HDPE', 'BOTTLE+HDPE (not listed, default)')).toBe(
      'Bottle + HDPE (no points set for it: neutral default)',
    );
  });

  it('marks a retired code and leaves numbers and unknown codes alone', () => {
    expect(scoreExplanationText(config, 'FOOD_OLD', 'FOOD_OLD → 20 points')).toBe(
      'Food (old) (no longer offered) → 20 points',
    );
    expect(scoreExplanationText(config, 120, '120 days → 80 points')).toBe('120 days → 80 points');
    expect(scoreExplanationText(config, 'ZZZ', 'ZZZ → 0 points')).toBe('ZZZ → 0 points');
  });
});
