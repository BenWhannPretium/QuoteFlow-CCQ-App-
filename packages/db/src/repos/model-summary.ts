import { asc, inArray } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { modelSummary, modelSummaryField } from '../schema/index';

/**
 * FB-14 (D-013): the summary read from a Quoting model version at upload. Insert-only (the app role
 * holds no UPDATE or DELETE on either table): what the workbook said when it was uploaded stays.
 */

export type ModelSummaryRow = typeof modelSummary.$inferSelect;
export type ModelSummaryFieldRow = typeof modelSummaryField.$inferSelect;

export async function insertModelSummary(
  db: DbOrTx,
  summary: Omit<typeof modelSummary.$inferInsert, 'fieldCount'>,
  fields: Omit<typeof modelSummaryField.$inferInsert, 'summaryId' | 'quoteId' | 'sort'>[],
): Promise<ModelSummaryRow> {
  const [row] = await db
    .insert(modelSummary)
    .values({ ...summary, fieldCount: fields.length })
    .returning();
  if (fields.length) {
    await db.insert(modelSummaryField).values(
      fields.map((f, i) => ({
        ...f,
        summaryId: row!.id,
        quoteId: summary.quoteId,
        sort: (i + 1) * 10,
        createdBy: summary.createdBy ?? null,
      })),
    );
  }
  return row!;
}

/** The summaries of these attachment versions, with their fields in map order. */
export async function listModelSummaries(
  db: DbOrTx,
  attachmentIds: readonly string[],
): Promise<(ModelSummaryRow & { fields: ModelSummaryFieldRow[] })[]> {
  if (attachmentIds.length === 0) return [];
  const rows = await db
    .select()
    .from(modelSummary)
    .where(inArray(modelSummary.attachmentId, [...attachmentIds]));
  if (rows.length === 0) return [];
  const fields = await db
    .select()
    .from(modelSummaryField)
    .where(
      inArray(
        modelSummaryField.summaryId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(modelSummaryField.summaryId), asc(modelSummaryField.sort));
  return rows.map((r) => ({ ...r, fields: fields.filter((f) => f.summaryId === r.id) }));
}

export const getModelSummaryByAttachment = async (db: DbOrTx, attachmentId: string) =>
  (await listModelSummaries(db, [attachmentId]))[0] ?? null;
