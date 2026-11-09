import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { excludedSet, first } from './_util';
import {
  attachment,
  capacityEvidence,
  comment,
  engReview,
  gateDecision,
  handoffRecord,
  override,
  pricingRecord,
  quote,
  quoteHold,
  stageHistory,
} from '../schema/index';

// Thin persistence for the quote's child records. Rules (who may write what, when) live in the domain.

export const listStageHistory = (db: DbOrTx, quoteId: string) =>
  db
    .select()
    .from(stageHistory)
    .where(eq(stageHistory.quoteId, quoteId))
    // UUID v7 ids break ties between stays entered in the same instant (submit + advance).
    .orderBy(asc(stageHistory.enteredAt), asc(stageHistory.id));

export const listHolds = (db: DbOrTx, quoteId: string) =>
  db
    .select()
    .from(quoteHold)
    .where(eq(quoteHold.quoteId, quoteId))
    .orderBy(asc(quoteHold.startedAt));

export const listGateDecisions = (db: DbOrTx, quoteId: string) =>
  db
    .select()
    .from(gateDecision)
    .where(eq(gateDecision.quoteId, quoteId))
    .orderBy(asc(gateDecision.decidedAt));

export const getEngReview = async (db: DbOrTx, quoteId: string) =>
  first(await db.select().from(engReview).where(eq(engReview.quoteId, quoteId)));

const ENG_REVIEW_FIELDS = [
  'acceptedAt',
  'acceptedBy',
  'returnedReason',
  'processType',
  'machineType',
  'plantCode',
  'cavitation',
  'cycleTimeS',
  'toolingNotes',
  'prelimCapitalUsd',
  'downstreamEquipmentNotes',
  'technicalConceptNotes',
  // B-26
  'equipmentBomNotes',
  'supplyChainNotes',
  'capacitySignoffStatus',
  'capacitySignoffBy',
  'capacitySignoffAt',
  'capacitySignoffNote',
] as const;

export async function upsertEngReview(db: DbOrTx, values: typeof engReview.$inferInsert) {
  const [row] = await db
    .insert(engReview)
    .values(values)
    .onConflictDoUpdate({
      target: engReview.quoteId,
      set: { ...excludedSet(engReview, ENG_REVIEW_FIELDS), updatedAt: new Date() },
    })
    .returning();
  return row!;
}

export const listCapacityEvidence = (db: DbOrTx, quoteId: string) =>
  db
    .select()
    .from(capacityEvidence)
    .where(eq(capacityEvidence.quoteId, quoteId))
    .orderBy(asc(capacityEvidence.analysisDate));

export async function insertCapacityEvidence(
  db: DbOrTx,
  values: typeof capacityEvidence.$inferInsert,
) {
  const [row] = await db.insert(capacityEvidence).values(values).returning();
  return row!;
}

/** The pricing record of the quote's current version (B-11: one row per version). */
export async function getPricingRecord(db: DbOrTx, quoteId: string) {
  return first(
    await db
      .select({ record: pricingRecord })
      .from(pricingRecord)
      .innerJoin(quote, eq(quote.id, pricingRecord.quoteId))
      .where(
        and(eq(pricingRecord.quoteId, quoteId), eq(pricingRecord.quoteVersion, quote.version)),
      ),
  )?.record;
}

/** Every version's pricing record, newest version first (the current one included). */
export const listPricingRecords = (db: DbOrTx, quoteId: string) =>
  db
    .select()
    .from(pricingRecord)
    .where(eq(pricingRecord.quoteId, quoteId))
    .orderBy(desc(pricingRecord.quoteVersion));

const PRICING_FIELDS = [
  'priceApprovedBy',
  'priceApprovedAt',
  'pricingBasisNote',
  'pricingRefs',
  // B-26: `noPricingAppRecordNote` is no longer written (kept for history).
  'approvedRangeNote',
  'costingCompleted',
  'costingAttestedBy',
  'costingAttestedAt',
  'capitalReadiness',
  'cerReference',
  'capitalNotes',
  'capitalPendingJustification',
] as const;

/** Insert or update the record of one quote version. Other versions are never touched. */
export async function upsertPricingRecord(db: DbOrTx, values: typeof pricingRecord.$inferInsert) {
  const [row] = await db
    .insert(pricingRecord)
    .values(values)
    .onConflictDoUpdate({
      target: [pricingRecord.quoteId, pricingRecord.quoteVersion],
      set: { ...excludedSet(pricingRecord, PRICING_FIELDS), updatedAt: new Date() },
    })
    .returning();
  return row!;
}

export const listOverrides = (db: DbOrTx, quoteId: string) =>
  db.select().from(override).where(eq(override.quoteId, quoteId)).orderBy(desc(override.createdAt));

export async function insertOverride(db: DbOrTx, values: typeof override.$inferInsert) {
  const [row] = await db.insert(override).values(values).returning();
  return row!;
}

export async function updateOverride(
  db: DbOrTx,
  id: string,
  patch: Partial<
    Pick<
      typeof override.$inferInsert,
      | 'status'
      | 'decidedBy'
      | 'decidedAt'
      | 'decisionNote'
      | 'revertedBy'
      | 'revertedAt'
      | 'appliedAt'
    >
  >,
) {
  return first(await db.update(override).set(patch).where(eq(override.id, id)).returning());
}

/** A quote's current files, oldest first (removed ones excluded). */
export const listAttachments = (db: DbOrTx, quoteId: string) =>
  db
    .select()
    .from(attachment)
    .where(and(eq(attachment.quoteId, quoteId), isNull(attachment.removedAt)))
    .orderBy(asc(attachment.createdAt), asc(attachment.id));

/** An intake draft's current files (before submit the quote id is null). */
export const listDraftAttachments = (db: DbOrTx, draftId: string) =>
  db
    .select()
    .from(attachment)
    .where(
      and(
        eq(attachment.draftId, draftId),
        isNull(attachment.quoteId),
        isNull(attachment.removedAt),
      ),
    )
    .orderBy(asc(attachment.createdAt), asc(attachment.id));

export async function getAttachment(db: DbOrTx, id: string, forUpdate = false) {
  const q = db.select().from(attachment).where(eq(attachment.id, id));
  return first(await (forUpdate ? q.for('update') : q));
}

export async function insertAttachment(db: DbOrTx, values: typeof attachment.$inferInsert) {
  const [row] = await db.insert(attachment).values(values).returning();
  return row!;
}

/** FB-07 (F-074): every version of one kind on a quote, removed ones included, newest first. */
export const listAttachmentVersions = (
  db: DbOrTx,
  quoteId: string,
  kind: string,
  forUpdate = false,
) => {
  const q = db
    .select()
    .from(attachment)
    .where(and(eq(attachment.quoteId, quoteId), eq(attachment.kind, kind)))
    .orderBy(desc(attachment.version), desc(attachment.createdAt));
  return forUpdate ? q.for('update') : q;
};

const isCurrentVersion = (r: typeof attachment.$inferSelect) =>
  r.version !== null && r.supersededAt === null && r.removedAt === null;

/**
 * FB-07 (F-074, T-034): a new version of a versioned kind. In the caller's transaction: the current
 * version (if any) is superseded, the new row is inserted with the next number, and the old one then
 * names it. One current version per quote and kind (unique index); earlier versions stay.
 */
export async function insertAttachmentVersion(
  db: DbOrTx,
  values: Omit<typeof attachment.$inferInsert, 'version' | 'supersededBy' | 'supersededAt'> & {
    quoteId: string;
  },
  at: Date,
) {
  const versions = await listAttachmentVersions(db, values.quoteId, values.kind, true);
  const current = versions.find(isCurrentVersion) ?? null;
  const version = versions.reduce((m, v) => Math.max(m, v.version ?? 0), 0) + 1;
  if (current) {
    await db
      .update(attachment)
      .set({ supersededAt: at, updatedAt: at })
      .where(eq(attachment.id, current.id));
  }
  const [row] = await db
    .insert(attachment)
    .values({ ...values, version })
    .returning();
  if (current) {
    await db.update(attachment).set({ supersededBy: row!.id }).where(eq(attachment.id, current.id));
  }
  return { row: row!, superseded: current };
}

/**
 * FB-07: the current version was removed (soft); the newest remaining version is current again. Returns
 * the restored row, or null.
 */
export async function restorePreviousVersion(db: DbOrTx, quoteId: string, kind: string, at: Date) {
  const versions = await listAttachmentVersions(db, quoteId, kind, true);
  if (versions.some(isCurrentVersion)) return null;
  const previous = versions.find((v) => v.version !== null && v.removedAt === null);
  if (!previous) return null;
  return first(
    await db
      .update(attachment)
      .set({ supersededAt: null, supersededBy: null, updatedAt: at })
      .where(eq(attachment.id, previous.id))
      .returning(),
  );
}

/** FB-07: the current version of each versioned kind on these quotes (removed and superseded excluded). */
export const listCurrentModelVersions = (db: DbOrTx, quoteIds: readonly string[]) =>
  db
    .select()
    .from(attachment)
    .where(
      and(
        inArray(attachment.quoteId, [...quoteIds]),
        isNotNull(attachment.version),
        isNull(attachment.supersededAt),
        isNull(attachment.removedAt),
      ),
    );

export async function updateAttachment(
  db: DbOrTx,
  id: string,
  patch: Partial<
    Pick<
      typeof attachment.$inferInsert,
      | 'quoteId'
      | 'storageItemId'
      | 'storagePath'
      | 'storedName'
      | 'spItemId'
      | 'spWebUrl'
      | 'removedAt'
      | 'removedBy'
      | 'updatedAt'
    >
  >,
) {
  return first(await db.update(attachment).set(patch).where(eq(attachment.id, id)).returning());
}

/** Submit: the draft's files now belong to the quote (their bytes move after the commit). */
export const claimDraftAttachments = (db: DbOrTx, draftId: string, quoteId: string, at: Date) =>
  db
    .update(attachment)
    .set({ quoteId, updatedAt: at })
    .where(
      and(
        eq(attachment.draftId, draftId),
        isNull(attachment.quoteId),
        isNull(attachment.removedAt),
      ),
    )
    .returning();

export const listComments = (db: DbOrTx, quoteId: string) =>
  db.select().from(comment).where(eq(comment.quoteId, quoteId)).orderBy(asc(comment.createdAt));

/** Everyone who has commented on the quote (the author ids, once each). */
export async function listCommentAuthorIds(db: DbOrTx, quoteId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ authorId: comment.authorId })
    .from(comment)
    .where(eq(comment.quoteId, quoteId));
  return rows.map((r) => r.authorId);
}

export async function insertComment(db: DbOrTx, values: typeof comment.$inferInsert) {
  const [row] = await db.insert(comment).values(values).returning();
  return row!;
}

export const getHandoffRecord = async (db: DbOrTx, quoteId: string) =>
  first(await db.select().from(handoffRecord).where(eq(handoffRecord.quoteId, quoteId)));

export type HandoffRecordRow = typeof handoffRecord.$inferSelect;

export async function insertHandoffRecord(db: DbOrTx, values: typeof handoffRecord.$inferInsert) {
  const [row] = await db.insert(handoffRecord).values(values).returning();
  return row!;
}

/** B-13: create or replace the quote's hand-off record (one per quote). */
export async function upsertHandoffRecord(db: DbOrTx, values: typeof handoffRecord.$inferInsert) {
  const { quoteId: _q, createdBy: _c, id: _i, ...update } = values;
  const [row] = await db
    .insert(handoffRecord)
    .values(values)
    .onConflictDoUpdate({ target: handoffRecord.quoteId, set: update })
    .returning();
  return row!;
}
