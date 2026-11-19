import { g4CheckFields, type G4Check } from './g4-checks';
import { passThroughEligible, type PassThroughSetting } from './pass-through';
import { legalReviewReasons, termsExceptionOpen, type LegalReviewTriggers } from './terms';
import { CAPITAL_NEEDED_ABOVE_USD_SEED, engCapitalNeeded } from '../engineering/capital-needed';
import { cerProofOk } from '../outcome/requote';
import {
  paybackFromFields,
  paybackNeeded,
  roiRequirement,
  type RoiReason,
  type RoiRequiredWhen,
} from '../quoting-steps';
import type { QuoteState } from '../types/quote';
import { quoteItemFacts } from '../workflow/item-rules';

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
  /**
   * FB-26 (N17-32): `app_setting.handoff_cer_proof_required`. When true, G6 Advance needs a CER proof file
   * while the CER is Approved. Omitted = the seed (false).
   */
  cerProofRequired?: boolean;
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
  g4_tooling_commitment_check_required: boolean;
  terms_exception_open: boolean;
  roi_required: boolean;
  roi_required_reasons: RoiReason[];
  payback_received: boolean;
  eng_capital_needed: boolean;
  capital_not_approved: boolean;
  cer_proof_ok: boolean;
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
    // FB-21 (N17-21; Ben, 2026-11-18): G3 needs the payback model only while someone has asked Finance
    // for one (`roi_required`), and it is there once Finance uploads one after the request
    // (`payback_received`). `roi_required_reasons` is the `roi_required_when` hint.
    ...(() => {
      const payback = paybackFromFields(fields);
      return {
        roi_required: paybackNeeded(payback.status),
        roi_required_reasons: roiRequirement(fields, settings.roiRequiredWhen).reasons,
        payback_received: payback.status === 'received',
      };
    })(),
    // FB-17 (W13-22): the G2 rules ask for the equipment BOM exactly when this is true. FB-19: with
    // items, capital is needed when any item's preliminary capital says so.
    eng_capital_needed: (() => {
      const threshold = settings.capitalNeededAboveUsd ?? CAPITAL_NEEDED_ABOVE_USD_SEED;
      const items = quoteItemFacts(fields);
      return items
        ? items.some((i) => engCapitalNeeded(i.prelim_capital_usd, threshold))
        : engCapitalNeeded(fields.prelim_capital_usd, threshold);
    })(),
    // FB-21 (N17-20; Ben, 2026-11-18): G3 Advance is refused while capital readiness is "not approved"
    // (a recommendation to stop). Pending never blocks.
    capital_not_approved:
      (fields.pricing_record as { capital_readiness?: unknown } | null | undefined)
        ?.capital_readiness === 'not_approved',
    // FB-26 (N17-32): with `handoff_cer_proof_required` on, an Approved CER needs a CER proof file (G6).
    cer_proof_ok: cerProofOk({
      required: settings.cerProofRequired ?? false,
      cerStatus: (fields.handoff_record as { cer_status?: string | null } | null | undefined)
        ?.cer_status,
      proofOnFile: fields.cer_proof_on_file === true,
    }),
  };
}

/**
 * `state` with its derived fields filled in. FB-19: each item gets its own `eng_capital_needed` too, so a
 * G2 rule that reads it is checked per item (an item needing capital needs the equipment BOM).
 */
export function withDerivedFields(state: QuoteState, settings: DerivedFieldSettings): QuoteState {
  const items = quoteItemFacts(state.fields);
  const threshold = settings.capitalNeededAboveUsd ?? CAPITAL_NEEDED_ABOVE_USD_SEED;
  return {
    ...state,
    fields: {
      ...state.fields,
      ...derivedDecisionFields(state.fields, settings),
      ...(items
        ? {
            items: items.map((i) => ({
              ...i,
              eng_capital_needed: engCapitalNeeded(i.prelim_capital_usd, threshold),
            })),
          }
        : {}),
    },
  };
}
