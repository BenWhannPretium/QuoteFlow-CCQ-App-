import { SQL, getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';

import { columnDoc, tableDoc } from '../schema/_doc';
import type { SchemaArea } from '../schema/_doc';
import * as schema from '../schema/index';

export interface DictionaryColumn {
  name: string;
  sqlType: string;
  nullable: boolean;
  default: string | null;
  references: string | null;
  meaning: string;
  owner: string;
}

export interface DictionaryTable {
  name: string;
  area: SchemaArea;
  description: string;
  owner: string;
  columns: DictionaryColumn[];
  checks: { name: string }[];
  indexes: string[];
}

/** Best-effort text of a static SQL default such as `now()`. */
function renderSql(value: SQL): string {
  return value.queryChunks
    .map((chunk) => {
      const parts = (chunk as { value?: unknown }).value;
      return Array.isArray(parts) ? parts.join('') : '';
    })
    .join('');
}

export const AREA_ORDER: SchemaArea[] = ['identity', 'config', 'workflow', 'events', 'integration'];

export function schemaTables(): PgTable[] {
  return (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
    is(value, PgTable),
  );
}

/** Read every table's structure and documentation from the Drizzle schema. Throws on a missing doc. */
export function buildDictionary(): DictionaryTable[] {
  const missing: string[] = [];
  const tables = schemaTables().map((table): DictionaryTable => {
    const name = getTableName(table);
    const doc = tableDoc(table);
    if (!doc) missing.push(`${name} (table)`);
    const config = getTableConfig(table);
    const refs = new Map<string, string>();
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      const target = `${getTableName(ref.foreignTable)}.${ref.foreignColumns.map((col) => col.name).join(', ')}`;
      for (const col of ref.columns)
        refs.set(col.name, ref.columns.length > 1 ? `${target} (composite)` : target);
    }
    const columns = Object.values(getTableColumns(table)).map((col): DictionaryColumn => {
      const cdoc = columnDoc(col);
      if (!cdoc) missing.push(`${name}.${col.name}`);
      const dflt = col.hasDefault
        ? col.default === undefined
          ? 'app-generated'
          : is(col.default, SQL)
            ? renderSql(col.default)
            : JSON.stringify(col.default)
        : null;
      return {
        name: col.name,
        sqlType: col.getSQLType(),
        nullable: !col.notNull,
        default: dflt,
        references: refs.get(col.name) ?? null,
        meaning: cdoc?.meaning ?? '',
        owner: cdoc?.owner ?? doc?.owner ?? '',
      };
    });
    return {
      name,
      area: doc?.area ?? 'workflow',
      description: doc?.description ?? '',
      owner: doc?.owner ?? '',
      columns,
      checks: config.checks.map((ch) => ({ name: ch.name })),
      indexes: config.indexes.map((ix) => ix.config.name ?? '(unnamed)'),
    };
  });
  if (missing.length > 0) throw new Error(`Undocumented schema items: ${missing.join(', ')}`);
  return tables.sort(
    (a, b) =>
      AREA_ORDER.indexOf(a.area) - AREA_ORDER.indexOf(b.area) || a.name.localeCompare(b.name),
  );
}

const quoteLiteral = (text: string) => `'${text.replace(/'/g, "''")}'`;

/** One table or column comment: where it goes, its text and the `COMMENT ON` statement. */
export interface CommentTarget {
  table: string;
  /** Null for the table's own comment. */
  column: string | null;
  text: string;
  sql: string;
}

/** Every table and column comment the schema documents. */
export function commentTargets(tables: DictionaryTable[] = buildDictionary()): CommentTarget[] {
  return tables.flatMap((t) => {
    const tableText = `${t.description} [owner: ${t.owner}]`;
    return [
      {
        table: t.name,
        column: null,
        text: tableText,
        sql: `COMMENT ON TABLE "${t.name}" IS ${quoteLiteral(tableText)}`,
      },
      ...t.columns.map((col) => {
        const text = `${col.meaning} [owner: ${col.owner}]`;
        return {
          table: t.name,
          column: col.name,
          text,
          sql: `COMMENT ON COLUMN "${t.name}"."${col.name}" IS ${quoteLiteral(text)}`,
        };
      }),
    ];
  });
}

/** `COMMENT ON` statements so the meaning and owner also live in the database (for D&A, M6). */
export function commentStatements(tables: DictionaryTable[] = buildDictionary()): string[] {
  return commentTargets(tables).map((c) => c.sql);
}
