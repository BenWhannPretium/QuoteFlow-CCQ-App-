import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { UsageError, runUpgradeCheck } from '../src/cli/release-upgrade-check';
import type { JournalEntry } from '../src/cli/release-upgrade-check';
import { MIGRATIONS_DIR } from '../src/migrate';

/**
 * FB-28: `pnpm release:upgrade-check` against a real Postgres. The base stands in for `origin/main`:
 * this package's migrations without the last entry, so the last one is "what the branch adds", as
 * a pull request with one migration. Journals are rewritten in temp copies (the
 * migrate-journal-reorder pattern); the API is a small stand-in script, because this suite runs
 * before `pnpm build` in CI (the `upgrade` CI job starts the real one).
 */

interface Journal {
  entries: (JournalEntry & Record<string, unknown>)[];
}

const adminUrl = process.env.DB_TEST_URL!;
const journal = JSON.parse(readFileSync(`${MIGRATIONS_DIR}/meta/_journal.json`, 'utf8')) as Journal;
const last = journal.entries.at(-1)!;
const baseEntries = journal.entries.slice(0, -1);
const baseNewest = baseEntries.at(-1)!.when;

let scratch: string;

/** A copy of the migrations folder with its journal rewritten and extra SQL files. */
function migrationsWith(rewrite: (j: Journal) => Journal, files: Record<string, string> = {}) {
  const dir = mkdtempSync(join(scratch, 'migrations-'));
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  writeFileSync(`${dir}/meta/_journal.json`, JSON.stringify(rewrite(structuredClone(journal))));
  for (const [name, sql] of Object.entries(files)) writeFileSync(`${dir}/${name}`, sql);
  return dir;
}

function base(floor = baseNewest) {
  return {
    label: 'base',
    migrationsDir: migrationsWith((j) => ({ entries: j.entries.slice(0, -1) })),
    floor,
  };
}

function script(name: string, body: string): string {
  const file = join(scratch, name);
  writeFileSync(file, body);
  return file;
}

/** Answers /api/v1/health with the given body, on the port the check chose. */
const healthyApi = () =>
  script(
    'healthy.mjs',
    `import { createServer } from 'node:http';
     if (!process.env.DATABASE_URL?.includes('ccq_upgrade_')) process.exit(3);
     createServer((req, res) => {
       res.setHeader('content-type', 'application/json');
       res.end(JSON.stringify({ status: 'ok', version: 'x', db: 'up', time: new Date().toISOString() }));
     }).listen(Number(process.env.PORT), process.env.HOST);`,
  );

async function databases(): Promise<string[]> {
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    const rows = await sql<{ datname: string }[]>`
      select datname from pg_database where datname like 'ccq_upgrade_%'`;
    return rows.map((r) => r.datname);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'ccq-upgrade-int-'));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

afterAll(async () => {
  expect(await databases()).toEqual([]);
});

describe('release:upgrade-check', () => {
  it('passes this branch on top of its base, starts the API and drops its database', async () => {
    const result = await runUpgradeCheck({
      adminUrl,
      base: base(),
      api: { entry: healthyApi(), timeoutMs: 30_000 },
    });
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.proved).toHaveLength(3);
    expect(result.proved[0]).toContain(`new entries ${last.tag}`);
    expect(result.proved[1]).toContain(`all ${journal.entries.length} journal entries`);
    expect(result.proved[2]).toContain('"status":"ok" and "db":"up"');
    expect(await databases()).not.toContain(result.databaseName);
  }, 180_000);

  it('fails, naming it, a new migration whose `when` is below the base newest (2026-11-19)', async () => {
    const result = await runUpgradeCheck({
      adminUrl,
      base: base(),
      branchMigrationsDir: migrationsWith((j) => ({
        entries: j.entries.map((e) => (e.tag === last.tag ? { ...e, when: baseNewest - 1 } : e)),
      })),
      api: null,
    });
    expect(result.ok).toBe(false);
    // The journal check says what to use; the database proves drizzle skipped it.
    expect(result.failures).toEqual([
      expect.stringContaining(
        `\`${last.tag}\` has \`when\` ${baseNewest - 1}, not above ${baseNewest}`,
      ),
      expect.stringContaining(`drizzle skipped \`${last.tag}\``),
    ]);
    expect(await databases()).not.toContain(result.databaseName);
  }, 180_000);

  it('fails a new migration below a `when` merged and later reverted, though the database accepts it', async () => {
    const result = await runUpgradeCheck({
      adminUrl,
      base: base(last.when + 10),
      api: null,
    });
    expect(result.failures).toEqual([
      expect.stringContaining(
        `not above ${last.when + 10}, the largest \`when\` ever merged to base`,
      ),
    ]);
  }, 180_000);

  it('fails a repeated idx', async () => {
    const result = await runUpgradeCheck({
      adminUrl,
      base: base(),
      branchMigrationsDir: migrationsWith((j) => ({
        entries: j.entries.map((e) => (e.tag === last.tag ? { ...e, idx: e.idx - 1 } : e)),
      })),
      api: null,
    });
    expect(result.failures).toEqual([
      expect.stringContaining(`\`${last.tag}\` has idx ${last.idx - 1}, but the entry before it`),
      expect.stringContaining(`has idx ${last.idx - 1} but its tag number is`),
    ]);
  }, 180_000);

  it('fails a tag number that does not match idx', async () => {
    const tag = `0099_${last.tag.slice(5)}`;
    const result = await runUpgradeCheck({
      adminUrl,
      base: base(),
      branchMigrationsDir: migrationsWith(
        (j) => ({ entries: j.entries.map((e) => (e.tag === last.tag ? { ...e, tag } : e)) }),
        { [`${tag}.sql`]: readFileSync(`${MIGRATIONS_DIR}/${last.tag}.sql`, 'utf8') },
      ),
      api: null,
    });
    expect(result.failures).toEqual([
      expect.stringContaining(`\`${tag}\` has idx ${last.idx} but its tag number is 0099`),
    ]);
  }, 180_000);

  it('names a migration that throws, with the Postgres error, and drops its database', async () => {
    const boom = {
      idx: last.idx + 1,
      version: '7',
      when: last.when + 1,
      tag: `${String(last.idx + 1).padStart(4, '0')}_boom`,
      breakpoints: true,
    };
    const result = await runUpgradeCheck({
      adminUrl,
      base: base(),
      branchMigrationsDir: migrationsWith((j) => ({ entries: [...j.entries, boom] }), {
        [`${boom.tag}.sql`]: 'ALTER TABLE "no_such_table" ADD COLUMN "x" text;\n',
      }),
      api: null,
    });
    expect(result.failures).toEqual([
      expect.stringMatching(
        new RegExp(`^\`${boom.tag}\` failed when applied on top of base: 42P01 .*no_such_table`),
      ),
    ]);
    expect(await databases()).not.toContain(result.databaseName);
  }, 180_000);

  it('prints the last lines of the API log when start-up fails', async () => {
    const crash = script(
      'crash.mjs',
      `for (let i = 1; i <= 50; i++) console.log('line ' + i);
       console.error('[quoteflow-start] refusing to start');
       process.exit(1);`,
    );
    const result = await runUpgradeCheck({
      adminUrl,
      base: base(),
      api: { entry: crash, timeoutMs: 30_000 },
    });
    expect(result.failures).toHaveLength(1);
    const [failure] = result.failures;
    expect(failure).toMatch(/^The API exited \(code 1\) before \/api\/v1\/health reported healthy/);
    expect(failure).toContain('| [quoteflow-start] refusing to start');
    expect(failure).toContain('| line 50');
    expect(failure).not.toContain('| line 1\n'); // a tail, not the whole log
  }, 180_000);

  it('fails an API that never reports the database up, within the timeout', async () => {
    const degraded = script(
      'degraded.mjs',
      `import { createServer } from 'node:http';
       createServer((req, res) => { res.statusCode = 503; res.end('{"status":"degraded","db":"down"}'); })
         .listen(Number(process.env.PORT), process.env.HOST);`,
    );
    const result = await runUpgradeCheck({
      adminUrl,
      base: base(),
      api: { entry: degraded, timeoutMs: 3_000 },
    });
    expect(result.failures).toEqual([
      expect.stringContaining(
        'within 3 seconds (last response: {"status":"degraded","db":"down"})',
      ),
    ]);
  }, 180_000);

  it('refuses a database name that already exists, and leaves that database alone', async () => {
    const name = 'ccq_upgrade_fb28_taken';
    const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe(`create database "${name}"`);
      await expect(
        runUpgradeCheck({ adminUrl, base: base(), api: null, databaseName: name }),
      ).rejects.toThrow(UsageError);
      expect(await databases()).toContain(name);
    } finally {
      await sql.unsafe(`drop database if exists "${name}"`);
      await sql.end({ timeout: 5 });
    }
  }, 60_000);
});
