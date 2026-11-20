import { describe, expect, it } from 'vitest';

import { parseNeckText, type ListEntry } from './product-facts';
import {
  matchCodeExact,
  matchCodeLoose,
  PREFILL_MAP,
  sfFillsFor,
  sfPrefillOf,
  sfSuggestionsFor,
  type PrefillEntry,
  type PrefillLists,
  type SfSpecInput,
} from './sf-prefill';

/**
 * FB-32 (N19-04): the prefill map. The `fill` entries must give exactly what the wizard's two hand-written
 * functions gave before (resin, neck, annual volume, container size, and the name of an item added from a
 * Salesforce product); the one new `fill` is item 1's name. Synthetic specifications only.
 */

const LISTS: Record<string, ListEntry[]> = {
  resin: [
    { code: 'HDPE', label: 'HDPE' },
    { code: 'PET', label: 'PET' },
    { code: 'HDPE_PCR', label: 'HDPE/PCR' },
  ],
  neck_diameter: [
    { code: '28', label: '28 mm' },
    { code: '38', label: '38 mm' },
    { code: 'CUSTOM', label: 'Custom', freeText: true },
  ],
  neck_finish_type: [
    { code: '410', label: '410' },
    { code: '400', label: '400' },
    { code: 'CUSTOM', label: 'Custom', freeText: true },
  ],
  color_type: [
    { code: 'NATURAL', label: 'Natural' },
    { code: 'STOCK_WHITE', label: 'Stock white' },
    { code: 'CUSTOM', label: 'Custom color', freeText: true },
  ],
};
const lists: PrefillLists = (key) => LISTS[key] ?? [];
const LABEL_MAX = 120;
const fills = (spec: SfSpecInput | null | undefined) =>
  sfFillsFor(spec, lists, { labelMaxLength: LABEL_MAX });

/** The pre-FB-32 rules, copied as they were in `apps/web/src/intake/model.ts`. */
function legacy(spec: SfSpecInput) {
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const matchCode = (listKey: string, text: string | null | undefined) => {
    if (!text) return null;
    const t = norm(text);
    return LISTS[listKey]?.find((e) => norm(e.code) === t || norm(e.label) === t)?.code ?? null;
  };
  const text = (v: unknown) => (typeof v === 'string' ? v : null);
  const resin = matchCode('resin', text(spec.resin));
  const neck = parseNeckText(text(spec.neckFinish), {
    diameters: LISTS.neck_diameter!,
    finishes: LISTS.neck_finish_type!,
  });
  const volume = typeof spec.annualVolume === 'number' ? spec.annualVolume : null;
  const size = text(spec.capacity)?.trim() ? text(spec.capacity)!.trim() : null;
  const label = (text(spec.name)?.trim() || size)?.slice(0, LABEL_MAX) ?? null;
  return { resin, neck, volume, size, label };
}

const SPECS: SfSpecInput[] = [
  {},
  {
    name: 'PS-000001',
    resin: 'HDPE',
    capacity: '16 oz',
    neckFinish: '28-410',
    annualVolume: 250000,
  },
  { name: '  ', resin: 'hdpe/pcr', capacity: ' 8 oz ', neckFinish: '38-400', annualVolume: 0 },
  { name: null, resin: 'HDPE PCR', capacity: null, neckFinish: '28 DC', annualVolume: 1 },
  {
    name: 'x'.repeat(200),
    resin: 'Polypropylene',
    capacity: '',
    neckFinish: 'garbage',
    annualVolume: null,
  },
  { name: 'Sample', resin: '', capacity: '32 oz', neckFinish: '', annualVolume: 12345 },
  { name: null, resin: null, capacity: null, neckFinish: null, annualVolume: null },
];

describe('the prefill map gives what the two hand-written functions gave', () => {
  it.each(SPECS.map((s, i) => [i, s] as const))('specification %i', (_i, spec) => {
    const want = legacy(spec);
    const got = fills(spec);
    expect(got.resin ?? null).toBe(want.resin);
    expect(got.estAnnualVolume ?? null).toBe(want.volume);
    expect(got.containerSize ?? null).toBe(want.size);
    expect(got.label ?? null).toBe(want.label);
    if (want.neck) {
      expect(got.neckDiameter).toBe(want.neck.neckDiameter);
      expect(got.neckFinishType).toBe(want.neck.neckFinishType);
      expect(got.neckFinishTypeCustom).toBe(want.neck.neckFinishTypeCustom);
    } else {
      expect(got).not.toHaveProperty('neckDiameter');
      expect(got).not.toHaveProperty('neckFinishType');
      expect(got).not.toHaveProperty('neckFinishTypeCustom');
    }
  });

  it('resin: matches a list code or label ignoring case and punctuation', () => {
    expect(fills({ resin: 'hdpe/pcr' }).resin).toBe('HDPE_PCR');
    expect(fills({ resin: 'Unknown' })).not.toHaveProperty('resin');
  });

  it('neck: "28-410" is two list entries; an unlisted finish becomes Custom with its text', () => {
    expect(fills({ neckFinish: '28-410' })).toMatchObject({
      neckDiameter: '28',
      neckFinishType: '410',
      neckFinishTypeCustom: null,
    });
    expect(fills({ neckFinish: '38 DC' })).toMatchObject({
      neckDiameter: '38',
      neckFinishType: 'CUSTOM',
      neckFinishTypeCustom: 'DC',
    });
  });

  it('annual volume and container size are taken as Salesforce has them (the size trimmed)', () => {
    expect(fills({ annualVolume: 250000, capacity: '  16 oz ' })).toMatchObject({
      estAnnualVolume: 250000,
      containerSize: '16 oz',
    });
    expect(fills({ capacity: '   ' })).not.toHaveProperty('containerSize');
  });

  it("the item name is the specification's name, else its capacity, cut to the limit", () => {
    expect(fills({ name: ' PS-000001 ', capacity: '16 oz' }).label).toBe('PS-000001');
    expect(fills({ name: '  ', capacity: '16 oz' }).label).toBe('16 oz');
    expect(fills({ name: 'x'.repeat(200) }).label).toHaveLength(LABEL_MAX);
    expect(fills({})).not.toHaveProperty('label');
  });

  it('nothing comes from a missing specification', () => {
    expect(fills(null)).toEqual({});
    expect(fills(undefined)).toEqual({});
  });

  it('sfPrefill has every key, null where Salesforce had nothing', () => {
    expect(sfPrefillOf(fills({ resin: 'HDPE', name: 'A' }))).toEqual({
      resin: 'HDPE',
      neckDiameter: null,
      neckFinishType: null,
      neckFinishTypeCustom: null,
      estAnnualVolume: null,
      containerSize: null,
      label: 'A',
    });
  });

  it('never fills from a `suggest` entry', () => {
    const got = fills({ color: 'Natural', productType: 'Stock' });
    expect(got).not.toHaveProperty('colorType');
    expect(Object.keys(got)).toEqual([]);
  });

  it('a new confirmed field is one entry (a fake one here), read through the same functions', () => {
    const map: readonly PrefillEntry[] = [
      ...PREFILL_MAP,
      {
        quoteflowField: 'colorType',
        sfSource: 'color',
        kind: 'fill',
        match: 'valueList:color_type',
      },
    ];
    expect(
      sfFillsFor({ color: 'natural' }, lists, { labelMaxLength: LABEL_MAX, map }).colorType,
    ).toBe('NATURAL');
  });
});

describe('matchCodeLoose and matchCodeExact', () => {
  const entries: ListEntry[] = [
    { code: 'WALMART', label: 'Walmart' },
    { code: 'NATURAL', label: 'Natural' },
    { code: 'CUSTOM', label: 'Custom color', freeText: true },
  ];

  it('loose keeps the old rule: "Wal-Mart" is Walmart', () => {
    expect(matchCodeLoose(entries, 'Wal-Mart')).toBe('WALMART');
    expect(matchCodeLoose(entries, 'custom  color')).toBe('CUSTOM');
    expect(matchCodeLoose(entries, '')).toBeNull();
    expect(matchCodeLoose(entries, null)).toBeNull();
  });

  it('exact ignores only case and surrounding spaces, on the code or the label', () => {
    expect(matchCodeExact(entries, '  natural ')).toBe('NATURAL');
    expect(matchCodeExact(entries, 'NATURAL')).toBe('NATURAL');
    expect(matchCodeExact(entries, 'Walmart')).toBe('WALMART');
  });

  it('exact does not strip punctuation or inner spaces', () => {
    expect(matchCodeExact(entries, 'Wal-Mart')).toBeNull();
    expect(matchCodeExact(entries, 'Wal Mart')).toBeNull();
    expect(matchCodeExact(entries, 'Nat ural')).toBeNull();
  });

  it('exact never matches an entry that needs a description', () => {
    expect(matchCodeExact(entries, 'Custom color')).toBeNull();
    expect(matchCodeExact(entries, 'custom')).toBeNull();
  });

  it('exact: blank text matches nothing', () => {
    expect(matchCodeExact(entries, '   ')).toBeNull();
    expect(matchCodeExact(entries, undefined)).toBeNull();
  });
});

describe('suggestions', () => {
  it("Salesforce's Color is offered for an exact entry, labelled with Salesforce's own label", () => {
    expect(sfSuggestionsFor({ color: ' natural ' }, lists)).toEqual([
      { quoteflowField: 'colorType', sfLabel: 'Color', sfText: 'natural', code: 'NATURAL' },
    ]);
  });

  it('is empty for a miss, a near miss, a Custom entry and a missing value', () => {
    expect(sfSuggestionsFor({ color: 'Amber' }, lists)).toEqual([]);
    expect(sfSuggestionsFor({ color: 'White' }, lists)).toEqual([]);
    expect(sfSuggestionsFor({ color: 'Stock-white' }, lists)).toEqual([]);
    expect(sfSuggestionsFor({ color: 'Custom color' }, lists)).toEqual([]);
    expect(sfSuggestionsFor({ color: null }, lists)).toEqual([]);
    expect(sfSuggestionsFor(undefined, lists)).toEqual([]);
  });

  it('Product_Type__c suggests nothing: it is a kind of quote, not a product family', () => {
    expect(sfSuggestionsFor({ productType: 'Stock Plus' }, lists)).toEqual([]);
    expect(PREFILL_MAP.some((e) => e.sfSource === 'productType')).toBe(false);
  });

  it('the map only has two kinds, and only `suggest` entries are hints', () => {
    expect(new Set(PREFILL_MAP.map((e) => e.kind))).toEqual(new Set(['fill', 'suggest']));
    expect(PREFILL_MAP.filter((e) => e.kind === 'suggest').map((e) => e.quoteflowField)).toEqual([
      'colorType',
    ]);
  });
});
