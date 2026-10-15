import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { first } from './_util';
import { quote } from '../schema/index';

export type Quote = typeof quote.$inferSelect;
export type NewQuote = Omit<typeof quote.$inferInsert, 'quoteNumber'> & { quoteNumber?: string };

/** Next `CCQ-YYYY-NNNNN` from the database counter. Call inside the transaction that inserts the quote. */
export async function nextQuoteNumber(db: DbOrTx, at?: Date): Promise<string> {
  const rows = await db.execute<{ n: string }>(
    at
      ? sql`select next_quote_number(${at.toISOString()}::timestamptz) as n`
      : sql`select next_quote_number() as n`,
  );
  return rows[0]!.n;
}

/** Inserts a quote, allocating its number unless one is given. */
export async function insertQuote(db: DbOrTx, values: NewQuote): Promise<Quote> {
  const quoteNumber = values.quoteNumber ?? (await nextQuoteNumber(db));
  const [row] = await db
    .insert(quote)
    .values({ ...values, quoteNumber })
    .returning();
  return row!;
}

export const getQuoteById = async (db: DbOrTx, id: string) =>
  first(await db.select().from(quote).where(eq(quote.id, id)));

export const getQuoteByNumber = async (db: DbOrTx, quoteNumber: string) =>
  first(await db.select().from(quote).where(eq(quote.quoteNumber, quoteNumber)));

export interface QuoteListFilter {
  stageKey?: string;
  status?: Quote['status'];
  kamUserId?: string;
  assignedEngineerId?: string;
  limit?: number;
  offset?: number;
}

/** Rows visible to the current request context (RLS applies), highest priority first. */
export function listQuotes(db: DbOrTx, filter: QuoteListFilter = {}) {
  const where: SQL[] = [];
  if (filter.stageKey) where.push(eq(quote.stageKey, filter.stageKey));
  if (filter.status) where.push(eq(quote.status, filter.status));
  if (filter.kamUserId) where.push(eq(quote.kamUserId, filter.kamUserId));
  if (filter.assignedEngineerId)
    where.push(eq(quote.assignedEngineerId, filter.assignedEngineerId));
  return db
    .select()
    .from(quote)
    .where(where.length ? and(...where) : undefined)
    .orderBy(sql`${quote.priorityScore} desc nulls last`, asc(quote.quoteNumber))
    .limit(filter.limit ?? 100)
    .offset(filter.offset ?? 0);
}

export async function updateQuote(
  db: DbOrTx,
  id: string,
  patch: Partial<Omit<typeof quote.$inferInsert, 'id' | 'quoteNumber'>>,
): Promise<Quote | undefined> {
  return first(await db.update(quote).set(patch).where(eq(quote.id, id)).returning());
}

export async function countQuotesByStage(db: DbOrTx) {
  return db
    .select({ stageKey: quote.stageKey, count: sql<number>`count(*)::int` })
    .from(quote)
    .groupBy(quote.stageKey)
    .orderBy(desc(sql`count(*)`));
}
