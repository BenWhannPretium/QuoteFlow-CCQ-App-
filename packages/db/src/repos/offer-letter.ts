import { asc, desc, eq, inArray, max, sql } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { offerLetter, offerLetterItem } from '../schema/index';

/**
 * FB-20 (F-070): the offer letters generated for a quote. Insert-only (the app role holds no UPDATE or
 * DELETE on either table): a letter, and the prices it printed, stay as they were sent.
 */

export type OfferLetterRow = typeof offerLetter.$inferSelect;
export type OfferLetterItemRow = typeof offerLetterItem.$inferSelect;

/** The next letter number for the quote. Call it with the quote row locked. */
export async function nextOfferLetterNo(db: DbOrTx, quoteId: string): Promise<number> {
  const [row] = await db
    .select({ n: max(offerLetter.letterNo) })
    .from(offerLetter)
    .where(eq(offerLetter.quoteId, quoteId));
  return (row?.n ?? 0) + 1;
}

export async function insertOfferLetter(
  db: DbOrTx,
  letter: typeof offerLetter.$inferInsert,
  items: Omit<typeof offerLetterItem.$inferInsert, 'offerLetterId' | 'quoteId'>[],
): Promise<OfferLetterRow> {
  const [row] = await db.insert(offerLetter).values(letter).returning();
  if (items.length) {
    await db.insert(offerLetterItem).values(
      items.map((i) => ({
        ...i,
        offerLetterId: row!.id,
        quoteId: letter.quoteId,
        createdBy: letter.createdBy ?? null,
      })),
    );
  }
  return row!;
}

/** The quote's letters, newest first, with how many items each printed. */
export async function listOfferLetters(
  db: DbOrTx,
  quoteId: string,
): Promise<(OfferLetterRow & { itemCount: number })[]> {
  const rows = await db
    .select()
    .from(offerLetter)
    .where(eq(offerLetter.quoteId, quoteId))
    .orderBy(desc(offerLetter.letterNo));
  if (rows.length === 0) return [];
  const counts = await db
    .select({ id: offerLetterItem.offerLetterId, n: sql<number>`count(*)::int` })
    .from(offerLetterItem)
    .where(
      inArray(
        offerLetterItem.offerLetterId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(offerLetterItem.offerLetterId);
  const byId = new Map(counts.map((c) => [c.id, c.n]));
  return rows.map((r) => ({ ...r, itemCount: byId.get(r.id) ?? 0 }));
}

export const listOfferLetterItems = (db: DbOrTx, offerLetterId: string) =>
  db
    .select()
    .from(offerLetterItem)
    .where(eq(offerLetterItem.offerLetterId, offerLetterId))
    .orderBy(asc(offerLetterItem.itemNo));
