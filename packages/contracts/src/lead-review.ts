import { z } from 'zod';

// Lead review (2026-10-30): the assigned engineer or pricer submits their part to the lead, who
// moves the quote on (G2 / G3) or sends it back with a note. No imports from quotes.ts here: the
// Engineering and Quoting tabs embed this.

/** The current round on a tab. `status`: waiting on the lead, sent back, or neither. */
export const LeadReviewView = z.object({
  status: z.enum(['none', 'submitted', 'returned']),
  submittedAt: z.string().nullable(),
  submittedByName: z.string().nullable(),
  returnedAt: z.string().nullable(),
  returnedByName: z.string().nullable(),
  /** What the lead asked the assignee to change (the latest send-back). */
  returnNote: z.string().nullable(),
  /** The caller is the assignee and may submit now. */
  canSubmit: z.boolean(),
  /** The caller is a lead and may send it back now. */
  canSendBack: z.boolean(),
});
export type LeadReviewView = z.infer<typeof LeadReviewView>;

export const SendBackBody = z
  .object({ note: z.string().trim().min(1, 'Say what to change').max(2000) })
  .strict();
export type SendBackBody = z.infer<typeof SendBackBody>;

/** Queue filter: `ready` lists only what waits on the lead's review. */
export const LeadReviewFilter = z.enum(['ready']);
