import { z } from 'zod';

// Lead review (2026-10-30): the assigned engineer or pricer submits their part to the lead, who
// moves the quote on (G2 / G3) or sends it back with a note. No imports from quotes.ts here: the
// Engineering and Quoting tabs embed this.

/** FB-22 (N17-14): one part of an engineering review. */
export const EngPartView = z.object({
  ownerName: z.string().nullable(),
  submittedAt: z.string().nullable(),
  submittedByName: z.string().nullable(),
  /** D2: the owner is an engineering lead, so their part needs no submit. */
  ownerIsLead: z.boolean(),
  in: z.boolean(),
});
export type EngPartView = z.infer<typeof EngPartView>;

/** The current round on a tab. `status`: waiting on the lead, sent back, or neither. */
export const LeadReviewView = z.object({
  status: z.enum(['none', 'submitted', 'returned']),
  submittedAt: z.string().nullable(),
  submittedByName: z.string().nullable(),
  returnedAt: z.string().nullable(),
  returnedByName: z.string().nullable(),
  /** What the lead asked the assignee to change (the latest send-back). */
  returnNote: z.string().nullable(),
  /**
   * FB-16 (W13-19): who the latest send-back went to (the engineer, or the production scheduler); null
   * on rounds from before FB-16. A capacity block returns the work to the engineer the same way.
   */
  returnedToName: z.string().nullable().optional(),
  /**
   * FB-16 (W13-19): who the lead may send the work back to, the assignee first (the default). More than
   * one entry only in Engineering, when a production scheduler is assigned. Absent on pricing.
   */
  returnTargets: z
    .array(z.object({ target: z.enum(['assignee', 'scheduler']), name: z.string().nullable() }))
    .optional(),
  /** The caller is the assignee and may submit now. */
  canSubmit: z.boolean(),
  /** The caller is a lead and may send it back now. */
  canSendBack: z.boolean(),
  /** DR-pricing-finance-10: why a team member sees no Submit (not the assignee, or nobody assigned). */
  submitBlockedReason: z.string().nullable().optional(),
  /**
   * What the assignee's part still needs before it can be submitted to the lead (empty = ready). Present
   * on the quote detail only; absent (unknown) on the tab's own save responses, where the tab keeps the
   * Submit button back until the quote is re-read.
   */
  submitMissing: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
  /**
   * The fields the assignee's part needs before the quote can advance (workflow config), so the tab can
   * mark them "(required)". Present on the quote detail only.
   */
  requiredFields: z.array(z.string()).optional(),
  /**
   * FB-22 (N17-14): Engineering only. The two parts and where each stands: the engineer's (solution, BOM,
   * pricing inputs) and, when one is assigned, the production scheduler's (the capacity rows). A part is
   * `in` when submitted, or (D2) when its owner is an engineering lead and needs no submit.
   */
  parts: z
    .object({
      engineer: EngPartView,
      scheduler: EngPartView.nullable(),
    })
    .optional(),
  /** FB-22: the caller is the production scheduler assigned to the quote and may submit capacity now. */
  canSubmitCapacity: z.boolean().optional(),
  /**
   * FB-22: what the capacity part still needs before the scheduler can submit it (empty = ready). Present
   * on the quote detail only, for the scheduler who may submit.
   */
  capacitySubmitMissing: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
});
export type LeadReviewView = z.infer<typeof LeadReviewView>;

export const SendBackBody = z
  .object({ note: z.string().trim().min(1, 'Say what to change').max(2000) })
  .strict();
export type SendBackBody = z.infer<typeof SendBackBody>;

/**
 * FB-16 (W13-19): POST /quotes/:quoteNumber/eng-review/send-back. `to` chooses the engineer (`assignee`,
 * the default) or the production scheduler assigned to the quote; only the chosen person is notified.
 */
export const EngSendBackBody = z
  .object({
    note: z.string().trim().min(1, 'Say what to change').max(2000),
    to: z.enum(['assignee', 'scheduler']).optional(),
  })
  .strict();
export type EngSendBackBody = z.infer<typeof EngSendBackBody>;

/** Queue filter: `ready` lists only what waits on the lead's review. */
export const LeadReviewFilter = z.enum(['ready']);
