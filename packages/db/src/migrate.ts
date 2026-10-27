import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

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
 */
export async function runMigrations(
  databaseUrl: string,
  { migrationsDir = MIGRATIONS_DIR, analyticsSqlDir = ANALYTICS_SQL_DIR }: MigrationPaths = {},
): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await ensureRoleMembership(sql);
    await migrate(drizzle(sql), { migrationsFolder: migrationsDir });
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
