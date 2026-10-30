import { eq } from 'drizzle-orm';

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
      }
    : {
        submittedAt: quote.pricingSubmittedAt,
        submittedBy: quote.pricingSubmittedBy,
        returnedAt: quote.pricingReturnedAt,
        returnedBy: quote.pricingReturnedBy,
        returnNote: quote.pricingReturnNote,
      };

const keys = (kind: LeadReviewKindRow) =>
  kind === 'engineering'
    ? ({
        submittedAt: 'engSubmittedAt',
        submittedBy: 'engSubmittedBy',
        returnedAt: 'engReturnedAt',
        returnedBy: 'engReturnedBy',
        returnNote: 'engReturnNote',
      } as const)
    : ({
        submittedAt: 'pricingSubmittedAt',
        submittedBy: 'pricingSubmittedBy',
        returnedAt: 'pricingReturnedAt',
        returnedBy: 'pricingReturnedBy',
        returnNote: 'pricingReturnNote',
      } as const);

export interface LeadReviewRow {
  submittedAt: Date | null;
  submittedBy: string | null;
  returnedAt: Date | null;
  returnedBy: string | null;
  returnNote: string | null;
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
  for (const [name, value] of Object.entries(values)) set[k[name as keyof LeadReviewRow]] = value;
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
  });
}
