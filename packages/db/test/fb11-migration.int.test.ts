import { readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { raw, testDb } from './helpers';
import type { Tx } from '../src/client';

/**
 * FB-11 data migration (0032's hand-written statements) re-run in a rolled-back transaction against the
 * state an environment had before it: no intake commercial-input lists, no "Not discussed" funding value,
 * no standard_payment_terms setting, no tax hint on the funding options and no help text for the new
 * fields. The schema half of 0032 ran in the global setup.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0032_fb11_intake_commercial_inputs.sql', import.meta.url),
  'utf8',
);
const DATA = MIGRATION.slice(MIGRATION.indexOf('-- FB-11 (Intake commercial inputs'));
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

const NEW_HELP_KEYS = [
  'requested_payment_terms',
  'requested_payment_terms_other',
  'tooling_funding_model',
  'tooling_funding_tax_hint',
  'returnable_dunnage',
  'price_basis',
  'freight_type',
  'freight_special_arrangements',
  'bid_reference',
];

async function toPreFb11State(tx: Tx) {
  await tx.execute(
    sql`delete from value_list where list_key in ('requested_payment_terms', 'price_basis', 'freight_type')
        or (list_key = 'tooling_funding_model' and code = 'NOT_DISCUSSED')`,
  );
  await tx.execute(
    sql`update value_list set meta = meta - 'taxHint' where list_key = 'tooling_funding_model'`,
  );
  await tx.execute(sql`delete from app_setting where key = 'standard_payment_terms'`);
  for (const key of NEW_HELP_KEYS) {
    await tx.execute(
      sql`update app_setting set value = value - ${key}::text where key = 'intake_field_help'`,
    );
  }
}

describe('0032 FB-11 data migration', () => {
  it('adds the three lists, the "Not discussed" funding value and the tax hint (provisional)', async () => {
    await rolledBack(async (tx) => {
      await toPreFb11State(tx);
      await runMigration(tx);
      const rows = await raw<{
        list_key: string;
        code: string;
        label: string;
        active: boolean;
        provisional: boolean;
        meta: Record<string, unknown>;
      }>(
        tx,
        sql`select list_key, code, label, active, provisional, meta from value_list
            where list_key in ('requested_payment_terms', 'price_basis', 'freight_type', 'tooling_funding_model')
            order by list_key, sort`,
      );
      const codes = (list: string) => rows.filter((r) => r.list_key === list).map((r) => r.code);
      expect(codes('requested_payment_terms')).toEqual([
        'NET_15',
        'NET_30',
        'NET_45',
        'NET_60',
        'NET_90',
        'NET_120',
        'OTHER',
      ]);
      expect(codes('price_basis')).toEqual(['FOB_PLANT', 'DELIVERED']);
      expect(codes('freight_type')).toEqual(['FLATBED', 'VAN', 'DROP_TRAILER', 'T_BAR', 'OTHER']);
      expect(codes('tooling_funding_model')).toEqual([
        'COMPANY_FUNDED',
        'CUSTOMER_FUNDED',
        'ZERO_CER',
        'AMORTIZED',
        'SHARED',
        'NOT_DISCUSSED',
      ]);
      expect(rows.every((r) => r.active)).toBe(true);
      const by = (list: string, code: string) =>
        rows.find((r) => r.list_key === list && r.code === code)!;
      expect(by('requested_payment_terms', 'OTHER').meta).toEqual({ freeText: true });
      expect(by('price_basis', 'DELIVERED').meta).toEqual({ delivered: true });
      expect(by('tooling_funding_model', 'NOT_DISCUSSED')).toMatchObject({
        label: 'Not discussed',
        provisional: true,
      });
      expect(by('tooling_funding_model', 'NOT_DISCUSSED').meta.defaultAtIntake).toBe(true);
      for (const code of ['CUSTOMER_FUNDED', 'ZERO_CER', 'AMORTIZED', 'SHARED']) {
        expect(by('tooling_funding_model', code).meta.taxHint).toBe(true);
      }
      expect(by('tooling_funding_model', 'COMPANY_FUNDED').meta.taxHint).toBeUndefined();
      // The FB-04 help text on $0 CER survives the meta merge.
      expect(typeof by('tooling_funding_model', 'ZERO_CER').meta.helpText).toBe('string');
    });
  });

  it('seeds standard_payment_terms as provisional, and keeps an Admin-edited value', async () => {
    await rolledBack(async (tx) => {
      await toPreFb11State(tx);
      await runMigration(tx);
      const [seeded] = await raw<{ value: unknown; provisional: boolean }>(
        tx,
        sql`select value, provisional from app_setting where key = 'standard_payment_terms'`,
      );
      expect(seeded).toMatchObject({ value: ['NET_15', 'NET_30'], provisional: true });
    });
    await rolledBack(async (tx) => {
      await toPreFb11State(tx);
      await tx.execute(
        sql`insert into app_setting (id, key, value, description, provisional)
            values (gen_random_uuid(), 'standard_payment_terms', '["NET_30"]'::jsonb, 'admin', false)`,
      );
      await runMigration(tx);
      const [kept] = await raw<{ value: unknown; provisional: boolean }>(
        tx,
        sql`select value, provisional from app_setting where key = 'standard_payment_terms'`,
      );
      expect(kept).toMatchObject({ value: ['NET_30'], provisional: false });
    });
  });

  it('adds the "why we ask" help and keeps an Admin-edited line', async () => {
    await rolledBack(async (tx) => {
      await toPreFb11State(tx);
      await tx.execute(
        sql`update app_setting set value = value || '{"bid_reference":"Our own wording."}'::jsonb
            where key = 'intake_field_help'`,
      );
      await runMigration(tx);
      const [row] = await raw<{ value: Record<string, string> }>(
        tx,
        sql`select value from app_setting where key = 'intake_field_help'`,
      );
      for (const key of NEW_HELP_KEYS) expect(typeof row!.value[key]).toBe('string');
      expect(row!.value.bid_reference).toBe('Our own wording.');
    });
  });

  it('is safe to run twice (no duplicate rows)', async () => {
    await rolledBack(async (tx) => {
      await toPreFb11State(tx);
      await runMigration(tx);
      await runMigration(tx);
      const [n] = await raw<{ n: number }>(
        tx,
        sql`select count(*)::int as n from value_list
            where list_key in ('requested_payment_terms', 'price_basis', 'freight_type')`,
      );
      expect(n!.n).toBe(14);
    });
  });
});
