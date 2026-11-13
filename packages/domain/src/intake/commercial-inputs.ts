import { INTAKE_TEXT_LIMITS } from './product-facts';
import { isPresent } from '../workflow/rules';
import type { FieldValues } from '../workflow/rules';

/**
 * FB-11 (D-032, decided 2026-11-06 by Gemma Cebolla and Bailey Schmitt): the commercial inputs the KAM
 * gives at intake because Pricing needs them before costing: the payment terms the customer asks for,
 * whether the customer funds any of the tooling, returnable dunnage, delivered or FOB price with the
 * freight type, and a bid / program reference. Pure: the lists and the standard payment terms come in
 * as config (value lists, app setting `standard_payment_terms`), all provisional. Nothing here is
 * required to submit (D-006 is open): a missing value is a warning.
 */

/** Intake fields (snake_case) added by FB-11 that live on the quote, for the "cleared" and audit lists. */
export const COMMERCIAL_INPUT_FIELDS = [
  'requested_payment_terms',
  'requested_payment_terms_other',
  'tooling_funding_model',
  'returnable_dunnage',
  'price_basis',
  'freight_type',
  'freight_special_arrangements',
  'bid_reference',
  // FB-15 (W13-09): the customer's share when funding is Shared.
  'customer_share_pct',
] as const;

/** The freight fields that only apply to a delivered price; cleared when the price basis is FOB. */
export const FREIGHT_FIELDS = ['freight_type', 'freight_special_arrangements'] as const;

/**
 * F-080: the requested payment terms are non-standard when one is chosen and it is not in the standard
 * set (app setting `standard_payment_terms`, seeded `["NET_15","NET_30"]`, provisional; A-012). "Other"
 * is non-standard by definition. A blank answer is not flagged (it is a missing value, not a request).
 */
export function isNonStandardPaymentTerms(
  code: string | null | undefined,
  standardCodes: readonly string[],
): boolean {
  if (typeof code !== 'string' || code.trim() === '') return false;
  return !standardCodes.includes(code);
}

/** F-080: the price is delivered when the price basis is one of the codes flagged `delivered` (list meta). */
export function isDeliveredPrice(
  priceBasis: string | null | undefined,
  deliveredCodes: readonly string[],
): boolean {
  return typeof priceBasis === 'string' && deliveredCodes.includes(priceBasis);
}

/**
 * F-080: freight type and special arrangements only apply to a delivered price. When the price basis is
 * anything else they are cleared when the intake is stored (and by the wizard when the KAM switches).
 */
export function inapplicableCommercialFields(
  values: FieldValues,
  deliveredCodes: readonly string[],
): string[] {
  const priceBasis = typeof values.price_basis === 'string' ? values.price_basis : null;
  return isDeliveredPrice(priceBasis, deliveredCodes) ? [] : [...FREIGHT_FIELDS];
}

/** FB-15 (W13-09): funding is "Shared" (a code whose list meta says `customerShare`). */
export function isSharedFunding(code: unknown, sharedFundingCodes: readonly string[]): boolean {
  return typeof code === 'string' && sharedFundingCodes.includes(code);
}

/** FB-15 (W13-09): "Customer share %" is 0–100, a whole number or one decimal (numeric(5,2) on the quote). */
export const CUSTOMER_SHARE_RANGE = { min: 0, max: 100 } as const;

export function isValidCustomerShare(v: unknown): boolean {
  return (
    typeof v === 'number' &&
    Number.isFinite(v) &&
    v >= CUSTOMER_SHARE_RANGE.min &&
    v <= CUSTOMER_SHARE_RANGE.max &&
    Math.abs(v * 10 - Math.round(v * 10)) < 1e-9
  );
}

export const CUSTOMER_SHARE_MESSAGE =
  'Customer share must be a percentage from 0 to 100, a whole number or one decimal';

export interface CommercialInputConfig {
  /** app_setting `standard_payment_terms`. */
  standardPaymentTerms: readonly string[];
  /** `price_basis` list codes whose meta says `delivered: true`. */
  deliveredPriceBasisCodes: readonly string[];
  /** FB-15 (W13-03): `freight_type` codes whose meta says `freeText` ("Other"): the arrangements are then required. */
  freightOtherCodes?: readonly string[];
  /** FB-15 (W13-09): `tooling_funding_model` codes whose meta says `customerShare` ("Shared"). */
  sharedFundingCodes?: readonly string[];
}

export interface CommercialInputIssue {
  code: 'INVALID_VALUE' | 'ENRICH' | 'MISSING_FIELD';
  field: string;
  message: string;
}

const tooLong = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > max;

/**
 * Length checks (blocking: a value that cannot be stored) and the missing-value warnings for a delivered
 * price (amber: "Engineering may ask about this"). The "Other" payment-terms description reuses the
 * Custom-value rule (`productFactIssues`).
 */
export function commercialInputIssues(
  values: FieldValues,
  config: CommercialInputConfig,
): { blocking: CommercialInputIssue[]; warnings: CommercialInputIssue[] } {
  const blocking: CommercialInputIssue[] = [];
  const warnings: CommercialInputIssue[] = [];
  for (const field of ['bid_reference', 'freight_special_arrangements'] as const) {
    if (tooLong(values[field], INTAKE_TEXT_LIMITS[field])) {
      blocking.push({
        code: 'INVALID_VALUE',
        field,
        message: `Keep it to ${INTAKE_TEXT_LIMITS[field]} characters`,
      });
    }
  }
  const priceBasis = typeof values.price_basis === 'string' ? values.price_basis : null;
  const delivered = isDeliveredPrice(priceBasis, config.deliveredPriceBasisCodes);
  // FB-15 (W13-03, Bailey Schmitt): freight "Other" says what it is, in the special arrangements.
  if (
    delivered &&
    typeof values.freight_type === 'string' &&
    (config.freightOtherCodes ?? []).includes(values.freight_type) &&
    !isPresent(values.freight_special_arrangements)
  ) {
    blocking.push({
      code: 'MISSING_FIELD',
      field: 'freight_special_arrangements',
      message: 'Describe the freight under Special freight arrangements',
    });
  }
  // FB-15 (W13-09): the customer's share of Shared funding is optional; out of range is refused.
  if (
    isSharedFunding(values.tooling_funding_model, config.sharedFundingCodes ?? []) &&
    isPresent(values.customer_share_pct) &&
    !isValidCustomerShare(values.customer_share_pct)
  ) {
    blocking.push({
      code: 'INVALID_VALUE',
      field: 'customer_share_pct',
      message: CUSTOMER_SHARE_MESSAGE,
    });
  }
  if (delivered && !isPresent(values.freight_type)) {
    warnings.push({
      code: 'ENRICH',
      field: 'freight_type',
      message: 'Engineering may ask about this.',
    });
  }
  return { blocking, warnings };
}
