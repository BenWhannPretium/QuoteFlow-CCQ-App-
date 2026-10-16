import { asc, desc, eq } from 'drizzle-orm';

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
  quoteHold,
  stageHistory,
} from '../schema/index';

// Thin persistence for the quote's child records. Rules (who may write what, when) live in the domain.

export const listStageHistory = (db: DbOrTx, quoteId: string) =>
  db
    .select()
    .from(stageHistory)
    .where(eq(stageHistory.quoteId, quoteId))
    .orderBy(asc(stageHistory.enteredAt));

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
  'returnedReason',
  'processType',
  'machineType',
  'plantCode',
  'cavitation',
  'cycleTimeS',
  'toolingNotes',
  'prelimCapitalUsd',
  'downstreamEquipmentNotes',
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

export const getPricingRecord = async (db: DbOrTx, quoteId: string) =>
  first(await db.select().from(pricingRecord).where(eq(pricingRecord.quoteId, quoteId)));

const PRICING_FIELDS = [
  'priceApprovedBy',
  'priceApprovedAt',
  'pricingRefs',
  'approvedRangeNote',
  'capitalReadiness',
  'capitalNotes',
] as const;

export async function upsertPricingRecord(db: DbOrTx, values: typeof pricingRecord.$inferInsert) {
  const [row] = await db
    .insert(pricingRecord)
    .values(values)
    .onConflictDoUpdate({
      target: pricingRecord.quoteId,
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

export const listAttachments = (db: DbOrTx, quoteId: string) =>
  db
    .select()
    .from(attachment)
    .where(eq(attachment.quoteId, quoteId))
    .orderBy(asc(attachment.createdAt));

export async function insertAttachment(db: DbOrTx, values: typeof attachment.$inferInsert) {
  const [row] = await db.insert(attachment).values(values).returning();
  return row!;
}

export const listComments = (db: DbOrTx, quoteId: string) =>
  db.select().from(comment).where(eq(comment.quoteId, quoteId)).orderBy(asc(comment.createdAt));

export async function insertComment(db: DbOrTx, values: typeof comment.$inferInsert) {
  const [row] = await db.insert(comment).values(values).returning();
  return row!;
}

export const getHandoffRecord = async (db: DbOrTx, quoteId: string) =>
  first(await db.select().from(handoffRecord).where(eq(handoffRecord.quoteId, quoteId)));

export async function insertHandoffRecord(db: DbOrTx, values: typeof handoffRecord.$inferInsert) {
  const [row] = await db.insert(handoffRecord).values(values).returning();
  return row!;
}
