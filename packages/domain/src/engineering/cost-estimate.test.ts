import { describe, expect, it } from 'vitest';

import {
  ENGINEERING_COST_DEFAULTS_SEED,
  ENGINEERING_COST_LINES_SEED,
  applyMarkup,
  costLinesForItem,
  costTotals,
  freightPrefill,
  laborTotalPerLine,
  normalizeCostEstimate,
  normalizeCostLines,
  normalizePackOutCounts,
  packMethodCountField,
  packOutFigures,
  parseEngineeringCostDefaults,
  parseEngineeringCostLines,
  parseToolingMarkupDefaultPct,
  sumCostTotals,
  validateCostEstimate,
  validateCostLines,
  type CostEstimateFields,
  type PackOutCalcInput,
} from './cost-estimate';

const defs = parseEngineeringCostLines(null);
const noMarkup = { notedPct: null, defaultPct: 0 };

describe('FB-23 engineering_cost_lines config', () => {
  it('seeds the ECE Summary lines plus Tariffs / duties, provisional customer-funded set', () => {
    expect(defs.map((d) => d.key)).toEqual([
      'molds',
      'unit_mold',
      'perso_parts',
      'head_tooling',
      'freight',
      'start_up',
      'tariffs',
      'other',
      'blow_molders',
      'resin_handling',
      'packaging_inspection',
      'support_equipment',
      'misc_equipment',
    ]);
    expect(defs.filter((d) => d.customerFunded).map((d) => d.key)).toEqual([
      'molds',
      'freight',
      'start_up',
      'tariffs',
    ]);
    expect(defs.find((d) => d.key === 'tariffs')).toMatchObject({
      label: 'Tariffs / duties',
      group: 'tooling',
      processes: 'all',
    });
    expect(defs.find((d) => d.key === 'other')?.needsDescription).toBe(true);
    expect(defs.filter((d) => d.group === 'new_line')).toHaveLength(5);
  });

  it('accepts a valid list and copies the seed (no shared objects)', () => {
    const parsed = parseEngineeringCostLines(
      JSON.parse(JSON.stringify(ENGINEERING_COST_LINES_SEED)),
    );
    expect(parsed).toEqual(defs);
    expect(parseEngineeringCostLines(null)[0]).not.toBe(ENGINEERING_COST_LINES_SEED[0]);
  });

  it.each([
    ['not a list', {}],
    ['empty', []],
    ['bad key', [{ key: 'Molds', label: 'M', group: 'tooling', customerFunded: true }]],
    [
      'duplicate key',
      [
        { key: 'a', label: 'A', group: 'tooling', customerFunded: true },
        { key: 'a', label: 'B', group: 'tooling', customerFunded: true },
      ],
    ],
    ['no label', [{ key: 'a', label: ' ', group: 'tooling', customerFunded: true }]],
    ['bad group', [{ key: 'a', label: 'A', group: 'x', customerFunded: true }]],
    [
      'bad processes',
      [{ key: 'a', label: 'A', group: 'tooling', processes: [], customerFunded: true }],
    ],
    ['no customerFunded', [{ key: 'a', label: 'A', group: 'tooling' }]],
    [
      'bad prefill',
      [{ key: 'a', label: 'A', group: 'tooling', customerFunded: true, prefill: 'x' }],
    ],
    [
      'two freight prefills',
      [
        { key: 'a', label: 'A', group: 'tooling', customerFunded: true, prefill: 'freight' },
        { key: 'b', label: 'B', group: 'tooling', customerFunded: true, prefill: 'freight' },
      ],
    ],
  ])('refuses %s', (_name, value) => {
    expect(() => parseEngineeringCostLines(value)).toThrow(/engineering_cost_lines/);
  });
});

describe('FB-23 defaults and markup settings', () => {
  it('seeds Jim’s standard figures', () => {
    expect(parseEngineeringCostDefaults(null)).toEqual({
      freightCompleteMoldUsd: 1500,
      freightLowerBlowMoldUsd: 750,
      startUpAssistanceUsd: 5500,
    });
  });
  it('refuses a negative, missing or fractional-cent default', () => {
    expect(() =>
      parseEngineeringCostDefaults({
        ...ENGINEERING_COST_DEFAULTS_SEED,
        freightCompleteMoldUsd: -1,
      }),
    ).toThrow();
    expect(() => parseEngineeringCostDefaults({ freightCompleteMoldUsd: 1 })).toThrow();
    expect(() =>
      parseEngineeringCostDefaults({
        ...ENGINEERING_COST_DEFAULTS_SEED,
        startUpAssistanceUsd: 1.001,
      }),
    ).toThrow();
    expect(() => parseEngineeringCostDefaults([])).toThrow();
  });
  it('markup default: 0 by D5, 0 to 100', () => {
    expect(parseToolingMarkupDefaultPct(null)).toBe(0);
    expect(parseToolingMarkupDefaultPct(15)).toBe(15);
    expect(() => parseToolingMarkupDefaultPct(-1)).toThrow(/tooling_markup_default_pct/);
    expect(() => parseToolingMarkupDefaultPct(100.01)).toThrow();
    expect(() => parseToolingMarkupDefaultPct('15')).toThrow();
  });
});

describe('FB-23 lines by process', () => {
  const keys = (process: string | null, stored: string[] = []) =>
    costLinesForItem(defs, 'tooling', process, new Set(stored)).map((l) => l.key);

  it('shows head tooling for EBM and perso parts for RHB only', () => {
    expect(keys('EBM')).toContain('head_tooling');
    expect(keys('EBM')).not.toContain('perso_parts');
    expect(keys('RHB')).toContain('perso_parts');
    expect(keys('RHB')).not.toContain('head_tooling');
    expect(keys('ISBM')).toEqual(['molds', 'unit_mold', 'freight', 'start_up', 'tariffs', 'other']);
  });
  it('shows every line while no process is chosen', () => {
    expect(keys(null)).toHaveLength(8);
  });
  it('keeps a line that holds a value, marked not usual', () => {
    const lines = costLinesForItem(defs, 'tooling', 'ISBM', new Set(['head_tooling']));
    expect(lines.find((l) => l.key === 'head_tooling')?.usual).toBe(false);
    expect(lines.find((l) => l.key === 'molds')?.usual).toBe(true);
  });
  it('splits the groups', () => {
    expect(costLinesForItem(defs, 'new_line', 'EBM').map((l) => l.key)).toEqual([
      'blow_molders',
      'resin_handling',
      'packaging_inspection',
      'support_equipment',
      'misc_equipment',
    ]);
  });
  it('pre-fills freight per complete mold or per lower blow mold', () => {
    expect(freightPrefill(ENGINEERING_COST_DEFAULTS_SEED, 'complete')).toBe(1500);
    expect(freightPrefill(ENGINEERING_COST_DEFAULTS_SEED, 'lower', 4)).toBe(3000);
    expect(freightPrefill(ENGINEERING_COST_DEFAULTS_SEED, 'lower', 0)).toBe(750);
  });
});

describe('FB-23 cost totals (exact cents, D5 markup)', () => {
  it('is null with no line', () => {
    expect(costTotals([], defs, noMarkup)).toBeNull();
  });

  it('adds the customer-funded lines and the project total; net = total − customer funded', () => {
    const t = costTotals(
      [
        { lineKey: 'molds', amountUsd: 250_000 },
        { lineKey: 'freight', amountUsd: 1_500 },
        { lineKey: 'start_up', amountUsd: 5_500 },
        { lineKey: 'tariffs', amountUsd: 2_000 },
        { lineKey: 'unit_mold', amountUsd: 18_000.1 },
        { lineKey: 'blow_molders', amountUsd: 1_000_000 },
        { lineKey: 'other', amountUsd: 0.2 },
      ],
      defs,
      noMarkup,
    );
    expect(t).toEqual({
      projectTotalUsd: 1_277_000.3,
      customerFundedUsd: 259_000,
      netCostUsd: 1_018_000.3,
      markupPct: 0,
      markupNoted: false,
      customerToolingPriceUsd: 259_000,
    });
  });

  it('no markup noted: the customer tooling price equals the customer-funded total', () => {
    const t = costTotals([{ lineKey: 'molds', amountUsd: 12_345.67 }], defs, noMarkup)!;
    expect(t.customerToolingPriceUsd).toBe(t.customerFundedUsd);
  });

  it('a $259,000 customer-funded total with 15 % noted is $297,850.00', () => {
    const t = costTotals(
      [
        { lineKey: 'molds', amountUsd: 252_000 },
        { lineKey: 'freight', amountUsd: 1_500 },
        { lineKey: 'start_up', amountUsd: 5_500 },
      ],
      defs,
      { notedPct: 15, defaultPct: 0 },
    )!;
    expect(t.customerFundedUsd).toBe(259_000);
    expect(t.customerToolingPriceUsd).toBe(297_850);
    expect(t.markupNoted).toBe(true);
  });

  it('uses the default markup when none is noted, and a noted 0 overrides it', () => {
    const lines = [{ lineKey: 'molds', amountUsd: 100 }];
    expect(
      costTotals(lines, defs, { notedPct: null, defaultPct: 10 })!.customerToolingPriceUsd,
    ).toBe(110);
    expect(costTotals(lines, defs, { notedPct: 0, defaultPct: 10 })!.customerToolingPriceUsd).toBe(
      100,
    );
  });

  it('rounds the markup half up to the cent, with no float drift', () => {
    expect(applyMarkup(1, 50)).toBe(2); // 1.5 cents → 2
    expect(applyMarkup(333, 12.5)).toBe(375); // 374.625 → 375
    expect(applyMarkup(10, 0.01)).toBe(10); // 10.001 → 10
    expect(applyMarkup(99_999_999_999, 100)).toBe(199_999_999_998);
    // 0.1 + 0.2 in cents
    expect(
      costTotals(
        [
          { lineKey: 'molds', amountUsd: 0.1 },
          { lineKey: 'freight', amountUsd: 0.2 },
        ],
        defs,
        noMarkup,
      )!.customerFundedUsd,
    ).toBe(0.3);
  });

  it('counts a line no longer in the config in the project total, never as customer funded', () => {
    const t = costTotals([{ lineKey: 'retired_line', amountUsd: 10 }], defs, noMarkup)!;
    expect(t).toMatchObject({ projectTotalUsd: 10, customerFundedUsd: 0, netCostUsd: 10 });
  });

  it('sums the items for the quote', () => {
    const a = costTotals([{ lineKey: 'molds', amountUsd: 100.1 }], defs, {
      notedPct: 15,
      defaultPct: 0,
    });
    const b = costTotals([{ lineKey: 'unit_mold', amountUsd: 0.2 }], defs, noMarkup);
    expect(sumCostTotals([a, null, b])).toEqual({
      projectTotalUsd: 100.3,
      customerFundedUsd: 100.1,
      netCostUsd: 0.2,
      customerToolingPriceUsd: 115.12, // 100.10 × 1.15 = 115.115 → 115.12
    });
    expect(sumCostTotals([null])).toBeNull();
  });
});

describe('FB-23 cost lines sent on a save', () => {
  it('trims, keeps a quantity only on freight, drops details of a blank line', () => {
    expect(
      normalizeCostLines(
        [
          { lineKey: 'freight', amountUsd: 3000, quantity: 4, description: '  ' },
          { lineKey: 'molds', amountUsd: 10, quantity: 2 },
          { lineKey: 'other', amountUsd: null, description: 'x' },
        ],
        defs,
      ),
    ).toEqual([
      { lineKey: 'freight', amountUsd: 3000, description: null, quantity: 4 },
      { lineKey: 'molds', amountUsd: 10, description: null, quantity: null },
      { lineKey: 'other', amountUsd: null, description: null, quantity: null },
    ]);
  });

  it('needs a description on Other, a known key, a valid amount and quantity', () => {
    const errors = validateCostLines(
      normalizeCostLines(
        [
          { lineKey: 'other', amountUsd: 5 },
          { lineKey: 'nope', amountUsd: 5 },
          { lineKey: 'molds', amountUsd: -1 },
          { lineKey: 'freight', amountUsd: 1, quantity: 100 },
          { lineKey: 'unit_mold', amountUsd: 1.234 },
          { lineKey: 'molds', amountUsd: 1 },
        ],
        defs,
      ),
      defs,
    );
    expect(errors.map((e) => [e.field, e.code])).toEqual([
      ['costLines/0/description', 'MISSING_FIELD'],
      ['costLines/1/lineKey', 'INVALID_VALUE'],
      ['costLines/2/amountUsd', 'INVALID_VALUE'],
      ['costLines/3/quantity', 'INVALID_VALUE'],
      ['costLines/4/amountUsd', 'INVALID_VALUE'],
      ['costLines/5/lineKey', 'INVALID_VALUE'],
    ]);
  });

  it('accepts a blank line and $0', () => {
    expect(
      validateCostLines(
        normalizeCostLines(
          [
            { lineKey: 'other', amountUsd: null },
            { lineKey: 'molds', amountUsd: 0 },
          ],
          defs,
        ),
        defs,
      ),
    ).toEqual([]);
  });
});

describe('FB-23 pack-out calculation (Jim’s examples)', () => {
  const base: PackOutCalcInput = {
    countField: null,
    unitsPerBag: null,
    unitsPerTray: null,
    unitsPerCase: null,
    containersPerLayer: null,
    layersPerPallet: null,
    palletsPerTrailer: null,
    unitsPerPallet: null,
  };

  it('bagged: 84 per bag × 2 per layer × 22 layers = 44 bags, 3,696 per pallet; × 28 = 103,488', () => {
    expect(
      packOutFigures({
        ...base,
        countField: 'unitsPerBag',
        unitsPerBag: 84,
        containersPerLayer: 2,
        layersPerPallet: 22,
        palletsPerTrailer: 28,
      }),
    ).toEqual({
      piecesPerContainer: 84,
      containersPerPallet: 44,
      piecesPerPallet: 3_696,
      piecesPerPalletCalculated: true,
      piecesPerTrailer: 103_488,
    });
  });

  it('carton: 256 per carton × 4 per layer × 5 layers = 20 cartons, 5,120 per pallet; × 28 = 143,360', () => {
    expect(
      packOutFigures({
        ...base,
        countField: 'unitsPerCase',
        unitsPerCase: 256,
        containersPerLayer: 4,
        layersPerPallet: 5,
        palletsPerTrailer: 28,
      }),
    ).toEqual({
      piecesPerContainer: 256,
      containersPerPallet: 20,
      piecesPerPallet: 5_120,
      piecesPerPalletCalculated: true,
      piecesPerTrailer: 143_360,
    });
  });

  it('floor loaded or bulk: pieces per trailer from the typed pieces per pallet', () => {
    expect(packOutFigures({ ...base, unitsPerPallet: 5_000, palletsPerTrailer: 26 })).toMatchObject(
      {
        containersPerPallet: null,
        piecesPerPallet: 5_000,
        piecesPerPalletCalculated: false,
        piecesPerTrailer: 130_000,
      },
    );
  });

  it('a missing input leaves its figures blank, never 0', () => {
    expect(
      packOutFigures({
        ...base,
        countField: 'unitsPerBag',
        containersPerLayer: 2,
        layersPerPallet: 22,
      }),
    ).toMatchObject({
      piecesPerContainer: null,
      containersPerPallet: 44,
      piecesPerPallet: null,
      piecesPerPalletCalculated: true,
      piecesPerTrailer: null,
    });
    expect(
      packOutFigures({
        ...base,
        countField: 'unitsPerBag',
        unitsPerBag: 84,
        containersPerLayer: 2,
      }),
    ).toMatchObject({ containersPerPallet: null, piecesPerPallet: null, piecesPerTrailer: null });
    expect(packOutFigures(base)).toEqual({
      piecesPerContainer: null,
      containersPerPallet: null,
      piecesPerPallet: null,
      piecesPerPalletCalculated: false,
      piecesPerTrailer: null,
    });
  });

  it('reads the method’s count field from its value-list meta', () => {
    expect(packMethodCountField({ countField: 'unitsPerCase' })).toBe('unitsPerCase');
    expect(packMethodCountField({ countField: 'unitsPerPallet' })).toBeNull();
    expect(packMethodCountField({})).toBeNull();
    expect(packMethodCountField(null)).toBeNull();
  });

  it('with a method, keeps only its count; with none, leaves the counts alone', () => {
    const counts = { unitsPerBag: 1, unitsPerTray: 2, unitsPerCase: 3 };
    expect(normalizePackOutCounts(counts, 'CARTON', 'unitsPerCase')).toEqual({
      unitsPerBag: null,
      unitsPerTray: null,
      unitsPerCase: 3,
    });
    expect(normalizePackOutCounts(counts, 'BULK', null)).toEqual({
      unitsPerBag: null,
      unitsPerTray: null,
      unitsPerCase: null,
    });
    expect(normalizePackOutCounts(counts, null, null)).toEqual(counts);
  });
});

describe('FB-23 labor and field checks', () => {
  it('adds packers and operators per line, fractional', () => {
    expect(laborTotalPerLine(0.68, 1)).toBe(1.68);
    expect(laborTotalPerLine(0.1, 0.2)).toBe(0.3);
    expect(laborTotalPerLine(null, 2)).toBe(2);
    expect(laborTotalPerLine(null, null)).toBeNull();
  });

  const empty: CostEstimateFields = {
    moldLeadTime: null,
    packersPerLine: null,
    operatorsPerLine: null,
    packContainerItemNo: null,
    packContainerDescription: null,
    containersPerLayer: null,
    layersPerPallet: null,
    palletBuildHeight: null,
    palletsPerTrailer: null,
    specialPackagingNote: null,
    returnableDunnageDescription: null,
    returnableDunnageCostUsd: null,
    toolingMarkupPct: null,
  };

  it('trims text and accepts an empty estimate', () => {
    expect(
      normalizeCostEstimate({ ...empty, moldLeadTime: '  16-18 weeks ', palletBuildHeight: ' ' }),
    ).toMatchObject({
      moldLeadTime: '16-18 weeks',
      palletBuildHeight: null,
    });
    expect(validateCostEstimate(empty)).toEqual([]);
  });

  it('refuses out-of-range values', () => {
    const errors = validateCostEstimate({
      ...empty,
      moldLeadTime: 'x'.repeat(41),
      packersPerLine: 100,
      operatorsPerLine: 0.555,
      containersPerLayer: 0,
      layersPerPallet: 1.5,
      palletsPerTrailer: 1000,
      returnableDunnageCostUsd: -5,
      toolingMarkupPct: 101,
    });
    expect(errors.map((e) => e.field).sort()).toEqual(
      [
        'containersPerLayer',
        'layersPerPallet',
        'moldLeadTime',
        'operatorsPerLine',
        'packersPerLine',
        'palletsPerTrailer',
        'returnableDunnageCostUsd',
        'toolingMarkupPct',
      ].sort(),
    );
  });
});
