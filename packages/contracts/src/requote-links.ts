import { z } from 'zod';

// FB-26 (N17-30): kept apart from requote.ts so quotes.ts can import it without a cycle.

/** A quote at the other end of a link: its number always; `readable` false when RLS hides the rest. */
export const RequoteLinkedQuote = z.object({
  quoteNumber: z.string(),
  readable: z.boolean(),
  /** Old quote: when it expired (the validity date, `YYYY-MM-DD`). New quote: when it was created (ISO). */
  at: z.string().nullable(),
});
export type RequoteLinkedQuote = z.infer<typeof RequoteLinkedQuote>;

/** `QuoteDetail.requote`: both ends of the link and whether the caller may start one now. */
export const QuoteRequoteLinks = z.object({
  /** On a linked re-quote: the expired quote it re-quotes. */
  requoteOf: RequoteLinkedQuote.nullable(),
  /** On an expired quote: the linked re-quote created from it. */
  requotedAs: RequoteLinkedQuote.nullable(),
  /** A re-quote draft started but not submitted yet (who and when; the id only for its owner). */
  draft: z
    .object({
      startedAt: z.string(),
      ownerName: z.string().nullable(),
      draftId: z.string().nullable(),
    })
    .nullable(),
  /** The caller may start a linked re-quote now (permission, state and setting). */
  canStart: z.boolean(),
  /** `open_lapsed`: starting it first records G5 "No response / Expired" (ask for the reason). */
  startFrom: z.enum(['closed_expired', 'open_lapsed']).nullable(),
});
export type QuoteRequoteLinks = z.infer<typeof QuoteRequoteLinks>;
