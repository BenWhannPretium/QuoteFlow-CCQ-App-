import { readFileSync } from 'node:fs';

import { migrateLegacyNeckFinish } from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { persona, raw, testDb } from './helpers';
import { INTAKE_REQUIRED_FIELDS } from '../seeds/config/settings';
import type { Tx } from '../src/client';

/**
 * FB-02 data migration (0026) on a copy of test data: each block of the migration between its markers
 * is re-run inside a transaction that is rolled back, against rows set up the way an environment
 * before FB-02 has them.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0026_fb02_intake_overhaul.sql', import.meta.url),
  'utf8',
);

function block(name: string): string[] {
  const start = MIGRATION.indexOf(`-- ${name}:start`);
  const end = MIGRATION.indexOf(`-- ${name}:end`);
  expect(start, name).toBeGreaterThan(0);
  return MIGRATION.slice(start, end)
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gm, '').trim() !== '');
}

class Rollback extends Error {}

/** Runs `fn` in a transaction that is always rolled back. */
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

const run = async (tx: Tx, statements: string[]) => {
  for (const s of statements) await tx.execute(sql.raw(s));
};

describe('0026 neck migration (F-010)', () => {
  const LEGACY = ['28-410', '38-400', '89-400', '110-400', '120-DC', '53mm lug', '  24-415 odd  '];

  it('quotes: the SQL splits stored values exactly as migrateLegacyNeckFinish does', async () => {
    await rolledBack(async (tx) => {
      const quotes = await raw<{ id: string }>(
        tx,
        sql`select id from quote order by quote_number limit ${LEGACY.length}`,
      );
      expect(quotes).toHaveLength(LEGACY.length);
      for (const [i, q] of quotes.entries()) {
        await tx.execute(sql`update quote set neck_finish = ${LEGACY[i]!}, neck_diameter = null,
          neck_finish_type = null, neck_finish_type_custom = null where id = ${q.id}`);
      }
      await run(tx, block('neck-migration'));
      for (const [i, q] of quotes.entries()) {
        const [row] = await raw<{
          neck_diameter: string | null;
          neck_finish_type: string | null;
          neck_finish_type_custom: string | null;
          neck_finish: string;
        }>(
          tx,
          sql`select neck_diameter, neck_finish_type, neck_finish_type_custom, neck_finish from quote where id = ${q.id}`,
        );
        const want = migrateLegacyNeckFinish(LEGACY[i]);
        expect([row!.neck_diameter, row!.neck_finish_type, row!.neck_finish_type_custom]).toEqual([
          want.neckDiameter,
          want.neckFinishType,
          want.neckFinishTypeCustom,
        ]);
        expect(row!.neck_finish).toBe(LEGACY[i]); // deprecated, kept
      }
    });
  });

  it('open drafts move to the three-list keys; submitted drafts are left as history', async () => {
    await rolledBack(async (tx) => {
      const kam = persona('kam');
      const [quote] = await raw<{ id: string }>(tx, sql`select id from quote limit 1`);
      const insert = async (data: object, submitted = false) => {
        const [row] = await raw<{ id: string }>(
          tx,
          sql`insert into quote_draft (id, owner_user_id, step, data, submitted_at, submitted_quote_id)
              values (gen_random_uuid(), ${kam.id}, 3, ${JSON.stringify(data)}::jsonb,
                      ${submitted ? sql`now()` : sql`null`}, ${submitted ? quote!.id : null})
              returning id`,
        );
        return row!.id;
      };
      const split = await insert({ neckFinish: '38-400', resin: 'HDPE' });
      const other = await insert({ neckFinish: 'OTHER', neckFinishOther: 'Lug 53' });
      const dc = await insert({ neckFinish: '120-DC' });
      const history = await insert({ neckFinish: '28-410' }, true);
      await run(tx, block('neck-migration'));
      const data = async (id: string) =>
        (
          await raw<{ data: Record<string, unknown> }>(
            tx,
            sql`select data from quote_draft where id = ${id}`,
          )
        )[0]!.data;
      expect(await data(split)).toEqual({
        resin: 'HDPE',
        neckDiameter: '38',
        neckFinishType: '400',
      });
      expect(await data(other)).toEqual({
        neckFinishType: 'CUSTOM',
        neckFinishTypeCustom: 'Lug 53',
      });
      expect(await data(dc)).toEqual({
        neckDiameter: '120',
        neckFinishType: 'CUSTOM',
        neckFinishTypeCustom: 'DC',
      });
      expect(await data(history)).toEqual({ neckFinish: '28-410' });
    });
  });
});

describe('0026 config migration (F-009, F-017)', () => {
  const OLD_REQUIRED = [
    { field: 'sf_opportunity_id', op: 'present' },
    { field: 'customer.name', op: 'present' },
    {
      anyOf: [
        { field: 'ship_to.line1', op: 'present' },
        { field: 'ship_to.city', op: 'present' },
      ],
    },
    { field: 'product_family', op: 'present' },
    { field: 'resin', op: 'present' },
    { field: 'est_annual_volume', op: 'present' },
  ];

  it('intake_required_fields: the pre-FB-02 seed becomes the FB-02 seed; an admin addition is kept', async () => {
    await rolledBack(async (tx) => {
      const adminRule = { field: 'market', op: 'present' };
      await tx.execute(
        sql`update app_setting set value = ${JSON.stringify([...OLD_REQUIRED, adminRule])}::jsonb
            where key = 'intake_required_fields'`,
      );
      await run(tx, block('fb02-config'));
      await run(tx, block('fb02-config')); // idempotent
      const [row] = await raw<{ value: unknown[] }>(
        tx,
        sql`select value from app_setting where key = 'intake_required_fields'`,
      );
      expect(row!.value).toEqual(
        expect.arrayContaining([...INTAKE_REQUIRED_FIELDS, adminRule] as unknown[]),
      );
      expect(row!.value).toHaveLength(INTAKE_REQUIRED_FIELDS.length + 1);
    });
  });

  it('G1 Advance and Submit need the need-by dates (once)', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`update gate_outcome_definition
        set required_fields = (select coalesce(jsonb_agg(e), '[]') from jsonb_array_elements(required_fields) e
                               where e->>'field' not in ('quote_needed_by', 'product_needed_by'))
        where (gate_key, key) in (('G1', 'advance'), ('SUBMIT', 'submit'))`);
      await run(tx, block('fb02-config'));
      await run(tx, block('fb02-config'));
      const rows = await raw<{ gate_key: string; fields: string[] }>(
        tx,
        sql`select gate_key, array(select e->>'field' from jsonb_array_elements(required_fields) e) as fields
            from gate_outcome_definition where (gate_key, key) in (('G1', 'advance'), ('SUBMIT', 'submit'))`,
      );
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        expect(r.fields.filter((f) => f === 'quote_needed_by')).toHaveLength(1);
        expect(r.fields.filter((f) => f === 'product_needed_by')).toHaveLength(1);
      }
    });
  });

  it('scoring: a model reading the close date gets a successor that reads Quote needed by', async () => {
    await rolledBack(async (tx) => {
      // As before FB-02: only v1 (timing = days_to_close) is in effect.
      await tx.execute(sql`delete from scoring_model where model_version > 1`);
      await run(tx, block('fb02-config'));
      await run(tx, block('fb02-config')); // the second run finds the new model and does nothing
      const models = await raw<{
        model_version: number;
        timing: { input: string; label: string; weight: number; bands: unknown };
        v1_timing: { weight: number; bands: unknown };
      }>(
        tx,
        sql`select m.model_version,
              (select a from jsonb_array_elements(m.attributes) a where a->>'key' = 'timing') as timing,
              (select a from scoring_model v1, jsonb_array_elements(v1.attributes) a
                where v1.model_version = 1 and a->>'key' = 'timing') as v1_timing
            from scoring_model m order by m.model_version`,
      );
      expect(models.map((m) => m.model_version)).toEqual([1, 2]);
      expect(models[1]!.timing.input).toBe('days_to_quote_needed');
      expect(models[1]!.timing.weight).toBe(models[1]!.v1_timing.weight);
      expect(models[1]!.timing.bands).toEqual(models[1]!.v1_timing.bands);
    });
  });
});
