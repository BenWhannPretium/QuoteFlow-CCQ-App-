import { readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { asPersona, persona, pgError, raw, testDb } from './helpers';
import { FB29_SETTINGS } from '../seeds/config/settings';
import type { Tx } from '../src/client';
import { uuidv7 } from '../src/ids';

/**
 * FB-29 (0057): the Salesforce write-back outbox and its settings.
 *
 * - The six settings (provisional, switched off), only in a configured database, with the seed's values
 *   and words; an Admin's value is kept on a re-run; an empty database gets nothing (the seed inserts it).
 * - sf_writeback_outbox is a quote child under row-level security; the app cannot delete or truncate it.
 *
 * The migration ran in the global setup; each test re-runs its hand-written settings part in a
 * rolled-back transaction.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0057_fb29_salesforce_writeback.sql', import.meta.url),
  'utf8',
);
const statements = MIGRATION.slice(MIGRATION.indexOf('-- 2. The settings (provisional'))
  .split('--> statement-breakpoint')
  .filter((s) => s.replace(/--.*$/gm, '').trim() !== '');

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
const KEYS = FB29_SETTINGS.map((s) => s.key);
const settings = (tx: Tx) =>
  raw<{ key: string; value: unknown; provisional: boolean; description: string }>(
    tx,
    sql`select key, value, provisional, description from app_setting where key in (${sql.join(
      KEYS.map((k) => sql`${k}`),
      sql`, `,
    )}) order by key`,
  );

describe('0057: the write-back settings', () => {
  it('a configured database gets the six settings (provisional, off) as seeded; an Admin’s value is kept', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(
        sql`delete from app_setting where key in (${sql.join(
          KEYS.map((k) => sql`${k}`),
          sql`, `,
        )})`,
      );
      await runMigration(tx);
      const rows = await settings(tx);
      expect(rows.map((r) => r.key)).toEqual([...KEYS].sort());
      for (const r of rows) {
        const seed = FB29_SETTINGS.find((s) => s.key === r.key)!;
        expect(r.provisional, r.key).toBe(true);
        expect(r.value, r.key).toEqual(seed.value);
        expect(r.description, r.key).toBe(seed.description);
      }
      expect(rows.find((r) => r.key === 'sf_writeback_enabled')?.value).toBe(false);
      expect(rows.find((r) => r.key === 'sf_writeback_mode')?.value).toBe('dry_run');

      // An Admin switched it on in dry run: a re-run leaves it.
      await tx.execute(
        sql`update app_setting set value = 'true'::jsonb, version = version + 1 where key = 'sf_writeback_enabled'`,
      );
      await runMigration(tx);
      expect((await settings(tx)).find((r) => r.key === 'sf_writeback_enabled')?.value).toBe(true);
    });
  });

  it('an empty database gets nothing (the seed inserts the same rows)', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`delete from app_setting`);
      await runMigration(tx);
      expect(await raw(tx, sql`select 1 from app_setting`)).toHaveLength(0);
    });
  });
});

describe('0057: sf_writeback_outbox', () => {
  let ownQuote = { id: '', opp: '' };
  let otherQuote = { id: '', opp: '' };

  beforeAll(async () => {
    const kamOwner = persona('kam-owner');
    const rows = await raw<{ id: string; kam_user_id: string; opp: string }>(
      db as never,
      sql`select id, kam_user_id, sf_opportunity_id as opp from quote order by quote_number`,
    );
    const own = rows.find((r) => r.kam_user_id === kamOwner.id)!;
    const other = rows.find((r) => r.kam_user_id !== kamOwner.id)!;
    ownQuote = { id: own.id, opp: own.opp };
    otherQuote = { id: other.id, opp: other.opp };
  });

  const insert = (id: string, q: { id: string; opp: string }, dedupeKey = `test:${id}`) => sql`
    insert into sf_writeback_outbox
      (id, quote_id, sf_opportunity_id, event, sf_object, sf_field, value, payload, dedupe_key, status)
    values (${id}, ${q.id}, ${q.opp}, 'outcome_recorded', 'Opportunity', 'StageName', 'Closed Lost',
      '{}', ${dedupeKey}, 'dry_run')`;

  it('is enabled and forced, with the app, migrator and read-only policies; no jsonb or array column', async () => {
    const [cls] = await raw<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      db as never,
      sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'sf_writeback_outbox'`,
    );
    expect(cls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const policies = await raw<{ policyname: string }>(
      db as never,
      sql`select policyname from pg_policies where tablename = 'sf_writeback_outbox' order by policyname`,
    );
    expect(policies.map((p) => p.policyname)).toEqual([
      'sf_writeback_outbox_app',
      'sf_writeback_outbox_migrator',
      'sf_writeback_outbox_readonly',
    ]);
    const types = await raw<{ data_type: string }>(
      db as never,
      sql`select distinct data_type from information_schema.columns where table_name = 'sf_writeback_outbox' order by 1`,
    );
    expect(types.map((t) => t.data_type)).toEqual([
      'boolean',
      'integer',
      'text',
      'timestamp with time zone',
      'uuid',
    ]);
  });

  it('an owner-scoped KAM sees only their own quote’s rows; the app may not delete one', async () => {
    const ids = [uuidv7(), uuidv7()];
    await db.execute(insert(ids[0]!, ownQuote));
    await db.execute(insert(ids[1]!, otherQuote));
    try {
      await asPersona(db, 'kam-owner', async (tx) => {
        const seen = await raw<{ id: string }>(
          tx,
          sql`select id from sf_writeback_outbox where id in (${ids[0]}, ${ids[1]})`,
        );
        expect(seen.map((r) => r.id)).toEqual([ids[0]]);
      });
      expect(
        await pgError(asPersona(db, 'kam-owner', (tx) => raw(tx, insert(uuidv7(), otherQuote)))),
      ).toBe('42501');
      expect(
        await pgError(
          asPersona(db, 'admin', (tx) =>
            raw(tx, sql`delete from sf_writeback_outbox where id = ${ids[0]}`),
          ),
        ),
      ).toBe('42501');
      // The same dedupe key twice is one row.
      expect(await pgError(db.execute(insert(uuidv7(), ownQuote, `test:${ids[0]}`)))).toBe('23505');
    } finally {
      await db.execute(sql`delete from sf_writeback_outbox where id in (${ids[0]}, ${ids[1]})`);
    }
  });
});
