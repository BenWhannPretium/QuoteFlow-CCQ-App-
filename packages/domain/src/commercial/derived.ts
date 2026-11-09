import { g4CheckFields, type G4Check } from './g4-checks';
import { passThroughEligible, type PassThroughSetting } from './pass-through';
import { legalReviewReasons, type LegalReviewTriggers } from './terms';
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
}

/**
 * B-26: fields the server derives for the gate rules from config, never typed by a user (like B-13's
 * `validity_lapsed`): whether a Legal review is required at G4, and whether a price falls below the
 * pass-through threshold at G3. FB-01 (F-069): and which G4 checks block (`g4_required_checks`). FB-07: and whether the quote needs an ROI (`roi_required_when`). Added to the quote's fields before any rule is evaluated, so the
 * decision dialog's "missing" list and the decision itself agree. The customer's status
 * (`customer_status`: existing | not_yet_established) comes with the quote's state.
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
  roi_required: boolean;
  roi_required_reasons: RoiReason[];
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
    // FB-07 (D-001): G3 needs the ROI model only when this is true (capital required, $0 CER included).
    ...(() => {
      const roi = roiRequirement(fields, settings.roiRequiredWhen);
      return { roi_required: roi.required, roi_required_reasons: roi.reasons };
    })(),
  };
}

/** `state` with its derived fields filled in. */
export function withDerivedFields(state: QuoteState, settings: DerivedFieldSettings): QuoteState {
  return {
    ...state,
    fields: { ...state.fields, ...derivedDecisionFields(state.fields, settings) },
  };
}
