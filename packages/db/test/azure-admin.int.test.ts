import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runSeed } from '../src/cli/seed';
import { runMigrations } from '../src/migrate';

/**
 * B-20: Azure Database for PostgreSQL's admin login is NOSUPERUSER, NOBYPASSRLS, CREATEROLE. On
 * PostgreSQL 16 the roles it creates come with ADMIN OPTION only (INHERIT and SET off). This test
 * builds that login on the local server, gives it exactly that membership in the ccq_* roles, and
 * checks that migrations and both seeds work as it (they need `SET ROLE` and the migrator RLS policies).
 */
const adminUrl = process.env.DB_TEST_URL!;
const login = 'ccq_azure_admin_test';
const password = 'azure-like-test-only';
const database = `${new URL(adminUrl).pathname.slice(1)}_azure`;

const asSuperuser = () => postgres(adminUrl, { max: 1, onnotice: () => {} });
const loginUrl = () => {
  const url = new URL(adminUrl);
  url.username = login;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
};

async function cleanup(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`drop database if exists "${database}" with (force)`);
  await sql.unsafe(`
    DO $$ BEGIN
      IF EXISTS (select 1 from pg_roles where rolname = '${login}') THEN
        EXECUTE 'REVOKE ccq_app, ccq_migrator, ccq_readonly FROM ${login} CASCADE';
        EXECUTE 'DROP ROLE ${login}';
      END IF;
    END $$;`);
}

describe('migrations and seeds as an Azure-style admin login', () => {
  beforeAll(async () => {
    const sql = asSuperuser();
    try {
      await cleanup(sql);
      await sql.unsafe(
        `create role ${login} login nosuperuser nobypassrls createrole createdb password '${password}'`,
      );
      // What PostgreSQL 16 gives the creator of a role: ADMIN OPTION, no INHERIT, no SET.
      await sql.unsafe(
        `grant ccq_app, ccq_migrator, ccq_readonly to ${login} with admin true, inherit false, set false`,
      );
      await sql.unsafe(`create database "${database}" owner ${login}`);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  afterAll(async () => {
    const sql = asSuperuser();
    try {
      await cleanup(sql);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it('migrates, seeds config and synthetic data, and can act as ccq_app', async () => {
    await runMigrations(loginUrl());
    await runSeed(loginUrl(), { synthetic: true });
    // Idempotent: a second start (App Service restart) changes nothing and does not fail.
    await runMigrations(loginUrl());
    await runSeed(loginUrl(), { synthetic: true });

    const sql = postgres(loginUrl(), { max: 1, onnotice: () => {} });
    try {
      const [count] = await sql<{ n: number }[]>`select count(*)::int as n from quote`;
      expect(count!.n).toBeGreaterThan(0);
      const roles = await sql.begin(async (tx) => {
        await tx.unsafe('set local role ccq_app');
        return tx<{ role: string }[]>`select current_user as role`;
      });
      expect(roles[0]!.role).toBe('ccq_app');
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
