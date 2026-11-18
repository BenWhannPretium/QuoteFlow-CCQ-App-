import { readFileSync } from 'node:fs';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS_DIR, dropAll, ensureDatabase, runMigrations } from '../src/migrate';

/**
 * Audit 2026-11-17 (A-03). The API migrates at start-up (`azureStart.ts`), so two instances that start
 * together (scale-out, a restart overlapping a deploy, a staging slot beside production) both run
 * `runMigrations` against one database. drizzle's migrator reads "what is applied" before it opens its
 * transaction and takes no lock, so both ran the pending set: one failed on duplicate DDL and exited, and a
 * data-only migration could be applied twice. `runMigrations` now holds a session advisory lock for the
 * whole run; the instance that waits finds nothing left to do.
 */

const url = (() => {
  const u = new URL(process.env.DB_TEST_URL!);
  u.pathname = `${u.pathname}_migrate_race`;
  return u.toString();
})();

const journal = JSON.parse(readFileSync(`${MIGRATIONS_DIR}/meta/_journal.json`, 'utf8')) as {
  entries: { tag: string }[];
};

beforeAll(async () => {
  await ensureDatabase(url);
  await dropAll(url);
}, 60_000);

afterAll(async () => {
  await dropAll(url);
});

describe('runMigrations from several instances at once', () => {
  it('applies every migration exactly once and none of the runs fails', async () => {
    const runs = await Promise.allSettled([
      runMigrations(url),
      runMigrations(url),
      runMigrations(url),
    ]);
    expect(runs.map((r) => (r.status === 'rejected' ? String(r.reason) : 'ok'))).toEqual([
      'ok',
      'ok',
      'ok',
    ]);

    const sql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      const [applied] = await sql<{ n: number; distinct: number }[]>`
        select count(*)::int as n, count(distinct hash)::int as distinct
        from drizzle.__drizzle_migrations`;
      expect(applied).toEqual({ n: journal.entries.length, distinct: journal.entries.length });
      // The lock is session-level: nothing is left held once the runs have closed their connections.
      const [held] = await sql<{ n: number }[]>`
        select count(*)::int as n from pg_locks where locktype = 'advisory' and database =
          (select oid from pg_database where datname = current_database())`;
      expect(held?.n).toBe(0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }, 240_000);

  it('a second run on an up-to-date database is a no-op that still succeeds', async () => {
    await expect(runMigrations(url)).resolves.toBeUndefined();
  }, 120_000);
});
