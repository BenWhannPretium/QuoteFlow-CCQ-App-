import { describe, expect, it } from 'vitest';

import {
  CAPITAL_NEEDED_ABOVE_USD_SEED,
  capitalNeed,
  capitalNeededRuleText,
  engCapitalNeeded,
  formatCapitalUsd,
  g2DecisionText,
  parseCapitalNeededAboveUsd,
} from './capital-needed';
import { settingSpec } from '../config-admin/settings';
import { DomainError } from '../errors';

/**
 * FB-17 (W13-22): "Advance – capital required" is switched off. Capital needed follows from the
 * preliminary capital figure and `app_setting.capital_needed_above_usd` (seed 0, provisional).
 */
describe('capital_needed_above_usd (setting)', () => {
  it('is seeded 0: any amount above $0 needs capital', () => {
    expect(CAPITAL_NEEDED_ABOVE_USD_SEED).toBe(0);
    expect(parseCapitalNeededAboveUsd(undefined)).toBe(0);
    expect(parseCapitalNeededAboveUsd(null)).toBe(0);
    expect(parseCapitalNeededAboveUsd(0)).toBe(0);
    expect(parseCapitalNeededAboveUsd(25_000)).toBe(25_000);
  });

  it('refuses anything that is not a dollar amount of 0 or more', () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, '100', true, {}, [], 1e13]) {
      expect(() => parseCapitalNeededAboveUsd(value), String(value)).toThrow(DomainError);
    }
  });

  it('the Admin console knows it: a number in the Engineering group, never "not set"', () => {
    const spec = settingSpec('capital_needed_above_usd');
    expect(spec).toMatchObject({ group: 'engineering', editor: 'number' });
    expect(spec!.parse(50_000)).toBe(50_000);
    expect(() => spec!.parse(null)).toThrow(DomainError);
    expect(() => spec!.parse(-5)).toThrow(DomainError);
  });
});

describe('eng_capital_needed (the fact the G2 rules read)', () => {
  it('is true above the threshold and false at or below it', () => {
    expect(engCapitalNeeded(0, 0)).toBe(false);
    expect(engCapitalNeeded(1, 0)).toBe(true);
    expect(engCapitalNeeded(40_000, 40_000)).toBe(false);
    expect(engCapitalNeeded(40_001, 40_000)).toBe(true);
    // A numeric column can arrive as text.
    expect(engCapitalNeeded('0.00', 0)).toBe(false);
    expect(engCapitalNeeded('250000.00', 0)).toBe(true);
  });

  it('a blank figure counts as needed: it must never let the BOM be skipped', () => {
    for (const blank of [null, undefined, '', 'n/a', Number.NaN]) {
      expect(engCapitalNeeded(blank, 0)).toBe(true);
      expect(engCapitalNeeded(blank, 1_000_000)).toBe(true);
    }
  });
});

describe('capitalNeed (what everything after G2 reads)', () => {
  it('names each reason, and whether Engineering is the one saying so', () => {
    expect(capitalNeed({ prelim_capital_usd: 250_000 })).toEqual({
      needed: true,
      byEngineering: true,
      reasons: ['prelim_capital'],
      prelimCapitalUsd: 250_000,
    });
    expect(capitalNeed({ g2_outcome: 'capital_required' })).toEqual({
      needed: true,
      byEngineering: true,
      reasons: ['historical_outcome'],
      prelimCapitalUsd: null,
    });
    expect(capitalNeed({ capital_likely: true, prelim_capital_usd: 0 })).toEqual({
      needed: true,
      byEngineering: false,
      reasons: ['capital_likely'],
      prelimCapitalUsd: 0,
    });
    expect(
      capitalNeed({
        g2_outcome: 'capital_required',
        prelim_capital_usd: 90_000,
        capital_likely: true,
      }).reasons,
    ).toEqual(['prelim_capital', 'historical_outcome', 'capital_likely']);
  });

  it('a blank figure is unknown here, not capital: quotes from before FB-17 are not flagged by it', () => {
    expect(capitalNeed({ g2_outcome: 'proceed' })).toEqual({
      needed: false,
      byEngineering: false,
      reasons: [],
      prelimCapitalUsd: null,
    });
    expect(capitalNeed({ g2_outcome: 'proceed', prelim_capital_usd: null }).needed).toBe(false);
    expect(capitalNeed({ g2_outcome: 'proceed', prelim_capital_usd: 0 }).needed).toBe(false);
    expect(capitalNeed({ capital_likely: false }).needed).toBe(false);
  });

  it('follows the threshold', () => {
    expect(capitalNeed({ prelim_capital_usd: 30_000 }, 50_000).needed).toBe(false);
    expect(capitalNeed({ prelim_capital_usd: 50_000 }, 50_000).needed).toBe(false);
    expect(capitalNeed({ prelim_capital_usd: 50_001 }, 50_000).needed).toBe(true);
  });
});

describe('wording', () => {
  it('formats whole dollars and states the BOM rule with the threshold', () => {
    expect(formatCapitalUsd(250_000)).toBe('$250,000');
    expect(formatCapitalUsd(0)).toBe('$0');
    expect(formatCapitalUsd(1_234.6)).toBe('$1,235');
    expect(capitalNeededRuleText()).toBe(
      'Required to advance when preliminary capital is above $0',
    );
    expect(capitalNeededRuleText(50_000)).toBe(
      'Required to advance when preliminary capital is above $50,000',
    );
  });

  it('the queues read "capital needed" beside the G2 outcome, once', () => {
    const entry = (
      g2Outcome: string | null,
      g2OutcomeLabel: string | null,
      capitalNeeded: boolean,
    ) => g2DecisionText({ g2Outcome, g2OutcomeLabel, capitalNeeded });
    expect(entry('proceed', 'Advance', true)).toBe('Advance · capital needed');
    expect(entry('proceed_with_risk', 'Advance with risk', true)).toBe(
      'Advance with risk · capital needed',
    );
    expect(entry('proceed', 'Advance', false)).toBe('Advance');
    // The retired outcome's label already says it.
    expect(entry('capital_required', 'Advance – capital required', true)).toBe(
      'Advance – capital required',
    );
    expect(entry(null, null, false)).toBeNull();
  });
});
