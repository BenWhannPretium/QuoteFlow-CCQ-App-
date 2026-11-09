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

export interface CommercialInputConfig {
  /** app_setting `standard_payment_terms`. */
  standardPaymentTerms: readonly string[];
  /** `price_basis` list codes whose meta says `delivered: true`. */
  deliveredPriceBasisCodes: readonly string[];
}

export interface CommercialInputIssue {
  code: 'INVALID_VALUE' | 'ENRICH';
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
  if (
    isDeliveredPrice(priceBasis, config.deliveredPriceBasisCodes) &&
    !isPresent(values.freight_type)
  ) {
    warnings.push({
      code: 'ENRICH',
      field: 'freight_type',
      message: 'Engineering may ask about this.',
    });
  }
  return { blocking, warnings };
}
