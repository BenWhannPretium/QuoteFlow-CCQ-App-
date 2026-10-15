import { getTableColumns, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

/**
 * `{ col: excluded.col }` for the given property keys: the SET clause of an upsert that takes the
 * incoming row's values.
 */
export function excludedSet<T extends PgTable>(
  table: T,
  keys: readonly (keyof T['_']['columns'] & string)[],
) {
  const columns = getTableColumns(table) as Record<string, { name: string }>;
  const set: Record<string, SQL> = {};
  for (const key of keys) {
    const column = columns[key];
    if (!column) throw new Error(`unknown column ${key}`);
    set[key] = sql.raw(`excluded."${column.name}"`);
  }
  return set;
}

/** First row or undefined, for single-row lookups. */
export const first = <T>(rows: T[]): T | undefined => rows[0];
