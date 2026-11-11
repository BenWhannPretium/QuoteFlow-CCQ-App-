import { z } from 'zod';

import { wholeNumber } from './messages';
import { SectionLockView } from './problem';

/**
 * B-26 (CCQ demo 10/20 and the future-state process deck): the quote's commercial terms, the Legal
 * review, the early "capital likely" flag and escalations. Nothing here is a price, margin or capital
 * figure, so none of it is commercial-sensitive (architecture §3.3).
 */

const text = (max: number) => z.string().trim().max(max).nullable();

/** PUT /api/v1/quotes/:quoteNumber/capital-flag (capitalFlag.edit). */
export const CapitalFlagBody = z.object({ capitalLikely: z.boolean() }).strict();
export type CapitalFlagBody = z.infer<typeof CapitalFlagBody>;

/** FB-08 (F-068): the capital terms, pre-filled by Sales (terms.edit) and confirmed by the approver. */
const capitalTermFields = {
  /** value_list `mold_ownership` code. */
  termsMoldOwnership: z.string().max(40).nullable(),
  termsAmortized: z.boolean().nullable(),
  termsAmortizationMonths: wholeNumber(1, 120, 'months').nullable(),
  /** Minimum supply / shortfall terms. */
  termsMinSupply: text(300),
  termsAgreementInPlace: z.boolean().nullable(),
  termsAgreementMonths: wholeNumber(1, 240, 'months').nullable(),
};

/**
 * PUT /api/v1/quotes/:quoteNumber/terms (terms.edit). Only the keys sent change; null clears a field.
 * Changing a term after the check clears the check (no silent edits). FB-08: MOQ and tooling funding
 * moved to `/terms/engineering`; the payment terms are a list code (non-standard opens an exception).
 */
export const TermsBody = z
  .object({
    termsToolingCommitment: z.boolean().nullable(),
    /** FB-08 (F-021): value_list `requested_payment_terms` code. */
    termsPaymentTermsCode: z.string().max(40).nullable(),
    /** The detail for "Other" (free text before FB-08). */
    termsPaymentTerms: text(200),
    termsNonstandard: z.boolean(),
    /** FB-08 (D-029): value_list `tooling_payment_terms` code, and a short milestone note. */
    termsToolingPayment: z.string().max(40).nullable(),
    termsMilestoneNote: text(300),
    termsNotes: text(2000),
    ...capitalTermFields,
    /** true records the terms check (who and when); false clears it. */
    checked: z.boolean(),
    /** The Legal review (Legal is not a CCQ role: record who reviewed it and when); null clears it. */
    legal: z
      .object({
        reviewedOn: z.iso.date(),
        reviewerName: z.string().trim().min(1).max(200),
        note: text(2000).optional(),
      })
      .strict()
      .nullable(),
  })
  .partial()
  .strict();
export type TermsBody = z.infer<typeof TermsBody>;

/** FB-08 (F-021): PUT /api/v1/quotes/:quoteNumber/terms/engineering (terms.engineering.edit). */
export const EngineeringTermsBody = z
  .object({
    /** value_list `tooling_funding_model` code. */
    toolingFundingModel: z.string().max(40).nullable(),
    termsMoq: text(200),
  })
  .partial()
  .strict();
export type EngineeringTermsBody = z.infer<typeof EngineeringTermsBody>;

/**
 * FB-08 (F-068, T-031): PUT /api/v1/quotes/:quoteNumber/terms/capital (terms.finalize, the Approver in
 * Final Review). `finalized: true` confirms the capital terms (who and when); changing one clears it.
 */
export const CapitalTermsBody = z
  .object({
    toolingFundingModel: z.string().max(40).nullable(),
    ...capitalTermFields,
    finalized: z.boolean(),
  })
  .partial()
  .strict();
export type CapitalTermsBody = z.infer<typeof CapitalTermsBody>;

/** FB-08 (T-007): POST /api/v1/quotes/:quoteNumber/terms/exception/decision (terms.exception.decide). */
export const TermsExceptionDecisionBody = z
  .object({
    decision: z.enum(['approve', 'reject']),
    rationale: z.string().max(1000),
  })
  .strict();
export type TermsExceptionDecisionBody = z.infer<typeof TermsExceptionDecisionBody>;

/** FB-08 (F-082, off): POST /api/v1/quotes/:quoteNumber/final-review/signoffs (finalReview.signoff). */
export const G4SignoffBody = z
  .object({
    ruleKey: z.string().min(1).max(60),
    signoffKey: z.string().min(1).max(60),
    note: z.string().max(1000).nullable().optional(),
  })
  .strict();
export type G4SignoffBody = z.infer<typeof G4SignoffBody>;

/** FB-08 (F-068): the capital terms as the quote and the review screen show them. */
export const CapitalTermsView = z.object({
  toolingFundingModel: z.string().nullable(),
  moldOwnership: z.string().nullable(),
  amortized: z.boolean().nullable(),
  amortizationMonths: z.number().nullable(),
  minSupply: z.string().nullable(),
  agreementInPlace: z.boolean().nullable(),
  agreementMonths: z.number().nullable(),
  finalizedAt: z.string().nullable(),
  finalizedByName: z.string().nullable(),
  /** `capital_terms_required`: what the approver must fill before confirming. */
  required: z.array(z.string()),
  /** The approver may edit and confirm them (terms.finalize, Final Review, not locked, not segregated). */
  canFinalize: z.boolean(),
  /**
   * DR-approver-leadership-admin-01: why this approver may not edit or confirm them (the G4 segregation
   * rules: they are the quote's KAM or its price approver); null otherwise.
   */
  finalizeBlockedReason: z.string().nullable().optional(),
});
export type CapitalTermsView = z.infer<typeof CapitalTermsView>;

/** FB-08 (T-007): the current payment-terms exception request; null when there is none. */
export const TermsExceptionView = z
  .object({
    status: z.enum(['pending', 'approved', 'rejected']),
    paymentTermsCode: z.string(),
    paymentTermsDetail: z.string().nullable(),
    requestedByName: z.string().nullable(),
    requestedAt: z.string(),
    decidedByName: z.string().nullable(),
    decidedAt: z.string().nullable(),
    rationale: z.string().nullable(),
    /** The viewer may decide it (terms.exception.decide, pending, quote open). */
    canDecide: z.boolean(),
  })
  .nullable();
export type TermsExceptionView = z.infer<typeof TermsExceptionView>;

/** FB-08 (F-082, off until A-035): the extra Final Review sign-offs this quote needs. */
export const AdditionalApprovalView = z.object({
  ruleKey: z.string(),
  ruleLabel: z.string(),
  signoffKey: z.string(),
  signoffLabel: z.string(),
  signedByName: z.string().nullable(),
  signedAt: z.string().nullable(),
  note: z.string().nullable(),
  canSign: z.boolean(),
});
export type AdditionalApprovalView = z.infer<typeof AdditionalApprovalView>;

/** POST /api/v1/quotes/:quoteNumber/escalations (quote.escalate). */
export const EscalationBody = z
  .object({ code: z.string().min(1).max(60), note: z.string().max(2000) })
  .strict();
export type EscalationBody = z.infer<typeof EscalationBody>;

export const EscalationResponse = z.object({
  code: z.string(),
  label: z.string(),
  /** How many people were told. */
  notified: z.number().int(),
});
export type EscalationResponse = z.infer<typeof EscalationResponse>;

/** `QuoteDetail.commercial`. */
export const CommercialDetail = z.object({
  capital: z.object({
    likely: z.boolean(),
    setByName: z.string().nullable(),
    setAt: z.string().nullable(),
    /** When Capital Management was given early notice (awareness, not approval). */
    noticeSentAt: z.string().nullable(),
    canEdit: z.boolean(),
    /** FB-01 (F-001): read-only after G4 Advance, until a send-back reopens it. */
    lock: SectionLockView,
  }),
  terms: z.object({
    toolingFundingModel: z.string().nullable(),
    termsToolingCommitment: z.boolean().nullable(),
    termsMoq: z.string().nullable(),
    /** FB-08 (F-021): the agreed payment terms (list code) and the detail for "Other". */
    termsPaymentTermsCode: z.string().nullable(),
    termsPaymentTerms: z.string().nullable(),
    /** The code is not in `standard_payment_terms`. */
    paymentTermsNonstandard: z.boolean(),
    termsNonstandard: z.boolean(),
    termsToolingPayment: z.string().nullable(),
    termsMilestoneNote: z.string().nullable(),
    termsNotes: z.string().nullable(),
    checkedAt: z.string().nullable(),
    checkedByName: z.string().nullable(),
    /** terms.edit: payment terms, milestones, the check, Legal, the capital pre-fill. */
    canEdit: z.boolean(),
    /** FB-08 (F-021): terms.engineering.edit: MOQ and tooling funding. */
    canEditEngineering: z.boolean(),
    capital: CapitalTermsView,
    exception: TermsExceptionView,
    /** FB-01 (F-001): read-only after G4 Advance, until a send-back reopens it. */
    lock: SectionLockView,
  }),
  legal: z.object({
    /** A configured trigger applies (app_setting `legal_review_triggers`): G4 Advance needs the review. */
    required: z.boolean(),
    reasons: z.array(z.object({ code: z.string(), label: z.string() })),
    reviewedOn: z.string().nullable(),
    reviewerName: z.string().nullable(),
    note: z.string().nullable(),
    recordedByName: z.string().nullable(),
  }),
  /** FB-08 (F-082): extra Final Review sign-offs (empty while the rule is off). */
  additionalApprovals: z.array(AdditionalApprovalView),
  /** The price may proceed without formal approval (below the `pricing_pass_through` threshold). */
  passThroughEligible: z.boolean(),
  hold: z.object({ ownerId: z.string().nullable(), ownerName: z.string().nullable() }),
  escalation: z.object({
    canEscalate: z.boolean(),
    routes: z.array(z.object({ code: z.string(), label: z.string(), description: z.string() })),
    /** The CCQ Process Owner (app_setting `process_owner`); null until named. */
    processOwner: z.object({ name: z.string().nullable(), label: z.string() }),
  }),
});
export type CommercialDetail = z.infer<typeof CommercialDetail>;

export const COMMERCIAL_PROBLEM_CODES = {
  notFound: 'not_found',
  notPermitted: 'not_permitted',
  rejected: 'commercial_change_rejected',
  conflict: 'commercial_conflict',
} as const;
