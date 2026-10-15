import { desc, eq, sql } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { excludedSet, first } from './_util';
import { customer, integrationRun, sfOpportunitySnapshot } from '../schema/index';

export type SfOpportunitySnapshot = typeof sfOpportunitySnapshot.$inferSelect;

const SNAPSHOT_FIELDS = [
  'name',
  'accountId',
  'accountName',
  'ownerAlias',
  'ownerEmail',
  'amount',
  'closeDate',
  'sfStage',
  'erfNumberSf',
  'quoteSourceSf',
  'raw',
  'syncedAt',
] as const;

export async function upsertSfOpportunities(
  db: DbOrTx,
  rows: (typeof sfOpportunitySnapshot.$inferInsert)[],
) {
  if (rows.length === 0) return [];
  return db
    .insert(sfOpportunitySnapshot)
    .values(rows)
    .onConflictDoUpdate({
      target: sfOpportunitySnapshot.sfOpportunityId,
      set: { ...excludedSet(sfOpportunitySnapshot, SNAPSHOT_FIELDS), updatedAt: new Date() },
    })
    .returning();
}

export const getSfOpportunity = async (db: DbOrTx, sfOpportunityId: string) =>
  first(
    await db
      .select()
      .from(sfOpportunitySnapshot)
      .where(eq(sfOpportunitySnapshot.sfOpportunityId, sfOpportunityId)),
  );

/** Fuzzy name search for the intake picker (pg_trgm). */
export const searchSfOpportunities = (db: DbOrTx, text: string, limit = 20) =>
  db
    .select()
    .from(sfOpportunitySnapshot)
    .where(
      sql`${sfOpportunitySnapshot.name} % ${text} or ${sfOpportunitySnapshot.name} ilike ${'%' + text + '%'}`,
    )
    .orderBy(sql`similarity(${sfOpportunitySnapshot.name}, ${text}) desc`)
    .limit(limit);

export const getCustomer = async (db: DbOrTx, id: string) =>
  first(await db.select().from(customer).where(eq(customer.id, id)));

export async function insertCustomer(db: DbOrTx, values: typeof customer.$inferInsert) {
  const [row] = await db.insert(customer).values(values).returning();
  return row!;
}

export async function startIntegrationRun(
  db: DbOrTx,
  source: (typeof integrationRun.$inferInsert)['source'],
  at: Date,
) {
  const [row] = await db.insert(integrationRun).values({ source, startedAt: at }).returning();
  return row!;
}

export const finishIntegrationRun = (
  db: DbOrTx,
  id: string,
  result: {
    status: 'succeeded' | 'failed' | 'partial';
    finishedAt: Date;
    counts?: Record<string, number>;
    error?: string;
  },
) => db.update(integrationRun).set(result).where(eq(integrationRun.id, id));

export const listIntegrationRuns = (db: DbOrTx, limit = 50) =>
  db.select().from(integrationRun).orderBy(desc(integrationRun.startedAt)).limit(limit);
