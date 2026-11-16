import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import type { DbOrTx } from '../client';
import { first } from './_util';
import { uuidv7 } from '../ids';
import {
  attachment,
  capacityEvidence,
  engReview,
  quoteItem,
  quoteItemDrawing,
} from '../schema/index';

// FB-19 (W13-32 to W13-34): quote items. Reads and writes only; the service decides.

export type QuoteItem = typeof quoteItem.$inferSelect;
export type NewQuoteItem = typeof quoteItem.$inferInsert;

/**
 * The id of the quote's primary item (item_no 1), as SQL for a join: `eng_review.quote_item_id =
 * primaryItemId(quote.id)` joins the review row that carries the quote-level engineering fields.
 */
export const primaryItemId = (quoteIdColumn: AnyPgColumn) =>
  sql<string>`(select qi.id from ${quoteItem} qi where qi.quote_id = ${quoteIdColumn} and qi.item_no = 1)`;

/** The join condition for the primary item's review row of `quote` (one row per quote). */
export const primaryEngReviewOn = (quoteIdColumn: AnyPgColumn) =>
  and(
    eq(engReview.quoteId, quoteIdColumn),
    sql`${engReview.quoteItemId} = ${primaryItemId(quoteIdColumn)}`,
  );

/** A quote's items in item order (RLS: visible with the quote). */
export const listQuoteItems = (db: DbOrTx, quoteId: string) =>
  db.select().from(quoteItem).where(eq(quoteItem.quoteId, quoteId)).orderBy(asc(quoteItem.itemNo));

/** Items of many quotes, in quote then item order. */
export function listQuoteItemsForQuotes(db: DbOrTx, quoteIds: readonly string[]) {
  if (quoteIds.length === 0) return Promise.resolve([] as QuoteItem[]);
  return db
    .select()
    .from(quoteItem)
    .where(inArray(quoteItem.quoteId, [...quoteIds]))
    .orderBy(asc(quoteItem.quoteId), asc(quoteItem.itemNo));
}

export const getQuoteItem = async (db: DbOrTx, id: string) =>
  first(await db.select().from(quoteItem).where(eq(quoteItem.id, id)));

/** Item counts and item 1's label for many quotes (the lists' "16 oz bottle + 2 more"). */
export async function itemSummariesForQuotes(
  db: DbOrTx,
  quoteIds: readonly string[],
): Promise<Map<string, { count: number; firstLabel: string | null }>> {
  const out = new Map<string, { count: number; firstLabel: string | null }>();
  if (quoteIds.length === 0) return out;
  const rows = await db
    .select({
      quoteId: quoteItem.quoteId,
      count: sql<number>`count(*)::int`,
      firstLabel: sql<
        string | null
      >`(array_agg(${quoteItem.label} order by ${quoteItem.itemNo}))[1]`,
    })
    .from(quoteItem)
    .where(inArray(quoteItem.quoteId, [...quoteIds]))
    .groupBy(quoteItem.quoteId);
  for (const r of rows) out.set(r.quoteId, { count: r.count, firstLabel: r.firstLabel });
  return out;
}

export async function insertQuoteItem(db: DbOrTx, values: NewQuoteItem) {
  const [row] = await db.insert(quoteItem).values(values).returning();
  return row!;
}

export async function updateQuoteItem(
  db: DbOrTx,
  id: string,
  patch: Partial<Omit<NewQuoteItem, 'id' | 'quoteId'>>,
) {
  return first(
    await db
      .update(quoteItem)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(quoteItem.id, id))
      .returning(),
  );
}

/**
 * Gives the quote's items the numbers 1…n in `orderedIds` order. Two passes, so the unique
 * (quote_id, item_no) index never sees two items on one number mid-way.
 */
export async function renumberQuoteItems(db: DbOrTx, quoteId: string, orderedIds: string[]) {
  if (orderedIds.length === 0) return;
  await db
    .update(quoteItem)
    .set({ itemNo: sql`${quoteItem.itemNo} + 1000` })
    .where(eq(quoteItem.quoteId, quoteId));
  for (const [i, id] of orderedIds.entries()) {
    await db
      .update(quoteItem)
      .set({ itemNo: i + 1 })
      .where(and(eq(quoteItem.quoteId, quoteId), eq(quoteItem.id, id)));
  }
}

/**
 * Removes an item and the engineering work done on it (its review row and capacity rows). Returns what
 * was removed, so the caller can audit it (the audit keeps the work). Drawings that carry the item stay
 * on the quote (they are files; they simply no longer count for any item).
 */
export async function deleteQuoteItem(db: DbOrTx, quoteId: string, id: string) {
  const links = await db
    .delete(quoteItemDrawing)
    .where(and(eq(quoteItemDrawing.quoteId, quoteId), eq(quoteItemDrawing.quoteItemId, id)))
    .returning();
  const capacity = await db
    .delete(capacityEvidence)
    .where(and(eq(capacityEvidence.quoteId, quoteId), eq(capacityEvidence.quoteItemId, id)))
    .returning();
  const review = await db
    .delete(engReview)
    .where(and(eq(engReview.quoteId, quoteId), eq(engReview.quoteItemId, id)))
    .returning();
  const [item] = await db
    .delete(quoteItem)
    .where(and(eq(quoteItem.quoteId, quoteId), eq(quoteItem.id, id)))
    .returning();
  return { item, review: review[0] ?? null, capacity, links };
}

/** FB-19: the quote's drawing links (an item using a drawing another item holds). */
export const listItemDrawingLinks = (db: DbOrTx, quoteId: string) =>
  db.select().from(quoteItemDrawing).where(eq(quoteItemDrawing.quoteId, quoteId));

/**
 * FB-19: makes the item's links exactly `attachmentIds` (adds the missing ones, removes the others).
 * Returns what changed, for the audit.
 */
export async function setItemDrawingLinks(
  db: DbOrTx,
  quoteId: string,
  quoteItemId: string,
  attachmentIds: readonly string[],
  createdBy: string,
): Promise<{ added: string[]; removed: string[] }> {
  const current = await db
    .select()
    .from(quoteItemDrawing)
    .where(
      and(eq(quoteItemDrawing.quoteId, quoteId), eq(quoteItemDrawing.quoteItemId, quoteItemId)),
    );
  const want = new Set(attachmentIds);
  const have = new Set(current.map((l) => l.attachmentId));
  const added = [...want].filter((id) => !have.has(id));
  const removed = current.filter((l) => !want.has(l.attachmentId));
  if (removed.length > 0) {
    await db.delete(quoteItemDrawing).where(
      inArray(
        quoteItemDrawing.id,
        removed.map((l) => l.id),
      ),
    );
  }
  if (added.length > 0) {
    await db
      .insert(quoteItemDrawing)
      .values(added.map((attachmentId) => ({ quoteId, quoteItemId, attachmentId, createdBy })));
  }
  return { added, removed: removed.map((l) => l.attachmentId) };
}

/** Re-keys a draft's or a quote's drawings from the draft item's key to the new quote item id. */
export async function rekeyItemAttachments(
  db: DbOrTx,
  where: { draftId?: string; quoteId?: string },
  fromKey: string,
  toId: string,
) {
  if (fromKey === toId) return;
  const owner = where.draftId
    ? eq(attachment.draftId, where.draftId)
    : where.quoteId
      ? eq(attachment.quoteId, where.quoteId)
      : undefined;
  if (!owner) return;
  await db
    .update(attachment)
    .set({ quoteItemId: toId, updatedAt: new Date() })
    .where(and(owner, eq(attachment.quoteItemId, fromKey)));
}

/** The product columns item 1 takes from its quote when a quote has no item yet (as migration 0047). */
const ITEM_FROM_QUOTE_COLUMNS = [
  'product_family',
  'product_family_other',
  'components',
  'component_other',
  'liner_spec',
  'labels_purchased_by',
  'decoration_type',
  'decoration_type_other',
  'decoration_print_colors',
  'resin',
  'resin_customer_specified',
  'resin_grade',
  'pcr_level',
  'pcr_level_other',
  'color_type',
  'color_description',
  'additive',
  'additives',
  'neck_diameter',
  'neck_diameter_custom',
  'neck_finish_type',
  'neck_finish_type_custom',
  'neck_special_feature',
  'neck_special_feature_custom',
  'height_mm',
  'width_or_diameter_mm',
  'depth_mm',
  'gram_weight_g',
  'modify_existing_mold',
  'existing_mold_ref',
  'mold_change_description',
  'packaging_type',
  'packaging_notes',
  'drawing_status',
  'est_annual_volume',
  'est_annual_volume_confirmed',
  'product_needed_by',
] as const;

/**
 * FB-19: the quote's primary item id, creating item 1 from the quote's own columns when the quote has
 * no item yet (a quote written before FB-19 by a path that does not create items: the synthetic seed,
 * a test fixture). Every quote the intake creates has its items already.
 */
export async function ensurePrimaryItem(db: DbOrTx, quoteId: string): Promise<string> {
  const existing = first(
    await db
      .select({ id: quoteItem.id })
      .from(quoteItem)
      .where(and(eq(quoteItem.quoteId, quoteId), eq(quoteItem.itemNo, 1))),
  );
  if (existing) return existing.id;
  const id = uuidv7();
  const cols = sql.raw(ITEM_FROM_QUOTE_COLUMNS.map((c) => `"${c}"`).join(', '));
  const from = sql.raw(ITEM_FROM_QUOTE_COLUMNS.map((c) => `q."${c}"`).join(', '));
  await db.execute(sql`
    insert into ${quoteItem} ("id", "quote_id", "item_no", ${cols}, "container_size", "standard_description", "created_by")
    select ${id}, q."id", 1, ${from},
      nullif(btrim(q."structured_description"->>'size'), ''),
      nullif(btrim(q."structured_description"->>'standard'), ''),
      q."created_by"
    from "quote" q
    where q."id" = ${quoteId}
      and not exists (select 1 from ${quoteItem} qi where qi."quote_id" = q."id")`);
  const row = first(
    await db
      .select({ id: quoteItem.id })
      .from(quoteItem)
      .where(and(eq(quoteItem.quoteId, quoteId), eq(quoteItem.itemNo, 1))),
  );
  if (!row) throw new Error(`quote ${quoteId} has no item 1 and none could be made`);
  return row.id;
}
