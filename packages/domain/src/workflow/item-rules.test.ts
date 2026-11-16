import { describe, expect, it } from 'vitest';

import {
  evaluateQuoteRules,
  itemFactKeys,
  quoteItemFacts,
  ruleIsPerItem,
  type QuoteItemFacts,
} from './item-rules';
import { evaluateRules } from './rules';
import { capitalNeed } from '../engineering/capital-needed';
import { packOutRequirementErrors } from '../engineering/pack-out';
import { withItemsNote } from '../scoring/items-note';
import type { RequiredRule } from '../types/workflow-config';

/** FB-19 (W13-32 to W13-34): the gate rules on a quote with items (G2 per item). */

const present = (field: string): RequiredRule => ({ field, op: 'present' });

/** The G2 Advance shape: per-item solution fields, the per-item capital rule, a quote-level sign-off. */
const G2: RequiredRule[] = [
  present('plant_code'),
  present('prelim_capital_usd'),
  { field: 'capacity_evidence', op: 'minItems', value: 1 },
  {
    anyOf: [
      { field: 'eng_capital_needed', op: 'equals', value: false },
      { field: 'equipment_bom_on_file', op: 'equals', value: true },
    ],
  },
  { field: 'capacity_signoff_status', op: 'equals', value: 'approved' },
];

const facts = (no: number, over: Partial<QuoteItemFacts> = {}): QuoteItemFacts => ({
  item_no: no,
  label: no === 1 ? '16 oz bottle' : `item ${no}`,
  quote_item_id: `id-${no}`,
  plant_code: 'PLANT_01',
  prelim_capital_usd: 0,
  capacity_evidence: [{ site: 'PLANT_01' }],
  eng_capital_needed: false,
  ...over,
});

/** The quote's fields as the state builder makes them: item 1 at the top level, every item on `items`. */
const quote = (items: QuoteItemFacts[], over: Record<string, unknown> = {}) => {
  const { item_no: _n, label: _l, quote_item_id: _i, ...first } = items[0]!;
  return {
    ...first,
    capacity_signoff_status: 'approved',
    equipment_bom_on_file: false,
    items,
    ...over,
  };
};

describe('evaluateQuoteRules', () => {
  it('without items it is exactly evaluateRules', () => {
    const fields = { plant_code: null, prelim_capital_usd: 5, capacity_evidence: [] };
    expect(evaluateQuoteRules(G2, fields)).toEqual(evaluateRules(G2, fields));
  });

  it('a one-item quote evaluates as before (no item named)', () => {
    const one = quote([facts(1, { plant_code: null })]);
    const errors = evaluateQuoteRules(G2, one);
    expect(errors.map((e) => e.message)).toEqual(evaluateRules(G2, one).map((e) => e.message));
    expect(errors.some((e) => e.message.startsWith('Item'))).toBe(false);
  });

  it('passes only when every item passes; a failure names its item', () => {
    const ok = quote([facts(1), facts(2), facts(3)]);
    expect(evaluateQuoteRules(G2, ok)).toEqual([]);
    const bad = quote([facts(1), facts(2, { plant_code: null, capacity_evidence: [] }), facts(3)]);
    const errors = evaluateQuoteRules(G2, bad);
    expect(errors.map((e) => e.field)).toEqual(['plant_code', 'capacity_evidence']);
    expect(errors.every((e) => e.message.startsWith('Item 2 (item 2): '))).toBe(true);
  });

  it('a quote-level rule is checked once, whatever the items say', () => {
    const errors = evaluateQuoteRules(
      G2,
      quote([facts(1), facts(2)], { capacity_signoff_status: null }),
    );
    expect(errors.map((e) => e.field)).toEqual(['capacity_signoff_status']);
    expect(errors[0]!.message.startsWith('Item')).toBe(false);
  });

  it('capital per item: an item that needs capital needs the BOM (quote level)', () => {
    const needs = quote([
      facts(1),
      facts(2, { prelim_capital_usd: 50_000, eng_capital_needed: true }),
    ]);
    const errors = evaluateQuoteRules(G2, needs);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe('eng_capital_needed,equipment_bom_on_file');
    expect(errors[0]!.message).toMatch(/^Item 2/);
    expect(evaluateQuoteRules(G2, { ...needs, equipment_bom_on_file: true })).toEqual([]);
  });

  it('which rules are per item follows from the item facts, not from a list of fields', () => {
    const items = [facts(1), facts(2)];
    const keys = itemFactKeys(items);
    expect(keys.has('label')).toBe(false);
    expect(keys.has('item_no')).toBe(false);
    expect(ruleIsPerItem(present('plant_code'), keys)).toBe(true);
    expect(ruleIsPerItem(present('capacity_signoff_status'), keys)).toBe(false);
    expect(ruleIsPerItem(present('pricing_record.capital_readiness'), keys)).toBe(false);
    expect(quoteItemFacts({})).toBeNull();
    expect(quoteItemFacts({ items: [] })).toBeNull();
  });
});

describe('capital needed with items (FB-17 + FB-19)', () => {
  it('needed when any item is above the threshold; the figure is the total', () => {
    const fields = { items: [{ prelim_capital_usd: 0 }, { prelim_capital_usd: 40_000 }] };
    expect(capitalNeed(fields, 0)).toMatchObject({
      needed: true,
      byEngineering: true,
      prelimCapitalUsd: 40_000,
    });
    // Two items under a higher threshold: the total is above it, no item is.
    const under = { items: [{ prelim_capital_usd: 30_000 }, { prelim_capital_usd: 30_000 }] };
    expect(capitalNeed(under, 50_000)).toMatchObject({ needed: false, prelimCapitalUsd: 60_000 });
    // A list row passes the total and the largest figure.
    expect(
      capitalNeed({ prelim_capital_usd: 60_000, prelim_capital_max_usd: 30_000 }, 50_000).needed,
    ).toBe(false);
    expect(capitalNeed({ items: [{ prelim_capital_usd: null }] }, 0).prelimCapitalUsd).toBeNull();
  });
});

describe('pack-out requirement per item', () => {
  const rule = { notTogether: [], requireOneOf: true } as never;
  it('names the item that has none, with several items', () => {
    const fields = {
      items: [
        { item_no: 1, label: 'a', units_per_bag: 10 },
        { item_no: 2, label: 'b', units_per_bag: null, units_per_tray: null, units_per_case: null },
      ],
    };
    const errors = packOutRequirementErrors(rule, fields);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/^Item 2 \(b\): Pack-out/);
  });
});

describe('the priority breakdown says how many items (W13-32)', () => {
  const result = {
    total: 50,
    tier: 'STANDARD',
    tierLabel: 'Standard',
    modelVersion: 1,
    unknowns: [],
    breakdown: [
      { key: 'volume', explanation: '2,100,000 → 100 points' },
      { key: 'revenue', explanation: '$100,000 → 40 points' },
    ],
  } as never;
  const model = {
    attributes: [
      { key: 'volume', input: 'quote.est_annual_volume' },
      { key: 'revenue', input: 'quote.est_annual_revenue' },
    ],
  } as never;

  it('prefixes every attribute scored on the quote volume', () => {
    const out = withItemsNote(result, model, 3, 2_100_000);
    expect(out.breakdown[0]!.explanation).toBe(
      '3 items, 2.1 M units a year in total: 2,100,000 → 100 points',
    );
    expect(out.breakdown[1]!.explanation).toBe('$100,000 → 40 points');
  });

  it('leaves a one-item quote alone', () => {
    expect(withItemsNote(result, model, 1, 2_100_000)).toBe(result);
  });
});
