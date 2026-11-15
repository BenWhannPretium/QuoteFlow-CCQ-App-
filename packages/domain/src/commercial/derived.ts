import { g4CheckFields, type G4Check } from './g4-checks';
import { passThroughEligible, type PassThroughSetting } from './pass-through';
import { legalReviewReasons, termsExceptionOpen, type LegalReviewTriggers } from './terms';
import { CAPITAL_NEEDED_ABOVE_USD_SEED, engCapitalNeeded } from '../engineering/capital-needed';
import { roiRequirement, type RoiReason, type RoiRequiredWhen } from '../quoting-steps';
import type { QuoteState } from '../types/quote';

/** The settings the derived decision fields depend on. */
export interface DerivedFieldSettings {
  legalReviewTriggers: LegalReviewTriggers;
  passThrough: PassThroughSetting;
  /** FB-01 (F-069): `app_setting.g4_required_checks`, the checks that block G4 Advance. */
  g4RequiredChecks: readonly G4Check[];
  /** FB-07 (D-001): `app_setting.roi_required_when`, when Quoting's ROI step applies. */
  roiRequiredWhen: RoiRequiredWhen;
  /**
   * FB-17 (W13-22): `app_setting.capital_needed_above_usd`. Capital is needed when the preliminary
   * capital is above it. Omitted = the seed (0).
   */
  capitalNeededAboveUsd?: number;
}

/**
 * B-26: fields the server derives for the gate rules from config, never typed by a user (like B-13's
 * `validity_lapsed`): whether a Legal review is required at G4, and whether a price falls below the
 * pass-through threshold at G3. FB-01 (F-069): and which G4 checks block (`g4_required_checks`). FB-07: and whether the quote needs an ROI (`roi_required_when`). Added to the quote's fields before any rule is evaluated, so the
 * decision dialog's "missing" list and the decision itself agree. The customer's status
 * (`customer_status`: existing | not_yet_established) comes with the quote's state.
 * FB-17 (W13-22): and whether Engineering's preliminary capital means capital is needed
 * (`eng_capital_needed`, from `capital_needed_above_usd`; a blank figure counts as needed).
 */
export function derivedDecisionFields(
  fields: QuoteState['fields'],
  settings: DerivedFieldSettings,
): {
  legal_review_required: boolean;
  legal_review_reasons: string[];
  pass_through_eligible: boolean;
  g4_terms_check_required: boolean;
  g4_legal_review_check_required: boolean;
  g4_terms_exception_check_required: boolean;
  g4_terms_finalized_check_required: boolean;
  terms_exception_open: boolean;
  roi_required: boolean;
  roi_required_reasons: RoiReason[];
  eng_capital_needed: boolean;
} {
  const reasons = legalReviewReasons(settings.legalReviewTriggers, {
    customerStatus: (fields.customer_status as string | null | undefined) ?? null,
    termsNonstandard: (fields.terms_nonstandard as boolean | null | undefined) ?? null,
    termsToolingCommitment: (fields.terms_tooling_commitment as boolean | null | undefined) ?? null,
  });
  return {
    legal_review_required: reasons.length > 0,
    legal_review_reasons: reasons,
    pass_through_eligible: passThroughEligible(
      settings.passThrough,
      fields.est_annual_revenue as number | null | undefined,
    ),
    ...g4CheckFields(settings.g4RequiredChecks),
    // FB-08 (T-007): a pending or rejected payment-terms exception keeps G4 Advance closed.
    terms_exception_open: termsExceptionOpen(
      fields.terms_exception_status as string | null | undefined,
    ),
    // FB-07 (D-001): G3 needs the ROI model only when this is true (capital required, $0 CER included).
    ...(() => {
      const roi = roiRequirement(fields, settings.roiRequiredWhen);
      return { roi_required: roi.required, roi_required_reasons: roi.reasons };
    })(),
    // FB-17 (W13-22): the G2 rules ask for the equipment BOM exactly when this is true.
    eng_capital_needed: engCapitalNeeded(
      fields.prelim_capital_usd,
      settings.capitalNeededAboveUsd ?? CAPITAL_NEEDED_ABOVE_USD_SEED,
    ),
  };
}

/** `state` with its derived fields filled in. */
export function withDerivedFields(state: QuoteState, settings: DerivedFieldSettings): QuoteState {
  return {
    ...state,
    fields: { ...state.fields, ...derivedDecisionFields(state.fields, settings) },
  };
}
