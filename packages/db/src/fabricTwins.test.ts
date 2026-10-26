import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ANALYTICS_SQL_DIR, analyticsSqlFiles } from './migrate';

/**
 * B-27 (CLAUDE.md rule 10): views don't mirror to Fabric, so every analytics view has a T-SQL twin in
 * `sql/fabric/` (same file name, same view name in schema `analytics`, same business definition).
 */
const FABRIC_SQL_DIR = fileURLToPath(new URL('../sql/fabric', import.meta.url));

const pgViews = (sql: string) =>
  [...sql.matchAll(/create (?:or replace )?view (\w+)/gi)].map((m) => m[1]!.toLowerCase());
const fabricViews = (sql: string) =>
  [...sql.matchAll(/create or alter view analytics\.(\w+)/gi)].map((m) => m[1]!.toLowerCase());
/** The `comment on view|function … is '…'` texts, unescaped and with whitespace collapsed. */
const definitions = (sql: string) =>
  [...sql.matchAll(/comment on (?:view|function)[^']*?is\s*'((?:[^']|'')*)'/gi)].map((m) =>
    m[1]!.replace(/''/g, "'").replace(/\s+/g, ' ').trim(),
  );

describe('Fabric T-SQL twins of the analytics views (B-27)', () => {
  const pg = analyticsSqlFiles(ANALYTICS_SQL_DIR);
  const fabric = new Map(
    readdirSync(FABRIC_SQL_DIR)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => [f, readFileSync(`${FABRIC_SQL_DIR}/${f}`, 'utf8')]),
  );

  it('the two folders hold the same files', () => {
    expect([...fabric.keys()].sort()).toEqual(pg.map((f) => f.name));
  });

  it.each(pg.map((f) => [f.name, f.sql] as const))(
    '%s: same views, same definitions',
    (name, sql) => {
      const twin = fabric.get(name) ?? '';
      expect(fabricViews(twin)).toEqual(pgViews(sql));
      const flat = twin.replace(/\n-- ?/g, ' ').replace(/\s+/g, ' ');
      for (const text of definitions(sql)) expect(flat, `${name}: definition text`).toContain(text);
    },
  );
});
