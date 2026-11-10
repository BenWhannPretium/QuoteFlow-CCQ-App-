import { readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { raw, testDb } from './helpers';
import type { Tx } from '../src/client';

/**
 * FB-08 data migration (0038's hand-written config statements) re-run in a rolled-back transaction
 * against the state an environment had before it: no tooling-payment or mold-ownership lists,
 * `g4_required_checks = []`, the FB-01 G4 Advance rule, and none of the three new settings. The schema
 * half and the row-level security of 0038 ran in the global setup.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0038_fb08_terms_final_review.sql', import.meta.url),
  'utf8',
);
const DATA = MIGRATION.slice(MIGRATION.indexOf('-- D-029 (Gemma Cebolla, Nov 6)'));
const statements = DATA.split('--> statement-breakpoint').filter(
  (s) => s.replace(/--.*$/gm, '').trim() !== '',
);

const FB01_RULE = [
  {
    anyOf: [
      { field: 'g4_terms_check_required', op: 'equals', value: false },
      { field: 'terms_checked_at', op: 'present' },
    ],
  },
  {
    anyOf: [
      { field: 'legal_review_required', op: 'equals', value: false },
      { field: 'g4_legal_review_check_required', op: 'equals', value: false },
      { field: 'legal_reviewed_on', op: 'present' },
    ],
  },
];

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

async function toPreFb08State(tx: Tx) {
  await tx.execute(
    sql`delete from value_list where list_key in ('tooling_payment_terms', 'mold_ownership')`,
  );
  await tx.execute(
    sql`update app_setting set value = '[]'::jsonb, approved_at = null where key = 'g4_required_checks'`,
  );
  await tx.execute(
    sql`delete from app_setting where key in ('capital_terms_required', 'g4_additional_approvals', 'default_payment_terms')`,
  );
  await tx.execute(
    sql`update gate_outcome_definition set required_fields = ${JSON.stringify(FB01_RULE)}::jsonb, approved_at = null
        where gate_key = 'G4' and key = 'approve'`,
  );
}

const setting = async (tx: Tx, key: string) =>
  (await raw<{ value: unknown }>(tx, sql`select value from app_setting where key = ${key}`))[0]
    ?.value;
const g4Rule = async (tx: Tx) =>
  (
    await raw<{ required_fields: unknown[] }>(
      tx,
      sql`select required_fields from gate_outcome_definition where gate_key = 'G4' and key = 'approve'`,
    )
  )[0]!.required_fields;

describe('0038 FB-08 data migration', () => {
  it('adds the lists, the two G4 checks, the extended G4 rule and the new settings (extra approval off)', async () => {
    await rolledBack(async (tx) => {
      await toPreFb08State(tx);
      await runMigration(tx);
      const lists = await raw<{
        list_key: string;
        code: string;
        provisional: boolean;
        meta: unknown;
      }>(
        tx,
        sql`select list_key, code, provisional, meta from value_list
            where list_key in ('tooling_payment_terms', 'mold_ownership') order by list_key, sort`,
      );
      expect(lists.map((l) => `${l.list_key}:${l.code}`)).toEqual([
        'mold_ownership:PRETIUM',
        'mold_ownership:CUSTOMER',
        'mold_ownership:SHARED',
        'tooling_payment_terms:UPFRONT',
        'tooling_payment_terms:SPLIT_50_50',
        'tooling_payment_terms:AMORTIZED_PER_PIECE',
      ]);
      expect(lists.every((l) => l.provisional)).toBe(true);
      expect(((await setting(tx, 'g4_required_checks')) as string[]).sort()).toEqual([
        'terms_exception',
        'terms_finalized',
      ]);
      expect((await g4Rule(tx)).length).toBe(4);
      expect(await setting(tx, 'default_payment_terms')).toBe('NET_30');
      const approvals = (await setting(tx, 'g4_additional_approvals')) as {
        rules: { active: boolean }[];
      };
      expect(approvals.rules.map((r) => r.active)).toEqual([false]);
      expect(await setting(tx, 'capital_terms_required')).toHaveLength(5);
    });
  });

  it('keeps what an admin set: other checks, an approved setting, an edited G4 rule', async () => {
    await rolledBack(async (tx) => {
      await toPreFb08State(tx);
      await tx.execute(
        sql`update app_setting set value = '["legal_review"]'::jsonb where key = 'g4_required_checks'`,
      );
      await tx.execute(
        sql`update gate_outcome_definition set required_fields = '[]'::jsonb where gate_key = 'G4' and key = 'approve'`,
      );
      await runMigration(tx);
      expect(((await setting(tx, 'g4_required_checks')) as string[]).sort()).toEqual([
        'legal_review',
        'terms_exception',
        'terms_finalized',
      ]);
      expect(await g4Rule(tx)).toEqual([]);

      await toPreFb08State(tx);
      await tx.execute(
        sql`update app_setting set approved_at = now() where key = 'g4_required_checks'`,
      );
      await runMigration(tx);
      expect(await setting(tx, 'g4_required_checks')).toEqual([]);
    });
  });

  it('is safe to run twice (nothing duplicates)', async () => {
    await rolledBack(async (tx) => {
      await toPreFb08State(tx);
      await runMigration(tx);
      await runMigration(tx);
      expect(((await setting(tx, 'g4_required_checks')) as string[]).length).toBe(2);
      expect((await g4Rule(tx)).length).toBe(4);
      const n = await raw<{ n: number }>(
        tx,
        sql`select count(*)::int as n from value_list where list_key = 'tooling_payment_terms'`,
      );
      expect(n[0]!.n).toBe(3);
    });
  });
});
