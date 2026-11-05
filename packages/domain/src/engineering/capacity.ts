import { DomainError } from '../errors';

/**
 * FB-03 (F-059): line utilization before and after the new business, calculated and not typed.
 *
 * The shape is Faron Ipox's email of 2026-11-04 (tracker Q-035, copied verbatim to
 * `docs/build-guide/feedback/inputs/capacity-formula.md`). His step 2 applies the trending OEE twice,
 * which is almost certainly a typo (A-023 asks him to confirm), so OEE is applied ONCE here:
 *
 *   annualCapacityUnits  = (86_400 / cycleTimeS) x cavitation x (effectivenessPct / 100) x scheduledRunDaysPerYear
 *   addedUtilizationPct  = allocatedAnnualVolume / annualCapacityUnits x 100
 *   utilizationAfterPct  = utilizationBeforePct + addedUtilizationPct
 *
 * `effectivenessPct` is the row's "Assumed effectiveness %" (the OEE stand-in: never defaulted, DF-22).
 * Pure: no I/O, no clock.
 */

export const SECONDS_PER_DAY = 86_400;

/** The largest value `capacity_evidence.utilization_after_pct` (numeric(7,2)) can hold. */
export const MAX_STORED_UTILIZATION_PCT = 99_999.99;

/**
 * `app_setting.capacity_basis` seed. PROVISIONAL (tracker D-021 is open: Faron Ipox and leadership have
 * not confirmed the basis). `scheduledRunDaysPerYear` defaults each capacity row; `warnAbovePct` turns the
 * after-utilization amber (over 100 is always red); `basisLabel` is shown under the capacity table and in
 * the CSV export.
 */
export interface CapacityBasis {
  scheduledRunDaysPerYear: number;
  warnAbovePct: number;
  basisLabel: string;
}

export const CAPACITY_BASIS_SEED: CapacityBasis = {
  scheduledRunDaysPerYear: 350,
  warnAbovePct: 85,
  basisLabel: 'Trailing 12 months actual, trending OEE (provisional, D-021)',
};

/** The setting's value, or the seed when it is unset. Throws `INVALID_CONFIG` on a malformed value. */
export function parseCapacityBasis(input: unknown): CapacityBasis {
  if (input === undefined || input === null) return { ...CAPACITY_BASIS_SEED };
  const v = input as Partial<Record<keyof CapacityBasis, unknown>>;
  const ok =
    typeof input === 'object' &&
    typeof v.scheduledRunDaysPerYear === 'number' &&
    Number.isInteger(v.scheduledRunDaysPerYear) &&
    v.scheduledRunDaysPerYear >= 1 &&
    v.scheduledRunDaysPerYear <= 366 &&
    typeof v.warnAbovePct === 'number' &&
    v.warnAbovePct > 0 &&
    v.warnAbovePct <= 100 &&
    typeof v.basisLabel === 'string';
  if (!ok) {
    throw new DomainError(
      'INVALID_CONFIG',
      'capacity_basis must be { scheduledRunDaysPerYear (1-366), warnAbovePct (1-100), basisLabel }',
    );
  }
  return {
    scheduledRunDaysPerYear: v.scheduledRunDaysPerYear as number,
    warnAbovePct: v.warnAbovePct as number,
    basisLabel: v.basisLabel as string,
  };
}

export interface CapacityInputs {
  cycleTimeS: number | null | undefined;
  /** From the engineering review. */
  cavitation: number | null | undefined;
  /** The row's assumed effectiveness (OEE stand-in), 0-100. */
  effectivenessPct: number | null | undefined;
  scheduledRunDaysPerYear: number | null | undefined;
  allocatedAnnualVolume: number | null | undefined;
  utilizationBeforePct: number | null | undefined;
}

export type CapacityInputName = keyof CapacityInputs;

export type CapacityResult =
  | {
      ok: true;
      annualCapacityUnits: number;
      addedUtilizationPct: number;
      /** Unrounded. Store with `storedUtilizationPct`, show with `roundPct`. */
      utilizationAfterPct: number;
    }
  | {
      ok: false;
      /** What is missing or not usable (cycle time and OEE must be above 0; cavitation a whole number 1-99). */
      invalid: CapacityInputName[];
    };

const finite = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n);

/** Which inputs cannot be used in the formula (empty when it can be calculated). */
export function invalidCapacityInputs(input: CapacityInputs): CapacityInputName[] {
  const bad: CapacityInputName[] = [];
  if (!finite(input.cycleTimeS) || input.cycleTimeS <= 0) bad.push('cycleTimeS');
  if (!finite(input.cavitation) || !Number.isInteger(input.cavitation) || input.cavitation < 1) {
    bad.push('cavitation');
  }
  if (
    !finite(input.effectivenessPct) ||
    input.effectivenessPct <= 0 ||
    input.effectivenessPct > 100
  ) {
    bad.push('effectivenessPct');
  }
  if (
    !finite(input.scheduledRunDaysPerYear) ||
    input.scheduledRunDaysPerYear < 1 ||
    input.scheduledRunDaysPerYear > 366
  ) {
    bad.push('scheduledRunDaysPerYear');
  }
  if (!finite(input.allocatedAnnualVolume) || input.allocatedAnnualVolume < 0) {
    bad.push('allocatedAnnualVolume');
  }
  if (
    !finite(input.utilizationBeforePct) ||
    input.utilizationBeforePct < 0 ||
    input.utilizationBeforePct > 100
  ) {
    bad.push('utilizationBeforePct');
  }
  return bad;
}

/** Units the line can make in a year at the stated effectiveness, or null when an input is unusable. */
export function annualCapacityUnits(
  input: Pick<
    CapacityInputs,
    'cycleTimeS' | 'cavitation' | 'effectivenessPct' | 'scheduledRunDaysPerYear'
  >,
): number | null {
  const { cycleTimeS, cavitation, effectivenessPct, scheduledRunDaysPerYear } = input;
  if (
    !finite(cycleTimeS) ||
    cycleTimeS <= 0 ||
    !finite(cavitation) ||
    cavitation < 1 ||
    !finite(effectivenessPct) ||
    effectivenessPct <= 0 ||
    !finite(scheduledRunDaysPerYear) ||
    scheduledRunDaysPerYear < 1
  ) {
    return null;
  }
  return (
    (SECONDS_PER_DAY / cycleTimeS) * cavitation * (effectivenessPct / 100) * scheduledRunDaysPerYear
  );
}

/** Utilization after the new business. `ok: false` lists the inputs that block the calculation. */
export function computeUtilization(input: CapacityInputs): CapacityResult {
  const invalid = invalidCapacityInputs(input);
  if (invalid.length > 0) return { ok: false, invalid };
  const capacity = annualCapacityUnits(input)!;
  const added = (input.allocatedAnnualVolume! / capacity) * 100;
  return {
    ok: true,
    annualCapacityUnits: capacity,
    addedUtilizationPct: added,
    utilizationAfterPct: input.utilizationBeforePct! + added,
  };
}

/**
 * Round half up to `places` decimals (one decimal place for display). Done on the decimal string, so
 * 44.65 gives 44.7 and 1.005 gives 1.01 (`Math.round(x * 10)` gets both wrong by a float error).
 */
export function roundPct(value: number, places = 1): number {
  if (!Number.isFinite(value)) return value;
  const text = String(value);
  if (text.includes('e')) {
    const f = 10 ** places;
    return Math.round(value * f) / f;
  }
  return Number(`${Math.round(Number(`${text}e${places}`))}e-${places}`);
}

/** The value as stored in `numeric(7,2)`: two decimals, capped so it cannot overflow the column. */
export function storedUtilizationPct(value: number): number {
  return Math.min(roundPct(value, 2), MAX_STORED_UTILIZATION_PCT);
}

export type UtilizationLevel = 'ok' | 'warn' | 'over';

/**
 * How to show an after-utilization: over 100 % is red ("exceeds line capacity"), over `warnAbovePct`
 * amber. Judged on the one-decimal value the user sees, so "100.0%" is never red.
 */
export function utilizationLevel(
  afterPct: number,
  basis: Pick<CapacityBasis, 'warnAbovePct'>,
): UtilizationLevel {
  const shown = roundPct(afterPct, 1);
  if (shown > 100) return 'over';
  if (shown > basis.warnAbovePct) return 'warn';
  return 'ok';
}

export const EXCEEDS_CAPACITY_MESSAGE = 'exceeds line capacity';

export interface AllocationCheck {
  allocated: number;
  total: number;
  /** allocated - total: positive when the rows add up to more than the quote's volume. */
  difference: number;
  message: string;
}

/**
 * T-030: when the business is split across lines or plants the rows' allocated volumes should add up to
 * the quote's estimated annual volume. A mismatch is a WARNING for the engineer, never a block (a share
 * may be deliberately held back, or the KAM's volume may be about to change). Null when they match, there
 * are no rows, or the quote has no volume.
 */
export function allocationCheck(
  rows: readonly { allocatedAnnualVolume: number | null | undefined }[],
  quoteAnnualVolume: number | null | undefined,
): AllocationCheck | null {
  if (rows.length === 0 || !finite(quoteAnnualVolume)) return null;
  const allocated = rows.reduce((sum, r) => sum + (r.allocatedAnnualVolume ?? 0), 0);
  if (allocated === quoteAnnualVolume) return null;
  const difference = allocated - quoteAnnualVolume;
  const n = (v: number) => Math.abs(v).toLocaleString('en-US');
  return {
    allocated,
    total: quoteAnnualVolume,
    difference,
    message:
      difference > 0
        ? `The rows allocate ${n(allocated)} units a year, ${n(difference)} more than the quote's ${n(quoteAnnualVolume)}.`
        : `The rows allocate ${n(allocated)} units a year, ${n(difference)} fewer than the quote's ${n(quoteAnnualVolume)}.`,
  };
}
