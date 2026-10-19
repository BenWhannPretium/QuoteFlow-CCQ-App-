import { getTableColumns, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import type { DbOrTx } from '../../src/client';

/**
 * Idempotent config upsert. New rows are inserted; existing rows are refreshed from the seed only
 * while they are still provisional, unapproved and untouched (`version = 1`), so a re-seed never
 * overwrites a value the business has approved or an admin has edited (B-19 bumps `version` on every
 * console change). The config `version` is not bumped by seeding.
 */
export async function upsertConfig<T extends PgTable>(
  db: DbOrTx,
  table: T,
  rows: T['$inferInsert'][],
  conflictKeys: (keyof T['_']['columns'] & string)[],
): Promise<void> {
  if (rows.length === 0) return;
  const columns = getTableColumns(table) as Record<string, PgColumn>;
  const skip = new Set([
    'id',
    'createdAt',
    'createdBy',
    'version',
    'approvedBy',
    'approvedAt',
    ...conflictKeys,
  ]);
  const set: Record<string, SQL> = { updatedAt: sql`now()` };
  for (const key of Object.keys(rows[0] as object)) {
    if (skip.has(key) || !columns[key]) continue;
    set[key] = sql.raw(`excluded."${columns[key].name}"`);
  }
  const provisional = columns.provisional!;
  const approvedAt = columns.approvedAt!;
  const version = columns.version!;
  await db
    .insert(table)
    .values(rows)
    .onConflictDoUpdate({
      target: conflictKeys.map((k) => columns[k]!),
      set,
      setWhere: sql`${provisional} = true and ${approvedAt} is null and ${version} = 1`,
    });
}
