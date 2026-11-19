import { eq, sql } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { quote } from '../schema/index';

// Lead review (2026-10-30): the assignee's submission to their lead, per kind, on the quote row.
// Reads and writes only; who may submit or send back is the domain's (`@ccq/domain` lead-review).

export type LeadReviewKindRow = 'engineering' | 'pricing';

const columns = (kind: LeadReviewKindRow) =>
  kind === 'engineering'
    ? {
        submittedAt: quote.engSubmittedAt,
        submittedBy: quote.engSubmittedBy,
        returnedAt: quote.engReturnedAt,
        returnedBy: quote.engReturnedBy,
        returnNote: quote.engReturnNote,
        returnedTo: quote.engReturnedTo,
        // FB-22: the production scheduler's part.
        capacitySubmittedAt: quote.capacitySubmittedAt,
        capacitySubmittedBy: quote.capacitySubmittedBy,
      }
    : {
        submittedAt: quote.pricingSubmittedAt,
        submittedBy: quote.pricingSubmittedBy,
        returnedAt: quote.pricingReturnedAt,
        returnedBy: quote.pricingReturnedBy,
        returnNote: quote.pricingReturnNote,
        // FB-16: pricing has one assignee, so no "sent back to" column; always null.
        returnedTo: sql<string | null>`null`,
        capacitySubmittedAt: sql<Date | null>`null`,
        capacitySubmittedBy: sql<string | null>`null`,
      };

const keys = (kind: LeadReviewKindRow) =>
  kind === 'engineering'
    ? ({
        submittedAt: 'engSubmittedAt',
        submittedBy: 'engSubmittedBy',
        returnedAt: 'engReturnedAt',
        returnedBy: 'engReturnedBy',
        returnNote: 'engReturnNote',
        returnedTo: 'engReturnedTo',
        capacitySubmittedAt: 'capacitySubmittedAt',
        capacitySubmittedBy: 'capacitySubmittedBy',
      } as const)
    : ({
        submittedAt: 'pricingSubmittedAt',
        submittedBy: 'pricingSubmittedBy',
        returnedAt: 'pricingReturnedAt',
        returnedBy: 'pricingReturnedBy',
        returnNote: 'pricingReturnNote',
        returnedTo: null,
        capacitySubmittedAt: null,
        capacitySubmittedBy: null,
      } as const);

export interface LeadReviewRow {
  submittedAt: Date | null;
  submittedBy: string | null;
  returnedAt: Date | null;
  returnedBy: string | null;
  returnNote: string | null;
  /** FB-16 (W13-19): who the latest engineering send-back went to. Always null for pricing. */
  returnedTo: string | null;
  /** FB-22 (N17-14): the production scheduler's part. Always null for pricing. */
  capacitySubmittedAt: Date | null;
  capacitySubmittedBy: string | null;
}

/** The current round of one kind on a quote. */
export async function getLeadReview(
  db: DbOrTx,
  quoteId: string,
  kind: LeadReviewKindRow,
): Promise<LeadReviewRow> {
  const [row] = await db.select(columns(kind)).from(quote).where(eq(quote.id, quoteId)).limit(1);
  return (
    row ?? {
      submittedAt: null,
      submittedBy: null,
      returnedAt: null,
      returnedBy: null,
      returnNote: null,
      returnedTo: null,
      capacitySubmittedAt: null,
      capacitySubmittedBy: null,
    }
  );
}

/** Write part of the round (only the keys given). */
export async function setLeadReview(
  db: DbOrTx,
  quoteId: string,
  kind: LeadReviewKindRow,
  values: Partial<LeadReviewRow>,
): Promise<void> {
  const k = keys(kind);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const [name, value] of Object.entries(values)) {
    const column = k[name as keyof LeadReviewRow];
    // Pricing has no "sent back to" column (FB-16): that key is dropped.
    if (column) set[column] = value;
  }
  await db.update(quote).set(set).where(eq(quote.id, quoteId));
}

/** A new stay in the stage, or a new assignee: start a fresh round. */
export function clearLeadReview(db: DbOrTx, quoteId: string, kind: LeadReviewKindRow) {
  return setLeadReview(db, quoteId, kind, {
    submittedAt: null,
    submittedBy: null,
    returnedAt: null,
    returnedBy: null,
    returnNote: null,
    returnedTo: null,
    capacitySubmittedAt: null,
    capacitySubmittedBy: null,
  });
}
