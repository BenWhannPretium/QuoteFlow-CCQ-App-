import { passThroughEligible, type PassThroughSetting } from './pass-through';
import { legalReviewReasons, type LegalReviewTriggers } from './terms';
import type { QuoteState } from '../types/quote';

/** The settings the derived decision fields depend on. */
export interface DerivedFieldSettings {
  legalReviewTriggers: LegalReviewTriggers;
  passThrough: PassThroughSetting;
}

/**
 * B-26: fields the server derives for the gate rules from config, never typed by a user (like B-13's
 * `validity_lapsed`): whether a Legal review is required at G4, and whether a price falls below the
 * pass-through threshold at G3. Added to the quote's fields before any rule is evaluated, so the
 * decision dialog's "missing" list and the decision itself agree.
 */
export function derivedDecisionFields(
  fields: QuoteState['fields'],
  customerStatus: string | null,
  settings: DerivedFieldSettings,
): {
  legal_review_required: boolean;
  legal_review_reasons: string[];
  pass_through_eligible: boolean;
} {
  const reasons = legalReviewReasons(settings.legalReviewTriggers, {
    customerStatus,
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
  };
}

/** `state` with its derived fields filled in. */
export function withDerivedFields(
  state: QuoteState,
  customerStatus: string | null,
  settings: DerivedFieldSettings,
): QuoteState {
  return {
    ...state,
    fields: { ...state.fields, ...derivedDecisionFields(state.fields, customerStatus, settings) },
  };
}
