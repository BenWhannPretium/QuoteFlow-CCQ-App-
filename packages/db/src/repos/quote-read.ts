import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import {
  appUser,
  customer,
  engReview,
  gateDecision,
  quote,
  quoteDraft,
  sfOpportunitySnapshot,
} from '../schema/index';

/**
 * Quote rows joined with what list and detail screens show next to them: opportunity name, customer
 * name and status, KAM name and the engineering process (for the min-volume screen). RLS applies.
 */
const summaryColumns = {
  quote,
  opportunityName: sfOpportunitySnapshot.name,
  customerName: customer.name,
  customerStatus: customer.status,
  kamName: appUser.displayName,
  processType: engReview.processType,
  /** B-13: the SF stage, shown side by side with the CCQ stage. */
  sfStage: sfOpportunitySnapshot.sfStage,
};

function summaryQuery(db: DbOrTx) {
  return db
    .select(summaryColumns)
    .from(quote)
    .leftJoin(
      sfOpportunitySnapshot,
      eq(sfOpportunitySnapshot.sfOpportunityId, quote.sfOpportunityId),
    )
    .leftJoin(customer, eq(customer.id, quote.customerId))
    .leftJoin(appUser, eq(appUser.id, quote.kamUserId))
    .leftJoin(engReview, eq(engReview.quoteId, quote.id));
}

/** A summary row. `sfStage` is optional so queue rows built by other repos still fit (B-13 reads it). */
export type QuoteSummaryRow = Omit<
  Awaited<ReturnType<typeof getQuoteSummaryByNumber>> & object,
  'sfStage'
> & { sfStage?: string | null };

export async function getQuoteSummaryByNumber(db: DbOrTx, quoteNumber: string) {
  const [row] = await summaryQuery(db).where(eq(quote.quoteNumber, quoteNumber)).limit(1);
  return row;
}

export interface GateQueueFilter {
  stageKey: string;
  /** Only quotes the KAM has submitted (a quote back for rework is not waiting for the gate). */
  submittedOnly?: boolean;
  limit?: number;
}

/** Open quotes in a gate's stage, highest priority first (on-hold ones included, flagged by status). */
export function listGateQueue(db: DbOrTx, filter: GateQueueFilter) {
  const where: SQL[] = [eq(quote.stageKey, filter.stageKey), ne(quote.status, 'closed')];
  if (filter.submittedOnly) where.push(isNotNull(quote.submittedAt));
  return summaryQuery(db)
    .where(and(...where))
    .orderBy(
      sql`${quote.priorityScore} desc nulls last`,
      asc(quote.submittedAt),
      asc(quote.quoteNumber),
    )
    .limit(filter.limit ?? 200);
}

/** B-13 "My open proposals": a KAM's open quotes waiting for the customer (on hold included). */
export function listOpenProposals(db: DbOrTx, kamUserId: string, stageKey: string) {
  return summaryQuery(db)
    .where(
      and(eq(quote.kamUserId, kamUserId), eq(quote.stageKey, stageKey), ne(quote.status, 'closed')),
    )
    .orderBy(sql`${quote.validityUntil} asc nulls last`, asc(quote.quoteNumber))
    .limit(500);
}

/** A KAM's quotes that are back with them for rework (INTAKE, not resubmitted). */
export function listReturnedQuotes(db: DbOrTx, kamUserId: string) {
  return summaryQuery(db)
    .where(
      and(
        eq(quote.kamUserId, kamUserId),
        eq(quote.stageKey, 'INTAKE'),
        isNull(quote.submittedAt),
        ne(quote.status, 'closed'),
      ),
    )
    .orderBy(desc(quote.updatedAt))
    .limit(100);
}

/** Gate decisions on a quote, newest first, with the decider's name. */
export function listGateDecisionsWithNames(db: DbOrTx, quoteId: string) {
  return db
    .select({ decision: gateDecision, decidedByName: appUser.displayName })
    .from(gateDecision)
    .leftJoin(appUser, eq(appUser.id, gateDecision.decidedBy))
    .where(eq(gateDecision.quoteId, quoteId))
    .orderBy(desc(gateDecision.decidedAt), desc(gateDecision.id));
}

/** The open rework draft for a quote, if the KAM has started one (RLS: only they and Admin see it). */
export async function getOpenReworkDraft(db: DbOrTx, quoteId: string) {
  const [row] = await db
    .select()
    .from(quoteDraft)
    .where(and(eq(quoteDraft.reworkOfQuoteId, quoteId), isNull(quoteDraft.submittedQuoteId)))
    .limit(1);
  return row;
}

/** The draft most recently submitted into this quote (the original intake or a rework). */
export async function getLatestSubmittedDraft(db: DbOrTx, quoteId: string) {
  const [row] = await db
    .select()
    .from(quoteDraft)
    .where(eq(quoteDraft.submittedQuoteId, quoteId))
    .orderBy(desc(quoteDraft.submittedAt))
    .limit(1);
  return row;
}
