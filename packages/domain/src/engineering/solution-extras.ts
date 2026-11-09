import { DomainError } from '../errors';

/**
 * FB-06 (F-024, F-025): two small groups of Engineering Review fields that Pricing reads when it costs.
 *
 * - **Two-step (preform) process** (F-024, D-007 open: built as a simple checkbox, provisional). A
 *   checkbox reveals the preform plant, the blow plant, the preform number and a note on freight between
 *   the plants. Unticking it clears the four details, so a hidden value never reaches Pricing.
 * - **Pack-out** (F-025, A-014 not yet confirmed by Engineering: built as optional fields, provisional).
 *   Units per bag, per tray, per case and per pallet: whole numbers, all optional.
 */

export const PREFORM_NUMBER_MAX_LENGTH = 40;
export const TWO_STEP_FREIGHT_NOTE_MAX_LENGTH = 300;
/** A pack-out count is a whole number from 1 to this (seven digits is far beyond any real pallet). */
export const PACK_OUT_MAX = 9_999_999;

export const TWO_STEP_DETAIL_FIELDS = [
  'preformPlantCode',
  'blowPlantCode',
  'preformNumber',
  'twoStepFreightNote',
] as const;

export const PACK_OUT_FIELDS = [
  'unitsPerBag',
  'unitsPerTray',
  'unitsPerCase',
  'unitsPerPallet',
] as const;

export type TwoStepDetailField = (typeof TWO_STEP_DETAIL_FIELDS)[number];
export type PackOutField = (typeof PACK_OUT_FIELDS)[number];

export const PACK_OUT_LABELS: Record<PackOutField, string> = {
  unitsPerBag: 'Units per bag',
  unitsPerTray: 'Units per tray',
  unitsPerCase: 'Units per case',
  unitsPerPallet: 'Units per pallet',
};

export interface SolutionExtras {
  twoStep: boolean;
  preformPlantCode: string | null;
  blowPlantCode: string | null;
  preformNumber: string | null;
  twoStepFreightNote: string | null;
  unitsPerBag: number | null;
  unitsPerTray: number | null;
  unitsPerCase: number | null;
  unitsPerPallet: number | null;
}

export const EMPTY_SOLUTION_EXTRAS: SolutionExtras = {
  twoStep: false,
  preformPlantCode: null,
  blowPlantCode: null,
  preformNumber: null,
  twoStepFreightNote: null,
  unitsPerBag: null,
  unitsPerTray: null,
  unitsPerCase: null,
  unitsPerPallet: null,
};

const blankToNull = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * The extras as they will be stored: text trimmed (blank = empty), and the four two-step details cleared
 * when the process is not two-step. Pure; the caller compares before and after to audit what moved.
 */
export function normalizeSolutionExtras(input: SolutionExtras): SolutionExtras {
  const out: SolutionExtras = {
    ...input,
    preformPlantCode: blankToNull(input.preformPlantCode),
    blowPlantCode: blankToNull(input.blowPlantCode),
    preformNumber: blankToNull(input.preformNumber),
    twoStepFreightNote: blankToNull(input.twoStepFreightNote),
  };
  if (!out.twoStep) {
    for (const f of TWO_STEP_DETAIL_FIELDS) out[f] = null;
  }
  return out;
}

/** Length and whole-number checks (the route's zod schema checks the same; the domain is the rule). */
export function validateSolutionExtras(extras: SolutionExtras): DomainError[] {
  const errors: DomainError[] = [];
  if ((extras.preformNumber?.length ?? 0) > PREFORM_NUMBER_MAX_LENGTH) {
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        `Keep the preform number to ${PREFORM_NUMBER_MAX_LENGTH} characters`,
        'preformNumber',
      ),
    );
  }
  if ((extras.twoStepFreightNote?.length ?? 0) > TWO_STEP_FREIGHT_NOTE_MAX_LENGTH) {
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        `Keep the freight note to ${TWO_STEP_FREIGHT_NOTE_MAX_LENGTH} characters`,
        'twoStepFreightNote',
      ),
    );
  }
  for (const f of PACK_OUT_FIELDS) {
    const v = extras[f];
    if (v === null) continue;
    if (!Number.isInteger(v) || v < 1 || v > PACK_OUT_MAX) {
      errors.push(
        new DomainError(
          'INVALID_VALUE',
          `${PACK_OUT_LABELS[f]} must be a whole number from 1 to ${PACK_OUT_MAX.toLocaleString('en-US')}`,
          f,
        ),
      );
    }
  }
  return errors;
}

/** The pack-out lines worth showing: only the counts Engineering entered, in a fixed order. */
export function packOutSummary(
  extras: Pick<SolutionExtras, PackOutField>,
): { field: PackOutField; label: string; value: number }[] {
  return PACK_OUT_FIELDS.flatMap((field) => {
    const value = extras[field];
    return value === null ? [] : [{ field, label: PACK_OUT_LABELS[field], value }];
  });
}
