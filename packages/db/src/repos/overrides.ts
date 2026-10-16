import { and, desc, eq, inArray, lt, ne, or } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { DbOrTx } from '../client';
import { first } from './_util';
import { appUser, customer, override, quote } from '../schema/index';

// Governed overrides (B-09). Persistence only: the domain (`planOverride*`) decides.

export type OverrideRow = typeof override.$inferSelect;

/** The override row, locked for the rest of the transaction (approve / reject / revert serialise on it). */
export const getOverrideForUpdate = async (db: DbOrTx, id: string) =>
  first(await db.select().from(override).where(eq(override.id, id)).for('update'));

/** The quote row, locked: the field check and the write happen under the same lock (409 on a stale value). */
export const getQuoteForUpdate = async (db: DbOrTx, id: string) =>
  first(await db.select().from(quote).where(eq(quote.id, id)).for('update'));

export async function hasOpenOverride(db: DbOrTx, quoteId: string, field: string) {
  const rows = await db
    .select({ id: override.id })
    .from(override)
    .where(
      and(
        eq(override.quoteId, quoteId),
        eq(override.field, field),
        eq(override.status, 'requested'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** The newest other applied override on the field (what still holds after a revert), if any. */
export const latestOtherAppliedOverride = async (
  db: DbOrTx,
  quoteId: string,
  field: string,
  excludeId: string,
) =>
  first(
    await db
      .select()
      .from(override)
      .where(
        and(
          eq(override.quoteId, quoteId),
          eq(override.field, field),
          eq(override.status, 'applied'),
          ne(override.id, excludeId),
        ),
      )
      .orderBy(desc(override.appliedAt), desc(override.id))
      .limit(1),
  );

export interface OverrideListFilter {
  quoteId?: string;
  statuses?: readonly OverrideRow['status'][];
  field?: string;
  /** Keyset: rows created before this (created_at, id). */
  before?: { at: Date; id: string };
  limit?: number;
}

const requester = alias(appUser, 'requester');
const decider = alias(appUser, 'decider');
const reverter = alias(appUser, 'reverter');

const contextColumns = {
  override,
  quoteNumber: quote.quoteNumber,
  quoteStatus: quote.status,
  stageKey: quote.stageKey,
  kamUserId: quote.kamUserId,
  assignedEngineerId: quote.assignedEngineerId,
  region: quote.region,
  accountId: customer.sfAccountId,
  customerName: customer.name,
  requestedByName: requester.displayName,
  decidedByName: decider.displayName,
  revertedByName: reverter.displayName,
};

const contextQuery = (db: DbOrTx) =>
  db
    .select(contextColumns)
    .from(override)
    .innerJoin(quote, eq(quote.id, override.quoteId))
    .leftJoin(customer, eq(customer.id, quote.customerId))
    .leftJoin(requester, eq(requester.id, override.requestedBy))
    .leftJoin(decider, eq(decider.id, override.decidedBy))
    .leftJoin(reverter, eq(reverter.id, override.revertedBy));

/**
 * Overrides with the quote they belong to and the people involved, newest first. RLS applies: a caller
 * sees overrides on the quotes they can see. The override LOG route additionally needs overrideLog.read.
 */
export function listOverridesWithContext(db: DbOrTx, filter: OverrideListFilter = {}) {
  const where: SQL[] = [];
  if (filter.quoteId) where.push(eq(override.quoteId, filter.quoteId));
  if (filter.statuses?.length) where.push(inArray(override.status, [...filter.statuses]));
  if (filter.field) where.push(eq(override.field, filter.field));
  if (filter.before) {
    const { at, id } = filter.before;
    where.push(
      or(lt(override.createdAt, at), and(eq(override.createdAt, at), lt(override.id, id)))!,
    );
  }
  return contextQuery(db)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(override.createdAt), desc(override.id))
    .limit(filter.limit ?? 100);
}

export type OverrideWithContext = Awaited<ReturnType<typeof listOverridesWithContext>>[number];

export const getOverrideWithContext = async (db: DbOrTx, id: string) =>
  first(await contextQuery(db).where(eq(override.id, id)));
