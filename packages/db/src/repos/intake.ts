import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { first } from './_util';
import { appUser, quote, quoteDraft } from '../schema/index';

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
      'data' | 'step' | 'sfOpportunityId' | 'submittedQuoteId' | 'submittedAt' | 'reworkOfQuoteId'
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
        // Rework drafts are listed with their returned quote (`listReturnedQuotes`).
        isNull(quoteDraft.reworkOfQuoteId),
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
 * Active (not closed) quotes on these SF opportunities that the caller can see (RLS applies). FB-19
 * (W13-33): an opportunity may have several (`app_setting.opportunity_active_quotes`), oldest first.
 */
export async function listActiveQuotesForOpportunities(db: DbOrTx, sfOpportunityIds: string[]) {
  if (sfOpportunityIds.length === 0) return [];
  return db
    .select(activeQuoteColumns)
    .from(quote)
    .where(and(inArray(quote.sfOpportunityId, sfOpportunityIds), ne(quote.status, 'closed')))
    .orderBy(asc(quote.createdAt), asc(quote.quoteNumber));
}

/** The oldest active quote on the opportunity the caller can see (RLS applies). */
export const getActiveQuoteForOpportunity = async (db: DbOrTx, sfOpportunityId: string) =>
  first(await listActiveQuotesForOpportunities(db, [sfOpportunityId]));

/**
 * FB-19 (W13-33): every active quote on the opportunity with its KAM's name: ONLY those two facts. Called
 * in system context (another KAM's quote counts too), so it must never return anything else.
 */
export async function listOpenQuotesOnOpportunity(db: DbOrTx, sfOpportunityId: string) {
  return db
    .select({ quoteNumber: quote.quoteNumber, kamName: appUser.displayName })
    .from(quote)
    .leftJoin(appUser, eq(appUser.id, quote.kamUserId))
    .where(and(eq(quote.sfOpportunityId, sfOpportunityId), ne(quote.status, 'closed')))
    .orderBy(asc(quote.createdAt), asc(quote.quoteNumber));
}

/** FB-19 (W13-33): the namespace of the per-opportunity submit lock (`pg_advisory_xact_lock(ns, key)`). */
export const OPPORTUNITY_SUBMIT_LOCK_NS = 1_901;

/**
 * FB-19 (W13-33): serialises submits on one opportunity until the caller's transaction ends, so the
 * "already has an active quote" check and the insert cannot race (replaces B-07's unique index).
 */
export async function lockOpportunityForSubmit(db: DbOrTx, sfOpportunityId: string) {
  await db.execute(
    sql`select pg_advisory_xact_lock(${OPPORTUNITY_SUBMIT_LOCK_NS}::int, hashtext(${sfOpportunityId}))`,
  );
}
