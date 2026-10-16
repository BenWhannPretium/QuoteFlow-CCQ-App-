import { z } from 'zod';

import { SfStageComparison, ValidityStatus } from './outcome';
import { QuoteSummary } from './quotes';

// ── My open proposals ────────────────────────────────────────────────────────────────────────────

export const OpenProposal = QuoteSummary.extend({
  proposalIssuedAt: z.string().nullable(),
  validity: ValidityStatus,
  validityExpiredFlaggedAt: z.string().nullable(),
  sf: SfStageComparison,
});
export type OpenProposal = z.infer<typeof OpenProposal>;

/** GET /quotes/mine/proposals: the caller's quotes waiting for the customer, soonest validity end first. */
export const MyProposalsResponse = z.object({
  items: z.array(OpenProposal),
  counts: z.object({
    total: z.number().int(),
    expiring: z.number().int(),
    expired: z.number().int(),
    onHold: z.number().int(),
    sfMismatch: z.number().int(),
  }),
});
export type MyProposalsResponse = z.infer<typeof MyProposalsResponse>;
