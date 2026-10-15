import { getTableName, sql } from 'drizzle-orm';
import type { Column, SQL } from 'drizzle-orm';
import type { PgColumnBuilderBase, PgTable } from 'drizzle-orm/pg-core';

/**
 * Column and table documentation. Drizzle 0.45 has no column-comment API, so the text rides on the
 * column builder's config (which Drizzle hands to the built column unchanged). It is the single
 * source for the `COMMENT ON` statements applied after migrations and for `docs/data-dictionary.md`.
 */
export type SchemaArea = 'identity' | 'config' | 'workflow' | 'events' | 'integration';

export interface ColumnDoc {
  meaning: string;
  /** Who owns the value. Defaults to the table owner. */
  owner?: string;
}

export interface TableDoc {
  area: SchemaArea;
  description: string;
  /** Default owner for the table's columns (role, team or system of record). */
  owner: string;
}

interface WithDoc {
  config: { ccqDoc?: ColumnDoc };
}

/** Attach meaning (and optionally an owner) to a column builder. */
export function c<T extends PgColumnBuilderBase>(builder: T, meaning: string, owner?: string): T {
  (builder as unknown as WithDoc).config.ccqDoc = owner ? { meaning, owner } : { meaning };
  return builder;
}

export function columnDoc(column: Column): ColumnDoc | undefined {
  return (column as unknown as WithDoc).config.ccqDoc;
}

const TABLE_DOCS = new Map<string, TableDoc>();

/** Register a table's description and owner. Returns the table so it can wrap `pgTable(...)`. */
export function documented<T extends PgTable>(table: T, doc: TableDoc): T {
  TABLE_DOCS.set(getTableName(table), doc);
  return table;
}

export function tableDoc(table: PgTable): TableDoc | undefined {
  return TABLE_DOCS.get(getTableName(table));
}

/** `col IN ('a','b')` for CHECK constraints. Values are compile-time constants, never user input. */
export function inList(column: Column | SQL, values: readonly string[]): SQL {
  for (const v of values) if (!/^[A-Za-z0-9_.-]+$/.test(v)) throw new Error(`unsafe literal ${v}`);
  return sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`;
}
