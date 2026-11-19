import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MIGRATIONS_DIR,
  MigrationsNotAppliedError,
  dropAll,
  ensureDatabase,
  runMigrations,
} from '../src/migrate';

/**
 * 2026-11-19 test outage. 0053 carried a hand-set journal `when` later than 0054 and 0055, so a
 * database that had 0053 skipped both (drizzle compares only the newest applied `created_at`). The fix
 * moved 0054/0055 after 0053. Both kinds of existing database must then start:
 * - one that has 0053 but not 0054/0055 (the test environment) applies them;
 * - one migrated from empty while 0054/0055 had their old `when` (local databases since #113) has
 *   them stored at the old values, and must not run them again (0054's ADD COLUMN would fail).
 */

interface Journal {
  entries: { idx: number; when: number; tag: string }[];
}

const OLD_WHEN: Record<string, number> = {
  '0054_fb26_requote_expiry_handoff': 1795063617047,
  '0055_fb23_engineering_cost_packout': 1795065803367,
};

const url = (() => {
  const u = new URL(process.env.DB_TEST_URL!);
  u.pathname = `${u.pathname}_journal_reorder`;
  return u.toString();
})();

const journal = JSON.parse(readFileSync(`${MIGRATIONS_DIR}/meta/_journal.json`, 'utf8')) as Journal;

let dir: string;

/** A copy of the migrations folder with its journal rewritten, as an older build shipped it. */
function migrationsAsShipped(rewrite: (j: Journal) => Journal): string {
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  writeFileSync(`${dir}/meta/_journal.json`, JSON.stringify(rewrite(structuredClone(journal))));
  return dir;
}

async function migrateWith(folder: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: folder });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function state() {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [applied] = await sql<{ n: number; distinct: number; newest: string }[]>`
      select count(*)::int as n, count(distinct hash)::int as distinct, max(created_at)::text as newest
      from drizzle.__drizzle_migrations`;
    const [column] = await sql<{ n: number }[]>`
      select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'quote' and column_name = 'requoted_from_quote_id'`;
    return { ...applied, requotedColumn: column?.n };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ccq-migrations-'));
  await ensureDatabase(url);
  await dropAll(url);
}, 60_000);

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

afterAll(async () => {
  await dropAll(url);
});

const expected = {
  n: journal.entries.length,
  distinct: journal.entries.length,
  newest: String(journal.entries.at(-1)!.when),
  requotedColumn: 1,
};

describe('runMigrations after 0054/0055 were moved after 0053', () => {
  it('applies them on a database that has 0053 but not 0054/0055 (the test environment)', async () => {
    // The build the test environment ran: everything up to 0053. A migration added after 0055 must not
    // be in it, or it would be applied first and drizzle would then (rightly) skip 0054/0055.
    await migrateWith(
      migrationsAsShipped((j) => ({
        entries: j.entries.slice(
          0,
          j.entries.findIndex((e) => e.tag in OLD_WHEN),
        ),
      })),
    );
    expect((await state()).requotedColumn).toBe(0);

    await runMigrations(url);
    expect(await state()).toEqual(expected);
  }, 180_000);

  it('does not run them again on a database migrated from empty with their old timestamps', async () => {
    await migrateWith(
      migrationsAsShipped((j) => ({
        entries: j.entries.map((e) => (e.tag in OLD_WHEN ? { ...e, when: OLD_WHEN[e.tag]! } : e)),
      })),
    );
    expect((await state()).n).toBe(journal.entries.length);

    await runMigrations(url);
    expect(await state()).toEqual(expected);
  }, 180_000);

  it('refuses, naming the migration, when drizzle would skip one (a `when` not after the newest applied)', async () => {
    const last = journal.entries.at(-1)!;
    await migrateWith(migrationsAsShipped((j) => ({ entries: j.entries.slice(0, -1) })));

    // The same build again, but the last migration's `when` is now older than the one before it.
    const skipped = migrationsAsShipped((j) => ({
      entries: j.entries.map((e) =>
        e.tag === last.tag ? { ...e, when: j.entries.at(-2)!.when - 1 } : e,
      ),
    }));
    const err = await runMigrations(url, { migrationsDir: skipped }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationsNotAppliedError);
    expect((err as MigrationsNotAppliedError).tags).toEqual([last.tag]);
  }, 180_000);
});
