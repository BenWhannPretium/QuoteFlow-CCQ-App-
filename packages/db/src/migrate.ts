import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { commentStatements } from './dictionary/model';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
/** B-17: the analytics views. One definition of every operational metric; D&A reuses these files. */
export const ANALYTICS_SQL_DIR = fileURLToPath(new URL('../sql/analytics', import.meta.url));

/** The analytics view files, in apply order (`00_…`, `10_…`). */
export function analyticsSqlFiles(): { name: string; sql: string }[] {
  return readdirSync(ANALYTICS_SQL_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(`${ANALYTICS_SQL_DIR}/${name}`, 'utf8') }));
}

/**
 * Apply all pending drizzle migrations, then (re)apply the schema's table and column comments and
 * the analytics views. Comments are derived from the Drizzle schema, and the views are `drop … create`
 * files, so both are refreshed on every run rather than frozen into a migration.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_DIR });
    await sql.begin(async (tx) => {
      for (const statement of commentStatements()) await tx.unsafe(statement);
    });
    // One transaction: a bad view file leaves the previous definitions in place.
    await sql.begin(async (tx) => {
      for (const file of analyticsSqlFiles()) await tx.unsafe(file.sql);
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
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
