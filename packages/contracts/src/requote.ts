import { z } from 'zod';

import { QuoteItemSummary } from './quotes';

export * from './requote-links';

// ── FB-26 (N17-30): the linked re-quote of an expired quote ─────────────────────────────────────

/** Mirrors the domain's `REQUOTE_NOTE_MAX_LENGTH`. */
export const REQUOTE_NOTE_MAX = 1000;

/**
 * POST /quotes/:qn/requote. `note` says why (e.g. the customer said yes after the validity date).
 * `reasonCode` (context `expired`) is needed only when the quote is still open at Customer Decision: the
 * action then records G5 "No response / Expired" with this reason and note before creating the draft.
 */
export const RequoteBody = z.object({
  note: z.string().trim().min(1, 'Say why the quote is re-quoted').max(REQUOTE_NOTE_MAX),
  reasonCode: z.string().min(1).max(64).optional(),
});
export type RequoteBody = z.infer<typeof RequoteBody>;

export const RequoteResponse = z.object({
  /** The new intake draft: open it at `/intake/new?draft=<id>`. */
  draftId: z.string(),
  /** True when the action first recorded G5 "No response / Expired" on the old quote. */
  recordedExpired: z.boolean(),
});
export type RequoteResponse = z.infer<typeof RequoteResponse>;

/** One item of the expired quote as Engineering left it (read only). */
export const RequoteSourceItem = QuoteItemSummary.extend({
  processTypeLabel: z.string().nullable(),
  cycleTimeS: z.number().nullable(),
  toolingNotes: z.string().nullable(),
  capacitySignoffStatus: z.string().nullable(),
});
export type RequoteSourceItem = z.infer<typeof RequoteSourceItem>;

/** GET /quotes/:qn/requote-source: the "From the expired quote" panel. */
export const RequoteSourceResponse = z.object({
  quoteNumber: z.string(),
  /** False when the caller cannot read the old quote: only its number is shown. */
  readable: z.boolean(),
  items: z.array(RequoteSourceItem),
  /** The old quote's price approval: approved by whom and when, or null. */
  priceApproval: z
    .object({ approvedAt: z.string().nullable(), approvedByName: z.string().nullable() })
    .nullable(),
  capitalReadiness: z.string().nullable(),
  capitalReadinessLabel: z.string().nullable(),
});
export type RequoteSourceResponse = z.infer<typeof RequoteSourceResponse>;

export const REQUOTE_PROBLEM_CODES = {
  notAllowed: 'requote_not_allowed',
  alreadyRequoted: 'already_requoted',
  draftOpen: 'requote_draft_open',
  notRequote: 'not_a_requote',
} as const;
