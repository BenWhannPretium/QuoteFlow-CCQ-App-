import { readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { testDb } from './helpers';
import type { Tx } from '../src/client';

/**
 * FB-15 data migration (0044's hand-written statements) re-run in a rolled-back transaction against the
 * state an environment had before it. The schema half of 0044 ran in the global setup (with the seed).
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0044_fb15_intake_fixes.sql', import.meta.url),
  'utf8',
);
const DATA = MIGRATION.slice(MIGRATION.indexOf('-- FB-15 (walkthrough'));
const statements = DATA.split('--> statement-breakpoint').filter(
  (s) => s.replace(/--.*$/gm, '').trim() !== '',
);

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

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute(q)) as unknown as T[];

const OLD_REQUIRED = [
  { field: 'sf_opportunity_id', op: 'present' },
  { field: 'product_family', op: 'present' },
];
const OLD_HELP = {
  bid_reference:
    'The customer’s bid, RFP or program name or number, if it has one. A plain reference: it does not link quotes.',
  sub_market: 'Pick the closest sub-market. It sets the strategic-fit score.',
  // An Admin's own wording is kept.
  color_type: 'Admin wording for color.',
};

/** The pre-FB-15 state: flags absent, the new rows and settings missing, help text as seeded before. */
async function preFb15(tx: Tx, opts: { productFamilyApproved: boolean }) {
  await tx.execute(sql`
    UPDATE app_setting SET value = ${JSON.stringify(OLD_REQUIRED)}::jsonb
    WHERE key = 'intake_required_fields'`);
  await tx.execute(sql`
    UPDATE app_setting SET value = ${JSON.stringify(OLD_HELP)}::jsonb WHERE key = 'intake_field_help'`);
  await tx.execute(sql`
    UPDATE value_list SET meta = meta - 'freeText', version = 1
    WHERE code = 'OTHER' AND list_key IN ('product_family', 'component', 'decoration_type', 'freight_type')`);
  await tx.execute(sql`
    UPDATE value_list SET meta = (meta - 'customerShare') || jsonb_build_object('helpText',
      'Pretium and the customer each pay part. Record the agreed split in the terms notes.')
    WHERE list_key = 'tooling_funding_model' AND code = 'SHARED'`);
  await tx.execute(sql`
    DELETE FROM value_list WHERE (list_key, code) IN
      (('color_type', 'STOCK_WHITE'), ('color_type', 'STOCK_BLACK'), ('additive', 'FLUORINATION'))`);
  await tx.execute(sql`
    DELETE FROM app_setting WHERE key IN ('intake_other_description_max_length', 'customer_master_data_notice')`);
  await tx.execute(
    opts.productFamilyApproved
      ? sql`UPDATE value_list SET provisional = false, approved_at = '2026-11-09T00:00:00Z', label = 'Other'
            WHERE list_key = 'product_family'`
      : sql`UPDATE value_list SET approved_at = null WHERE list_key = 'product_family'`,
  );
}

describe('migration 0044 (FB-15 intake fixes)', () => {
  it('appends Market and Sub-market to the required fields and keeps the other rules', async () => {
    await rolledBack(async (tx) => {
      await preFb15(tx, { productFamilyApproved: true });
      await runMigration(tx);
      await runMigration(tx); // idempotent
      const [setting] = await rows<{ value: { field: string }[] }>(
        tx,
        sql`SELECT value FROM app_setting WHERE key = 'intake_required_fields'`,
      );
      expect(setting!.value.map((r) => r.field)).toEqual([
        'sf_opportunity_id',
        'product_family',
        'market',
        'sub_market',
      ]);
    });
  });

  it('adds only the freeText flag to the approved product family Other and leaves its approval alone', async () => {
    await rolledBack(async (tx) => {
      await preFb15(tx, { productFamilyApproved: true });
      await runMigration(tx);
      const others = await rows<{
        list_key: string;
        label: string;
        meta: Record<string, unknown>;
        approved_at: Date | null;
        provisional: boolean;
      }>(
        tx,
        sql`SELECT list_key, label, meta, approved_at, provisional FROM value_list
            WHERE code = 'OTHER' AND list_key IN ('product_family', 'component', 'decoration_type', 'freight_type')
            ORDER BY list_key`,
      );
      expect(others.map((o) => [o.list_key, o.meta.freeText])).toEqual([
        ['component', true],
        ['decoration_type', true],
        ['freight_type', true],
        ['product_family', true],
      ]);
      const family = others.find((o) => o.list_key === 'product_family')!;
      expect(family.approved_at).not.toBeNull();
      expect(family.provisional).toBe(false);
      expect(family.label).toBe('Other');
    });
  });

  it('adds the stock colors, Fluorination and the shared-funding flag; keeps an Admin help text', async () => {
    await rolledBack(async (tx) => {
      await preFb15(tx, { productFamilyApproved: false });
      await runMigration(tx);
      await runMigration(tx);
      const added = await rows<{
        list_key: string;
        code: string;
        provisional: boolean;
        meta: unknown;
      }>(
        tx,
        sql`SELECT list_key, code, provisional, meta FROM value_list
            WHERE code IN ('STOCK_WHITE', 'STOCK_BLACK', 'FLUORINATION') ORDER BY code`,
      );
      expect(added).toEqual([
        { list_key: 'additive', code: 'FLUORINATION', provisional: true, meta: {} },
        {
          list_key: 'color_type',
          code: 'STOCK_BLACK',
          provisional: true,
          meta: { resins: ['HDPE', 'PP'] },
        },
        {
          list_key: 'color_type',
          code: 'STOCK_WHITE',
          provisional: true,
          meta: { resins: ['HDPE', 'PP'] },
        },
      ]);
      const [shared] = await rows<{ meta: Record<string, unknown> }>(
        tx,
        sql`SELECT meta FROM value_list WHERE list_key = 'tooling_funding_model' AND code = 'SHARED'`,
      );
      expect(shared!.meta.customerShare).toBe(true);
      expect(shared!.meta.helpText).toContain('Pretium covers the rest');

      const [help] = await rows<{ value: Record<string, string> }>(
        tx,
        sql`SELECT value FROM app_setting WHERE key = 'intake_field_help'`,
      );
      expect(help!.value.bid_reference).toBe(
        "Most customers don't send one. Leave it blank if not.",
      );
      expect(help!.value.sub_market).toContain('Midas calls it Alcoholic');
      expect(help!.value.color_type).toBe('Admin wording for color.');
      expect(help!.value.product_family_other).toContain('Other');

      const settings = await rows<{ key: string; value: unknown; provisional: boolean }>(
        tx,
        sql`SELECT key, value, provisional FROM app_setting
            WHERE key IN ('intake_other_description_max_length', 'customer_master_data_notice') ORDER BY key`,
      );
      expect(settings.map((s) => [s.key, s.provisional])).toEqual([
        ['customer_master_data_notice', true],
        ['intake_other_description_max_length', true],
      ]);
      expect(settings[1]!.value).toBe(200);
    });
  });
});
