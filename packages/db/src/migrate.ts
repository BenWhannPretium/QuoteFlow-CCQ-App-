import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { ADVISORY_LOCKS } from './advisoryLock';
import { commentTargets } from './dictionary/model';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
/** B-17: the analytics views. One definition of every operational metric; D&A reuses these files. */
export const ANALYTICS_SQL_DIR = fileURLToPath(new URL('../sql/analytics', import.meta.url));

/** The analytics view files, in apply order (`00_…`, `10_…`). */
export function analyticsSqlFiles(
  dir: string = ANALYTICS_SQL_DIR,
): { name: string; sql: string }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(`${dir}/${name}`, 'utf8') }));
}

export interface MigrationPaths {
  /** Drizzle migrations folder. Defaults to this package's `migrations/`. */
  migrationsDir?: string;
  /** Analytics view files. Defaults to this package's `sql/analytics/`. */
  analyticsSqlDir?: string;
}

/**
 * B-20: make the login that runs migrations a member of the runtime and migrator roles.
 *
 * Locally the login is a superuser, so `SET LOCAL ROLE ccq_app` and the `*_migrator` RLS policies just
 * work. On Azure Database for PostgreSQL the admin login is not a superuser and has no BYPASSRLS: it
 * creates the roles (CREATEROLE), but PostgreSQL 16 gives the creator only ADMIN OPTION on them
 * (INHERIT and SET off), so `pg_has_role(…, 'MEMBER')` is true while neither applies. Without membership, `SET LOCAL ROLE ccq_app` fails and seeds or data migrations see no
 * rows under FORCE ROW LEVEL SECURITY. Runs before the migrations (so a data migration on a populated
 * database sees every row) and is idempotent; the roles match migration 0004.
 */
export async function ensureRoleMembership(sql: postgres.Sql): Promise<void> {
  const [me] = await sql<{ super: boolean }[]>`
    select rolsuper as super from pg_roles where rolname = current_user`;
  if (me?.super) return;
  await sql.unsafe(`
    DO $$
    DECLARE r text;
    BEGIN
      FOREACH r IN ARRAY ARRAY['ccq_app', 'ccq_migrator', 'ccq_readonly'] LOOP
        BEGIN
          EXECUTE format('CREATE ROLE %I NOLOGIN', r);
        EXCEPTION WHEN duplicate_object OR unique_violation THEN
          NULL;
        END;
      END LOOP;
      FOREACH r IN ARRAY ARRAY['ccq_app', 'ccq_migrator'] LOOP
        IF NOT (pg_has_role(current_user, r, 'USAGE') AND pg_has_role(current_user, r, 'SET')) THEN
          EXECUTE format('GRANT %I TO %I WITH INHERIT TRUE, SET TRUE', r, current_user);
        END IF;
      END LOOP;
    END $$;`);
}

/**
 * Apply all pending drizzle migrations, then the schema's table and column comments that changed
 * and the analytics views. Comments are derived from the Drizzle schema, and the views are
 * `drop … create` files, so both are refreshed on every run rather than frozen into a migration.
 * Views are not mirrored to Fabric (B-27), so re-creating them doesn't touch the mirror.
 *
 * The whole run holds a session advisory lock. The API migrates at start-up, so two instances starting
 * together (scale-out, a restart during a deploy, a slot beside production) used to run the pending set
 * at once: drizzle reads "what is applied" before it opens its transaction and takes no lock of its own,
 * so one instance failed on duplicate DDL and a data-only migration could be applied twice. The second
 * instance now waits here, then finds nothing pending. The lock is released when the connection closes,
 * including when the process dies.
 */
export async function runMigrations(
  databaseUrl: string,
  { migrationsDir = MIGRATIONS_DIR, analyticsSqlDir = ANALYTICS_SQL_DIR }: MigrationPaths = {},
): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    // `max: 1`: every statement below runs on the one session that holds the lock.
    await sql`select pg_advisory_lock(${ADVISORY_LOCKS.migrations.toString()}::bigint)`;
    await ensureRoleMembership(sql);
    await alignAppliedMigrationTimestamps(sql, migrationsDir);
    await migrate(drizzle(sql), { migrationsFolder: migrationsDir });
    await assertAllMigrationsApplied(sql, migrationsDir);
    await applyChangedComments(sql);
    // One transaction: a bad view file leaves the previous definitions in place.
    await sql.begin(async (tx) => {
      for (const file of analyticsSqlFiles(analyticsSqlDir)) await tx.unsafe(file.sql);
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Keep drizzle's bookkeeping in step with the journal when a migration's `when` is changed after it
 * has been applied somewhere. Drizzle's migrator reads only the applied row with the newest
 * `created_at` and runs every journal entry whose `when` is later. So if an applied migration's `when`
 * moves forward, it counts as pending again and its DDL fails (2026-11-19: 0054/0055 were moved after
 * 0053's hand-set `when`; a database migrated from empty since #113 had them stored at the old values).
 *
 * Each applied row is matched to its journal entry by drizzle's own hash of the SQL file, and its
 * `created_at` is set to that entry's `when`. A database missing a migration has no row to match, so it
 * still gets the migration. Rows whose SQL is not in the journal, or whose hash several entries share,
 * are left alone. Returns how many rows were changed.
 */
export async function alignAppliedMigrationTimestamps(
  sql: postgres.Sql,
  migrationsDir: string = MIGRATIONS_DIR,
): Promise<number> {
  const [table] = await sql<{ exists: boolean }[]>`
    select to_regclass('drizzle.__drizzle_migrations') is not null as exists`;
  if (!table?.exists) return 0;

  const byHash = new Map<string, number | null>();
  for (const m of readMigrationFiles({ migrationsFolder: migrationsDir })) {
    byHash.set(m.hash, byHash.has(m.hash) ? null : m.folderMillis);
  }
  let changed = 0;
  await sql.begin(async (tx) => {
    for (const [hash, when] of byHash) {
      if (when === null) continue;
      const result = await tx`
        update drizzle.__drizzle_migrations set created_at = ${when}
        where hash = ${hash} and created_at is distinct from ${when}`;
      changed += result.count;
    }
  });
  return changed;
}

/**
 * Thrown when drizzle's migrator finished but left journal migrations unapplied. The message names
 * migration tags only (no row data), so start-up may log it in full.
 */
export class MigrationsNotAppliedError extends Error {
  override name = 'MigrationsNotAppliedError';
  constructor(readonly tags: string[]) {
    super(
      `${tags.join(', ')} not applied: drizzle skips a migration whose journal \`when\` is not later ` +
        'than the newest applied migration. Give it a later `when` (see migrationJournal.test.ts).',
    );
  }
}

/**
 * 2026-11-19 test outage: drizzle skipped 0054/0055 without an error, and start-up then failed later on
 * a `COMMENT ON COLUMN` for a column 0054 should have added (Postgres 42703, with no hint why). Check
 * every journal entry is now recorded as applied and fail with the skipped tags instead.
 *
 * An entry counts as applied if a row has its hash, or if a row whose hash matches no journal entry
 * has its `when` as `created_at`: that keeps a migration file edited after it was applied (new hash,
 * same `when`) from tripping this. Extra rows (a newer build ran here before a rollback) are ignored.
 */
export async function assertAllMigrationsApplied(
  sql: postgres.Sql,
  migrationsDir: string = MIGRATIONS_DIR,
): Promise<void> {
  const rows = await sql<{ hash: string; created_at: string }[]>`
    select hash, created_at::text as created_at from drizzle.__drizzle_migrations`;
  const journal = JSON.parse(readFileSync(`${migrationsDir}/meta/_journal.json`, 'utf8')) as {
    entries: { tag: string }[];
  };
  // readMigrationFiles returns one item per journal entry, in journal order.
  const files = readMigrationFiles({ migrationsFolder: migrationsDir });
  const journalHashes = new Set(files.map((m) => m.hash));
  const hashes = new Set(rows.map((r) => r.hash));
  // Only rows whose SQL is no longer in the journal (an edited file) may match by `when`: a row that
  // already matches an entry by hash must not also vouch for another entry that shares its `when`.
  const editedWhens = new Set(
    rows.filter((r) => !journalHashes.has(r.hash)).map((r) => r.created_at),
  );
  const missing = files.flatMap((m, i) =>
    hashes.has(m.hash) || editedWhens.has(String(m.folderMillis))
      ? []
      : [journal.entries[i]?.tag ?? `entry ${i}`],
  );
  if (missing.length > 0) throw new MigrationsNotAppliedError(missing);
}

/**
 * Apply only the table and column comments that differ from the database's. Migrations run on every
 * start (azureStart.ts), and B-27: a `COMMENT ON` per column on each restart is needless DDL against
 * tables Fabric mirrors. Returns how many were applied.
 */
export async function applyChangedComments(sql: postgres.Sql): Promise<number> {
  const rows = await sql<{ table: string; column: string | null; text: string }[]>`
    select c.relname as table, a.attname as column, d.description as text
    from pg_description d
    join pg_class c on c.oid = d.objoid and d.classoid = 'pg_class'::regclass
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    left join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid and d.objsubid > 0`;
  const current = new Map(rows.map((r) => [`${r.table}.${r.column ?? ''}`, r.text]));
  const changed = commentTargets().filter(
    (t) => current.get(`${t.table}.${t.column ?? ''}`) !== t.text,
  );
  if (changed.length > 0) {
    await sql.begin(async (tx) => {
      for (const t of changed) await tx.unsafe(t.sql);
    });
  }
  return changed.length;
}

/** Drop everything the app owns (public schema + drizzle bookkeeping). Local/test only. */
export async function dropAll(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe('drop schema if exists drizzle cascade');
    await sql.unsafe('drop schema if exists public cascade');
    await sql.unsafe('create schema public');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Create a database if it does not exist, using a connection to the server's `postgres` db. */
export async function ensureDatabase(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Refusing unsafe database name: ${name}`);
  url.pathname = '/postgres';
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    const rows = await sql`select 1 from pg_database where datname = ${name}`;
    if (rows.length === 0) await sql.unsafe(`create database "${name}"`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
