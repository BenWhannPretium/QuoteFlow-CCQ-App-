import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { first } from './_util';
import { quote, quoteDraft } from '../schema/index';

// Intake drafts (B-07). RLS limits every query here to the caller's own drafts (Admin: all).

export type QuoteDraftRow = typeof quoteDraft.$inferSelect;

export async function insertQuoteDraft(db: DbOrTx, values: typeof quoteDraft.$inferInsert) {
  const [row] = await db.insert(quoteDraft).values(values).returning();
  return row!;
}

export const getQuoteDraft = async (db: DbOrTx, id: string) =>
  first(await db.select().from(quoteDraft).where(eq(quoteDraft.id, id)));

/** Locks the draft row for the rest of the transaction (submit). */
export const getQuoteDraftForUpdate = async (db: DbOrTx, id: string) =>
  first(await db.select().from(quoteDraft).where(eq(quoteDraft.id, id)).for('update'));

export async function updateQuoteDraft(
  db: DbOrTx,
  id: string,
  patch: Partial<
    Pick<
      typeof quoteDraft.$inferInsert,
      'data' | 'step' | 'sfOpportunityId' | 'submittedQuoteId' | 'submittedAt'
    >
  >,
) {
  return first(await db.update(quoteDraft).set(patch).where(eq(quoteDraft.id, id)).returning());
}

/** Open (not yet submitted) drafts, newest first. `ownerUserId` omitted = every draft RLS shows. */
export const listOpenQuoteDrafts = (db: DbOrTx, ownerUserId?: string) =>
  db
    .select()
    .from(quoteDraft)
    .where(
      and(
        isNull(quoteDraft.submittedQuoteId),
        ownerUserId ? eq(quoteDraft.ownerUserId, ownerUserId) : undefined,
      ),
    )
    .orderBy(desc(quoteDraft.updatedAt))
    .limit(100);

/** Deletes an open draft. Submitted drafts are kept as the intake record. */
export async function deleteOpenQuoteDraft(db: DbOrTx, id: string): Promise<boolean> {
  const rows = await db
    .delete(quoteDraft)
    .where(and(eq(quoteDraft.id, id), isNull(quoteDraft.submittedQuoteId)))
    .returning({ id: quoteDraft.id });
  return rows.length > 0;
}

const activeQuoteColumns = {
  id: quote.id,
  quoteNumber: quote.quoteNumber,
  sfOpportunityId: quote.sfOpportunityId,
  stageKey: quote.stageKey,
  status: quote.status,
};

/**
 * Active (not closed) quotes on these SF opportunities that the caller can see (RLS applies). There is
 * at most one per opportunity (`quote_one_active_per_opportunity_uidx`).
 */
export async function listActiveQuotesForOpportunities(db: DbOrTx, sfOpportunityIds: string[]) {
  if (sfOpportunityIds.length === 0) return [];
  return db
    .select(activeQuoteColumns)
    .from(quote)
    .where(and(inArray(quote.sfOpportunityId, sfOpportunityIds), ne(quote.status, 'closed')));
}

export const getActiveQuoteForOpportunity = async (db: DbOrTx, sfOpportunityId: string) =>
  first(await listActiveQuotesForOpportunities(db, [sfOpportunityId]));
