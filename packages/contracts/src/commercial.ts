import { z } from 'zod';

/**
 * B-26 (CCQ demo 10/20 and the future-state process deck): the quote's commercial terms, the Legal
 * review, the early "capital likely" flag and escalations. Nothing here is a price, margin or capital
 * figure, so none of it is commercial-sensitive (architecture §3.3).
 */

const text = (max: number) => z.string().trim().max(max).nullable();

/** PUT /api/v1/quotes/:quoteNumber/capital-flag (capitalFlag.edit). */
export const CapitalFlagBody = z.object({ capitalLikely: z.boolean() }).strict();
export type CapitalFlagBody = z.infer<typeof CapitalFlagBody>;

/**
 * PUT /api/v1/quotes/:quoteNumber/terms (terms.edit). Only the keys sent change; null clears a field.
 * Changing a term after the check clears the check (no silent edits).
 */
export const TermsBody = z
  .object({
    /** value_list `tooling_funding_model` code. */
    toolingFundingModel: z.string().max(40).nullable(),
    termsToolingCommitment: z.boolean().nullable(),
    termsMoq: text(200),
    termsPaymentTerms: text(200),
    termsNonstandard: z.boolean(),
    termsNotes: text(2000),
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
  }),
  terms: z.object({
    toolingFundingModel: z.string().nullable(),
    termsToolingCommitment: z.boolean().nullable(),
    termsMoq: z.string().nullable(),
    termsPaymentTerms: z.string().nullable(),
    termsNonstandard: z.boolean(),
    termsNotes: z.string().nullable(),
    checkedAt: z.string().nullable(),
    checkedByName: z.string().nullable(),
    canEdit: z.boolean(),
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
