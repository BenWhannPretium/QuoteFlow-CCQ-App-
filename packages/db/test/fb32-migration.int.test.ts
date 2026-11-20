import { readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { raw, testDb } from './helpers';
import {
  INTAKE_SF_SUGGESTIONS_DESCRIPTION,
  INTAKE_SF_SUGGESTIONS_ENABLED,
} from '../seeds/config/settings';
import type { Tx } from '../src/client';

/**
 * FB-32 (0058): the `intake_sf_suggestions_enabled` setting in existing environments. Data only.
 * Provisional and OFF. A row that exists (an Admin's edit, the business's approval) is left alone; a
 * database with no config yet is untouched (the seed inserts the same row).
 *
 * The migration ran in the global setup (an empty database, then the seed); each test re-runs its data
 * statements in a rolled-back transaction from the state an environment had before it.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0058_fb32_salesforce_prefill.sql', import.meta.url),
  'utf8',
);
const statements = MIGRATION.split('--> statement-breakpoint').filter((s) => {
  const body = s.replace(/--.*$/gm, '').trim();
  return body !== '' && /^(INSERT|UPDATE)/i.test(body);
});

class Rollback extends Error {}
async function rolledBack(fn: (tx: Tx) => Promise<void>) {
  await db
    .transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    })
    .catch((err: unknown) => {
      if (!(err instanceof Rollback)) throw err;
    });
}
const runMigration = async (tx: Tx) => {
  for (const s of statements) await tx.execute(sql.raw(s));
};

const KEY = 'intake_sf_suggestions_enabled';
const row = async (tx: Tx) =>
  (
    await raw<{ value: unknown; description: string; provisional: boolean; approved_at: unknown }>(
      tx,
      sql`select value, description, provisional, approved_at from app_setting where key = ${KEY}`,
    )
  )[0];

describe('0058 intake_sf_suggestions_enabled', () => {
  it('has one statement to run', () => {
    expect(statements).toHaveLength(1);
  });

  it('adds the setting, off and provisional, as the seed has it, to a configured environment', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`delete from app_setting where key = ${KEY}`);
      expect(await row(tx)).toBeUndefined();
      await runMigration(tx);
      expect(await row(tx)).toMatchObject({
        value: INTAKE_SF_SUGGESTIONS_ENABLED,
        provisional: true,
        description: INTAKE_SF_SUGGESTIONS_DESCRIPTION,
      });
      expect(INTAKE_SF_SUGGESTIONS_ENABLED).toBe(false);
      // Running it again changes nothing.
      const before = await raw(tx, sql`select key, value from app_setting order by key`);
      await runMigration(tx);
      expect(await raw(tx, sql`select key, value from app_setting order by key`)).toEqual(before);
    });
  });

  it('leaves an Admin-edited row and an approved row alone', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(
        sql`update app_setting set value = 'true'::jsonb, description = 'edited by an Admin' where key = ${KEY}`,
      );
      await runMigration(tx);
      expect(await row(tx)).toMatchObject({ value: true, description: 'edited by an Admin' });
      await tx.execute(
        sql`update app_setting set provisional = false, approved_at = now() where key = ${KEY}`,
      );
      await runMigration(tx);
      expect(await row(tx)).toMatchObject({ value: true, provisional: false });
    });
  });

  it('a database with no config yet is untouched (the seed inserts the same row)', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`delete from app_setting`);
      await runMigration(tx);
      expect(await raw(tx, sql`select 1 from app_setting`)).toEqual([]);
    });
  });
});
