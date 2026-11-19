import { readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { asPersona, persona, pgError, raw, testDb } from './helpers';
import { FB23_SETTING_DESCRIPTIONS } from '../seeds/config/settings';
import type { Tx } from '../src/client';
import { uuidv7 } from '../src/ids';

/**
 * FB-23 (0053): the engineering cost estimate and pack-out.
 *
 * - The four settings (provisional) and the two value lists, only in a configured database; an existing
 *   row (an Admin's value) is left alone; an empty database gets nothing (the seed inserts it).
 * - The offer letter template gains the "Equipment / tool lead time" row only where it is FB-24's seed.
 * - eng_cost_line is a quote child under row-level security.
 *
 * The migration ran in the global setup; each test re-runs its hand-written part in a rolled-back
 * transaction.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0053_fb23_engineering_cost_packout.sql', import.meta.url),
  'utf8',
);
// The data statements only (the DDL and the policies cannot run twice).
const statements = MIGRATION.slice(MIGRATION.indexOf('-- 2. The settings (provisional).'))
  .split('--> statement-breakpoint')
  .filter((s) => s.replace(/--.*$/gm, '').trim() !== '');
// FB-24's seed of the offer letter template, as the migration matches it.
const FB24_TEMPLATE = /AND "value" = '(\{.*\})'::jsonb;\s*$/s
  .exec(MIGRATION)![1]!
  .replace(/''/g, "'");

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
const KEYS = Object.keys(FB23_SETTING_DESCRIPTIONS);
const settings = (tx: Tx) =>
  raw<{ key: string; value: unknown; provisional: boolean; description: string }>(
    tx,
    sql`select key, value, provisional, description from app_setting where key in (${sql.join(
      KEYS.map((k) => sql`${k}`),
      sql`, `,
    )}) order by key`,
  );
const lists = (tx: Tx) =>
  raw<{ list_key: string; code: string; meta: unknown; provisional: boolean }>(
    tx,
    sql`select list_key, code, meta, provisional from value_list
        where list_key in ('pack_method', 'pallet_type') order by list_key, sort`,
  );

describe('0053: settings and value lists', () => {
  it('a configured database gets the four settings (provisional) and the two lists; existing rows are kept', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(
        sql`delete from app_setting where key in (${sql.join(
          KEYS.map((k) => sql`${k}`),
          sql`, `,
        )})`,
      );
      await tx.execute(
        sql`delete from value_list where list_key in ('pack_method', 'pallet_type')`,
      );
      await runMigration(tx);
      const rows = await settings(tx);
      expect(rows.map((r) => [r.key, r.provisional])).toEqual([
        ['engineering_cost_defaults', true],
        ['engineering_cost_lines', true],
        ['offer_mold_charge_source', true],
        ['tooling_markup_default_pct', true],
      ]);
      expect(rows.find((r) => r.key === 'tooling_markup_default_pct')?.value).toBe(0);
      expect(rows.find((r) => r.key === 'engineering_cost_defaults')?.value).toEqual({
        freightCompleteMoldUsd: 1500,
        freightLowerBlowMoldUsd: 750,
        startUpAssistanceUsd: 5500,
      });
      for (const r of rows) {
        expect(r.description).toBe(
          FB23_SETTING_DESCRIPTIONS[r.key as keyof typeof FB23_SETTING_DESCRIPTIONS],
        );
      }
      const entries = await lists(tx);
      expect(entries.map((e) => `${e.list_key}:${e.code}`)).toEqual([
        'pack_method:BAGGED',
        'pack_method:CARTON',
        'pack_method:TRAY',
        'pack_method:BULK',
        'pack_method:OTHER',
        'pallet_type:PALLET_40X48',
        'pallet_type:FLOOR_LOADED',
        'pallet_type:OTHER',
      ]);
      expect(entries.every((e) => e.provisional)).toBe(true);
      expect(entries.find((e) => e.code === 'CARTON')?.meta).toEqual({
        countField: 'unitsPerCase',
        container: 'carton',
      });

      // An Admin's markup is kept on a re-run.
      await tx.execute(
        sql`update app_setting set value = '15'::jsonb where key = 'tooling_markup_default_pct'`,
      );
      await runMigration(tx);
      expect((await settings(tx)).find((r) => r.key === 'tooling_markup_default_pct')?.value).toBe(
        15,
      );
      expect(await lists(tx)).toHaveLength(8);
    });
  });

  it('an empty database gets nothing (the seed inserts the same rows)', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`delete from app_setting`);
      await tx.execute(sql`delete from value_list`);
      await runMigration(tx);
      expect(await raw(tx, sql`select 1 from app_setting`)).toHaveLength(0);
      expect(await raw(tx, sql`select 1 from value_list`)).toHaveLength(0);
    });
  });
});

describe('0053: the offer letter lead-time row', () => {
  const template = async (tx: Tx) =>
    (
      await raw<{ value: { templateVersion: string; specifications: { fact: string }[] } }>(
        tx,
        sql`select value from app_setting where key = 'offer_letter_template'`,
      )
    )[0]!.value;

  it('is added where the template is FB-24’s seed, and an edited or approved one is left alone', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(
        sql`update app_setting set value = ${FB24_TEMPLATE}::jsonb, approved_at = null where key = 'offer_letter_template'`,
      );
      await runMigration(tx);
      const v = await template(tx);
      expect(v.templateVersion).toBe('fb23-2026-11-19');
      expect(v.specifications.at(-1)).toEqual({
        fact: 'toolLeadTime',
        label: 'Equipment / tool lead time',
      });
    });
    await rolledBack(async (tx) => {
      const edited = { ...(JSON.parse(FB24_TEMPLATE) as object), title: 'Our offer' };
      await tx.execute(
        sql`update app_setting set value = ${JSON.stringify(edited)}::jsonb where key = 'offer_letter_template'`,
      );
      await runMigration(tx);
      expect((await template(tx)).templateVersion).toBe('fb24-2026-11-19');
    });
    await rolledBack(async (tx) => {
      await tx.execute(
        sql`update app_setting set value = ${FB24_TEMPLATE}::jsonb, approved_at = now() where key = 'offer_letter_template'`,
      );
      await runMigration(tx);
      expect((await template(tx)).templateVersion).toBe('fb24-2026-11-19');
    });
  });
});

describe('0053: eng_cost_line row-level security', () => {
  let ownQuote = { id: '', item: '' };
  let otherQuote = { id: '', item: '' };

  beforeAll(async () => {
    const kamOwner = persona('kam-owner');
    const rows = await raw<{ id: string; kam_user_id: string; item: string }>(
      db as never,
      sql`select q.id, q.kam_user_id, i.id as item from quote q
          join quote_item i on i.quote_id = q.id and i.item_no = 1 order by q.quote_number`,
    );
    const own = rows.find((r) => r.kam_user_id === kamOwner.id)!;
    const other = rows.find((r) => r.kam_user_id !== kamOwner.id)!;
    ownQuote = { id: own.id, item: own.item };
    otherQuote = { id: other.id, item: other.item };
  });

  it('is enabled and forced, with the app, migrator and read-only policies', async () => {
    const [cls] = await raw<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      db as never,
      sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'eng_cost_line'`,
    );
    expect(cls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const policies = await raw<{ policyname: string }>(
      db as never,
      sql`select policyname from pg_policies where tablename = 'eng_cost_line' order by policyname`,
    );
    expect(policies.map((p) => p.policyname)).toEqual([
      'eng_cost_line_app',
      'eng_cost_line_migrator',
      'eng_cost_line_readonly',
    ]);
  });

  it('an owner-scoped KAM sees only their own quote’s lines and cannot add one to another quote', async () => {
    const ids = [uuidv7(), uuidv7()];
    await db.execute(sql`
      insert into eng_cost_line (id, quote_id, quote_item_id, line_key, amount_usd) values
        (${ids[0]}, ${ownQuote.id}, ${ownQuote.item}, 'molds', 100),
        (${ids[1]}, ${otherQuote.id}, ${otherQuote.item}, 'molds', 200)`);
    try {
      await asPersona(db, 'kam-owner', async (tx) => {
        const seen = await raw<{ id: string }>(
          tx,
          sql`select id from eng_cost_line where id in (${ids[0]}, ${ids[1]})`,
        );
        expect(seen.map((r) => r.id)).toEqual([ids[0]]);
      });
      const code = await pgError(
        asPersona(db, 'kam-owner', (tx) =>
          raw(
            tx,
            sql`insert into eng_cost_line (id, quote_id, quote_item_id, line_key, amount_usd)
                values (${uuidv7()}, ${otherQuote.id}, ${otherQuote.item}, 'freight', 1)`,
          ),
        ),
      );
      expect(code).toBe('42501');
    } finally {
      await db.execute(sql`delete from eng_cost_line where id in (${ids[0]}, ${ids[1]})`);
    }
  });
});
