import { describe, expect, it } from 'vitest';

import {
  CAPACITY_BASIS_SEED,
  MAX_STORED_UTILIZATION_PCT,
  allocationCheck,
  annualCapacityUnits,
  capacityAtAGlance,
  computeUtilization,
  invalidCapacityInputs,
  parseCapacityBasis,
  roundPct,
  storedUtilizationPct,
  utilizationLevel,
  type CapacityInputs,
} from './capacity';

// The worked example from the FB-03 prompt: cycle 10 s, 4 cavities, 80 % effectiveness, 350 days.
const base: CapacityInputs = {
  cycleTimeS: 10,
  cavitation: 4,
  effectivenessPct: 80,
  scheduledRunDaysPerYear: 350,
  allocatedAnnualVolume: 4_838_400,
  utilizationBeforePct: 40,
};

describe('annualCapacityUnits', () => {
  it('(86 400 / 10) x 4 x 0.8 x 350 = 9 676 800 units a year', () => {
    expect(annualCapacityUnits(base)).toBeCloseTo(9_676_800, 6);
  });

  it("applies the effectiveness once (Faron Ipox's step 2 names it twice: A-023)", () => {
    const once = annualCapacityUnits(base)!;
    const twice = annualCapacityUnits({ ...base, effectivenessPct: 80 })! * 0.8;
    expect(once).toBeGreaterThan(twice);
  });

  it.each([
    ['zero cycle time', { cycleTimeS: 0 }],
    ['negative cycle time', { cycleTimeS: -3 }],
    ['no cycle time', { cycleTimeS: null }],
    ['no cavitation', { cavitation: null }],
    ['zero cavitation', { cavitation: 0 }],
    ['zero effectiveness', { effectivenessPct: 0 }],
    ['no run days', { scheduledRunDaysPerYear: 0 }],
    ['NaN cycle time', { cycleTimeS: Number.NaN }],
  ])('is null for %s (no division by zero)', (_, over) => {
    expect(annualCapacityUnits({ ...base, ...over })).toBeNull();
  });
});

describe('computeUtilization', () => {
  it('adds the allocated volume as a share of annual capacity to the utilization before', () => {
    // 4 838 400 / 9 676 800 = 50 %, on top of 40 % before
    const r = computeUtilization(base);
    expect(r.ok && r.annualCapacityUnits).toBeCloseTo(9_676_800, 6);
    expect(r.ok && r.addedUtilizationPct).toBeCloseTo(50, 9);
    expect(r.ok && r.utilizationAfterPct).toBeCloseTo(90, 9);
  });

  it('a row with no new volume keeps its utilization before', () => {
    const r = computeUtilization({ ...base, allocatedAnnualVolume: 0 });
    expect(r.ok && r.utilizationAfterPct).toBe(40);
  });

  it('can exceed 100 %', () => {
    const r = computeUtilization({ ...base, allocatedAnnualVolume: 9_676_800 });
    expect(r.ok && r.utilizationAfterPct).toBeCloseTo(140, 9);
  });

  it('says which inputs block the calculation instead of returning NaN or Infinity', () => {
    expect(computeUtilization({ ...base, cycleTimeS: 0, cavitation: null })).toEqual({
      ok: false,
      invalid: ['cycleTimeS', 'cavitation'],
    });
    expect(invalidCapacityInputs({ ...base, utilizationBeforePct: 101 })).toEqual([
      'utilizationBeforePct',
    ]);
    expect(invalidCapacityInputs({ ...base, allocatedAnnualVolume: -1 })).toEqual([
      'allocatedAnnualVolume',
    ]);
    expect(invalidCapacityInputs({ ...base, cavitation: 2.5 })).toEqual(['cavitation']);
    expect(invalidCapacityInputs(base)).toEqual([]);
  });
});

describe('rounding and levels', () => {
  it('rounds for display to one decimal place and for storage to two', () => {
    expect(roundPct(84.96)).toBe(85);
    expect(roundPct(12.34)).toBe(12.3);
    // Exact on the decimal digits, not off by a float error.
    expect(roundPct(44.65)).toBe(44.7);
    expect(roundPct(1.005, 2)).toBe(1.01);
    expect(roundPct(0)).toBe(0);
    expect(storedUtilizationPct(12.3456)).toBe(12.35);
    expect(storedUtilizationPct(1e12)).toBe(MAX_STORED_UTILIZATION_PCT);
  });

  it('is red over 100, amber over the warning threshold, otherwise fine', () => {
    const basis = { warnAbovePct: 85 };
    expect(utilizationLevel(100.1, basis)).toBe('over');
    expect(utilizationLevel(100, basis)).toBe('warn');
    expect(utilizationLevel(85.1, basis)).toBe('warn');
    expect(utilizationLevel(85, basis)).toBe('ok');
    expect(utilizationLevel(20, basis)).toBe('ok');
  });

  it('judges the value the user sees: 100.04 shows as 100.0 and is not red', () => {
    expect(utilizationLevel(100.04, { warnAbovePct: 85 })).toBe('warn');
    expect(utilizationLevel(100.06, { warnAbovePct: 85 })).toBe('over');
  });

  it('honours a changed warning threshold', () => {
    expect(utilizationLevel(75, { warnAbovePct: 70 })).toBe('warn');
  });
});

describe('capacity_basis setting', () => {
  it('falls back to the provisional seed', () => {
    expect(parseCapacityBasis(undefined)).toEqual(CAPACITY_BASIS_SEED);
    expect(parseCapacityBasis(null)).toEqual(CAPACITY_BASIS_SEED);
    expect(CAPACITY_BASIS_SEED).toEqual({
      scheduledRunDaysPerYear: 350,
      warnAbovePct: 85,
      basisLabel: 'Trailing 12 months actual, trending OEE (provisional, D-021)',
    });
  });

  it('accepts a valid value and rejects a malformed one', () => {
    const value = { scheduledRunDaysPerYear: 330, warnAbovePct: 80, basisLabel: 'Nameplate' };
    expect(parseCapacityBasis(value)).toEqual(value);
    expect(() => parseCapacityBasis({ ...value, scheduledRunDaysPerYear: 0 })).toThrow(
      /capacity_basis/,
    );
    expect(() => parseCapacityBasis({ ...value, warnAbovePct: 120 })).toThrow(/capacity_basis/);
    expect(() => parseCapacityBasis('350')).toThrow(/capacity_basis/);
  });
});

describe('allocationCheck (T-030: the business split across lines)', () => {
  it('is quiet when the rows add up to the quote volume', () => {
    expect(
      allocationCheck(
        [{ allocatedAnnualVolume: 600_000 }, { allocatedAnnualVolume: 400_000 }],
        1_000_000,
      ),
    ).toBeNull();
  });

  it('warns when the rows allocate more or less than the quote volume', () => {
    const more = allocationCheck(
      [{ allocatedAnnualVolume: 700_000 }, { allocatedAnnualVolume: 400_000 }],
      1_000_000,
    );
    expect(more).toMatchObject({ allocated: 1_100_000, total: 1_000_000, difference: 100_000 });
    expect(more?.message).toContain('100,000 more than');
    const fewer = allocationCheck([{ allocatedAnnualVolume: 600_000 }], 1_000_000);
    expect(fewer).toMatchObject({ difference: -400_000 });
    expect(fewer?.message).toContain('400,000 fewer than');
  });

  it('has nothing to compare without rows or a quote volume', () => {
    expect(allocationCheck([], 1_000_000)).toBeNull();
    expect(allocationCheck([{ allocatedAnnualVolume: 5 }], null)).toBeNull();
  });
});

// FB-14: the Capacity Exhibit's three definitions, against hand-computed values from made-up inputs:
// 12 s cycle, 4 cavities, 75 % OEE, 30 g part.
//   theoretical: 86,400 / 12 x 4 = 28,800 a day; x 365 = 10,512,000 a year
//   expected:    28,800 x 0.75   = 21,600 a day; x 365 =  7,884,000 a year
//   practical:   21,600 a day x 350 run days = 7,560,000 (24/5 at 261 days: 5,637,600)
describe('capacityAtAGlance (FB-14)', () => {
  const base = {
    cycleTimeS: 12,
    cavitation: 4,
    effectivenessPct: 75,
    scheduledRunDaysPerYear: 350,
  };

  it('gives theoretical, expected and practical capacity per day and per year', () => {
    const g = capacityAtAGlance(base)!;
    expect(g.theoretical).toMatchObject({ perDay: 28_800, perYear: 10_512_000 });
    expect(g.expected).toMatchObject({ perDay: 21_600, perYear: 7_884_000 });
    expect(g.practical).toMatchObject({ perDay: 21_600, perYear: 7_560_000 });
    expect(g.runDaysPerYear).toBe(350);
    expect(g.practical.lbsPerDay).toBeNull();
  });

  it('applies OEE once: the practical year is exactly the utilization denominator', () => {
    const g = capacityAtAGlance(base)!;
    expect(g.practical.perYear).toBe(annualCapacityUnits(base));
    expect(g.expected.perDay / g.theoretical.perDay).toBeCloseTo(0.75, 10);
  });

  it('a 24/5 schedule (261 run days) changes only the practical year', () => {
    const g = capacityAtAGlance({ ...base, scheduledRunDaysPerYear: 261 })!;
    expect(g.practical.perYear).toBe(5_637_600);
    expect(g.expected.perYear).toBe(7_884_000);
  });

  it('gives pounds only when the part weight is known', () => {
    const g = capacityAtAGlance({ ...base, partWeightG: 30 })!;
    // 28,800 parts x 30 g = 864,000 g = 1,904.79 lb
    expect(g.theoretical.lbsPerDay!).toBeCloseTo(1904.79, 1);
    expect(g.practical.lbsPerYear!).toBeCloseTo((7_560_000 * 30) / 453.59237, 3);
  });

  it('a missing or unusable input gives no result, never zero', () => {
    expect(capacityAtAGlance({ ...base, cycleTimeS: null })).toBeNull();
    expect(capacityAtAGlance({ ...base, cavitation: undefined })).toBeNull();
    expect(capacityAtAGlance({ ...base, effectivenessPct: 0 })).toBeNull();
    expect(capacityAtAGlance({ ...base, scheduledRunDaysPerYear: null })).toBeNull();
    expect(capacityAtAGlance({ ...base, effectivenessPct: 120 })).toBeNull();
  });
});
