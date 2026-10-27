import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import * as schema from './index';
import {
  FABRIC_JSON_COMPANIONS,
  FABRIC_SIDE_TABLES,
  fabricCompanionColumns,
  fabricCompanionName,
  isFabricMirroredType,
} from '../fabric';

/**
 * B-27 guard (CLAUDE.md rule 10): every column Fabric mirroring can't copy has a registered
 * `_json` text companion, numerics are bounded at precision 38, and the registry has no stale
 * entries. A new jsonb or array column fails here until it is added to `src/fabric.ts` and a
 * migration (the integration test `fabric.int.test.ts` then checks the database itself).
 */
const tables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => getTableConfig(table));

const registered = new Set(fabricCompanionColumns().map((r) => `${r.table}.${r.column}`));

describe('Fabric mirror-safe schema (B-27)', () => {
  it('reads the whole schema', () => {
    expect(tables.length).toBeGreaterThan(30);
  });

  it('every column Fabric drops has a registered _json companion', () => {
    const missing: string[] = [];
    for (const t of tables)
      for (const col of t.columns)
        if (!isFabricMirroredType(col.getSQLType()) && !registered.has(`${t.name}.${col.name}`))
          missing.push(`${t.name}.${col.name} (${col.getSQLType()})`);
    expect(
      missing,
      'add these to FABRIC_JSON_COMPANIONS in src/fabric.ts and give them a companion in a migration; an unbounded numeric needs a precision ≤ 38 instead',
    ).toEqual([]);
  });

  it('the registry names only real columns that need a companion', () => {
    const byName = new Map(tables.map((t) => [t.name, t]));
    for (const { table, column } of fabricCompanionColumns()) {
      const col = byName.get(table)?.columns.find((c) => c.name === column);
      expect(col, `${table}.${column} is not in the schema`).toBeDefined();
      expect(isFabricMirroredType(col!.getSQLType()), `${table}.${column} mirrors as is`).toBe(
        false,
      );
    }
  });

  it('companions never clash with a Drizzle column (they stay out of the app)', () => {
    for (const [table, columns] of Object.entries(FABRIC_JSON_COMPANIONS)) {
      const names = tables.find((t) => t.name === table)!.columns.map((c) => c.name);
      for (const column of columns) expect(names).not.toContain(fabricCompanionName(column));
    }
  });

  it('each side table holds a companion for every listed column', () => {
    for (const side of Object.values(FABRIC_SIDE_TABLES)) {
      const t = tables.find((x) => x.name === side.table);
      expect(t, side.table).toBeDefined();
      const names = t!.columns.map((c) => c.name);
      expect(names).toContain(side.key);
      for (const column of side.columns) expect(names).toContain(fabricCompanionName(column));
    }
  });

  it('every table has a primary key (Fabric needs a replica identity)', () => {
    for (const t of tables)
      expect(
        t.columns.some((c) => c.primary) || t.primaryKeys.length > 0,
        `${t.name} has no primary key`,
      ).toBe(true);
  });
});

describe('isFabricMirroredType', () => {
  it.each([
    ['uuid', true],
    ['text', true],
    ['timestamp (3) with time zone', true],
    ['timestamp with time zone', true],
    ['numeric(14, 2)', true],
    ['numeric(38, 4)', true],
    ['integer', true],
    ['boolean', true],
    ['date', true],
    ['jsonb', false],
    ['json', false],
    ['text[]', false],
    ['uuid[]', false],
    ['numeric', false],
    ['numeric(39, 2)', false],
    ['interval', false],
    ['inet', false],
    ['tstzrange', false],
  ])('%s → %s', (type, expected) => {
    expect(isFabricMirroredType(type)).toBe(expected);
  });

  it('takes the precision from information_schema when the type has none', () => {
    expect(isFabricMirroredType('numeric', 14)).toBe(true);
    expect(isFabricMirroredType('numeric', null)).toBe(false);
    expect(isFabricMirroredType('ARRAY')).toBe(false);
  });
});
