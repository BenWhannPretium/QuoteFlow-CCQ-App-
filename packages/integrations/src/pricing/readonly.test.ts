import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * CCQ never writes to the pricing app (CLAUDE.md rule 5): the login is read-only and scoped to the
 * views, `assertSelectOnly` refuses any non-SELECT at runtime, and this test is the third check: no
 * SQL write statement, stored-procedure call or raw batch API may appear in the connector's source.
 */
const SQL_WRITE =
  /\b(INSERT\s+INTO|UPDATE\s+\[?\w+|DELETE\s+FROM|MERGE\s+INTO|EXEC(UTE)?\s+\w+|DROP\s+(TABLE|VIEW)|ALTER\s+(TABLE|VIEW)|CREATE\s+(TABLE|VIEW)|TRUNCATE\s+TABLE)\b/;
/** mssql write / batch / procedure APIs. Only `request().query()` with a checked SELECT is used. */
const MSSQL_WRITE_API = /\.\s*(execute|batch|bulk|transaction|Transaction|PreparedStatement)\s*\(/;

const dir = fileURLToPath(new URL('.', import.meta.url));

const sourceFiles = readdirSync(dir)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => join(dir, f));

describe('pricing connector is read-only', () => {
  it('scans the connector source', () => {
    expect(sourceFiles.map((f) => f.slice(dir.length))).toEqual(
      expect.arrayContaining(['reader.ts', 'sql.ts', 'mssql.ts', 'fake.ts', 'columnMap.ts']),
    );
  });

  it.each(sourceFiles.map((f) => [f.slice(dir.length), f]))(
    '%s has no write statements',
    (_n, file) => {
      const offending = readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => ({ line: line.replace(/\/\/.*$|^\s*\*.*$/, ''), no: i + 1 }))
        .filter(({ line }) => SQL_WRITE.test(line) || MSSQL_WRITE_API.test(line))
        .map(({ line, no }) => `${no}: ${line.trim()}`);
      expect(offending).toEqual([]);
    },
  );

  it('the patterns catch write SQL and the mssql write APIs', () => {
    for (const text of [
      'INSERT INTO ccq.v_ERF VALUES (1)',
      'UPDATE [ccq].[v_ERF] SET x = 1',
      'DELETE FROM erf',
      'EXEC sp_update_price',
      'DROP TABLE erf',
    ]) {
      expect(SQL_WRITE.test(text), text).toBe(true);
    }
    for (const call of [
      'request.execute("proc")',
      'request.batch(sql)',
      'request.bulk(table)',
      'pool.transaction()',
    ]) {
      expect(MSSQL_WRITE_API.test(call), call).toBe(true);
    }
    expect(SQL_WRITE.test('SELECT TOP (@top) [Decision_Date] FROM [ccq].[v_ERF]')).toBe(false);
  });
});
