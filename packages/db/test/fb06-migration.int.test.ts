import { readFileSync } from 'node:fs';

import { ASSIGNMENT_RULES_SEED } from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { raw, testDb } from './helpers';
import type { Tx } from '../src/client';

/**
 * FB-06 data migration (0033's hand-written statements) re-run in a rolled-back transaction against the
 * state an environment had before it: the G2 "Capital required" rule without the equipment BOM, the
 * earlier help text and no `engineering_assignment_rules` setting. The schema half of 0033 ran in the
 * global setup.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0033_fb06_engineering_bom_two_step.sql', import.meta.url),
  'utf8',
);
const DATA = MIGRATION.slice(MIGRATION.indexOf('-- ── FB-06 (hand-written)'));
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

const BEFORE_RULE = [
  { op: 'present', field: 'prelim_capital_usd' },
  { op: 'equals', field: 'capacity_signoff_status', value: 'approved' },
];
const BOM_RULE = { op: 'equals', field: 'equipment_bom_on_file', value: true };
const BEFORE_HELP =
  'Feasible, but capital is needed. Record the budgetary capital estimate (preliminary, includes contingency); Pricing then confirms capital readiness before any price is released.';

const capitalRow = (tx: Tx) =>
  raw<{ required_fields: unknown[]; help_text: string }>(
    tx,
    sql`select required_fields, help_text from gate_outcome_definition
        where gate_key = 'G2' and key = 'capital_required'`,
  ).then((r) => r[0]!);

async function toPreFb06State(tx: Tx) {
  await tx.execute(
    sql`update gate_outcome_definition
        set required_fields = ${JSON.stringify(BEFORE_RULE)}::jsonb, help_text = ${BEFORE_HELP}, approved_at = null
        where gate_key = 'G2' and key = 'capital_required'`,
  );
  await tx.execute(sql`delete from app_setting where key = 'engineering_assignment_rules'`);
}

describe('0033 FB-06 data migration', () => {
  it('adds the equipment BOM rule and help text to the G2 capital rule as seeded', async () => {
    await rolledBack(async (tx) => {
      await toPreFb06State(tx);
      await runMigration(tx);
      const row = await capitalRow(tx);
      expect(row.required_fields).toEqual([...BEFORE_RULE, BOM_RULE]);
      expect(row.help_text).toContain('upload the equipment BOM; Pricing then confirms');
    });
  });

  it('is idempotent: a second run adds nothing', async () => {
    await rolledBack(async (tx) => {
      await toPreFb06State(tx);
      await runMigration(tx);
      const once = await capitalRow(tx);
      await runMigration(tx);
      expect(await capitalRow(tx)).toEqual(once);
    });
  });

  it('leaves a rule an admin changed, and a row the business approved, alone', async () => {
    await rolledBack(async (tx) => {
      await toPreFb06State(tx);
      const edited = [BEFORE_RULE[0]];
      await tx.execute(
        sql`update gate_outcome_definition
            set required_fields = ${JSON.stringify(edited)}::jsonb, help_text = 'Admin wording'
            where gate_key = 'G2' and key = 'capital_required'`,
      );
      await runMigration(tx);
      const row = await capitalRow(tx);
      expect(row.required_fields).toEqual(edited);
      expect(row.help_text).toBe('Admin wording');
    });
    await rolledBack(async (tx) => {
      await toPreFb06State(tx);
      await tx.execute(
        sql`update gate_outcome_definition set approved_at = now()
            where gate_key = 'G2' and key = 'capital_required'`,
      );
      await runMigration(tx);
      const row = await capitalRow(tx);
      expect(row.required_fields).toEqual(BEFORE_RULE);
      expect(row.help_text).toBe(BEFORE_HELP);
    });
  });

  it('seeds the routing suggestions (provisional), the same value as the seed file', async () => {
    await rolledBack(async (tx) => {
      await toPreFb06State(tx);
      await runMigration(tx);
      const [setting] = await raw<{ value: unknown; provisional: boolean }>(
        tx,
        sql`select value, provisional from app_setting where key = 'engineering_assignment_rules'`,
      );
      expect(setting!.provisional).toBe(true);
      // Migration 0033 seeds the FB-06 value; FB-09 (0036) later removes the retired resin codes from it.
      const fb06 = ASSIGNMENT_RULES_SEED.rules.map((r, i) =>
        i === 2
          ? { ...r, resins: ['PET', 'PCR_PET', 'PETG'] }
          : i === 3
            ? { ...r, resins: ['HDPE', 'PCR_HDPE', 'PP', 'LDPE'] }
            : r,
      );
      expect(setting!.value).toEqual({ rules: fb06 });
    });
  });

  it('keeps a setting an admin already changed', async () => {
    await rolledBack(async (tx) => {
      await toPreFb06State(tx);
      await tx.execute(
        sql`insert into app_setting (id, key, value, description, provisional)
            values (gen_random_uuid(), 'engineering_assignment_rules', '{"rules":[]}'::jsonb, 'x', false)`,
      );
      await runMigration(tx);
      const [setting] = await raw<{ value: unknown }>(
        tx,
        sql`select value from app_setting where key = 'engineering_assignment_rules'`,
      );
      expect(setting!.value).toEqual({ rules: [] });
    });
  });
});

describe('FB-06 schema', () => {
  const anyReview = (tx: Tx) =>
    raw<{ quote_id: string }>(tx, sql`select quote_id from eng_review limit 1`).then((r) => r[0]!);

  it('two-step defaults to off and every detail and pack-out column starts empty', async () => {
    await rolledBack(async (tx) => {
      const [r] = await raw<Record<string, unknown>>(
        tx,
        sql`select two_step, preform_plant_code, blow_plant_code, preform_number, two_step_freight_note,
                   units_per_bag, units_per_tray, units_per_case, units_per_pallet
            from eng_review limit 1`,
      );
      expect(r).toMatchObject({
        two_step: false,
        preform_plant_code: null,
        blow_plant_code: null,
        preform_number: null,
        two_step_freight_note: null,
        units_per_bag: null,
        units_per_tray: null,
        units_per_case: null,
        units_per_pallet: null,
      });
    });
  });

  it('pack-out counts are whole numbers from 1 to 9,999,999', async () => {
    for (const bad of [0, -3, 10_000_000]) {
      await rolledBack(async (tx) => {
        const { quote_id } = await anyReview(tx);
        await expect(
          tx.execute(
            sql`update eng_review set units_per_case = ${bad} where quote_id = ${quote_id}`,
          ),
        ).rejects.toThrow();
      });
    }
    await rolledBack(async (tx) => {
      const { quote_id } = await anyReview(tx);
      await tx.execute(
        sql`update eng_review set units_per_bag = 1, units_per_tray = 12, units_per_case = 48,
                   units_per_pallet = 9999999 where quote_id = ${quote_id}`,
      );
    });
  });

  it('the equipment BOM is a versioned kind: it needs a version and has one current version', async () => {
    await rolledBack(async (tx) => {
      const [m] = await raw<{ quote_id: string; uploaded_by: string }>(
        tx,
        sql`select quote_id, uploaded_by from attachment where quote_id is not null limit 1`,
      );
      await expect(
        tx.execute(
          sql`insert into attachment (id, quote_id, kind, file_name, size, mime, uploaded_by)
              values (gen_random_uuid(), ${m!.quote_id}, 'equipment_bom', 'b.xlsx', 0, 'x', ${m!.uploaded_by})`,
        ),
      ).rejects.toThrow();
    });
    await rolledBack(async (tx) => {
      const [m] = await raw<{ quote_id: string; uploaded_by: string }>(
        tx,
        sql`select quote_id, uploaded_by from attachment where quote_id is not null limit 1`,
      );
      await tx.execute(
        sql`insert into attachment (id, quote_id, kind, file_name, size, mime, uploaded_by, version)
            values (gen_random_uuid(), ${m!.quote_id}, 'equipment_bom', 'b1.xlsx', 0, 'x', ${m!.uploaded_by}, 1)`,
      );
      await expect(
        tx.execute(
          sql`insert into attachment (id, quote_id, kind, file_name, size, mime, uploaded_by, version)
              values (gen_random_uuid(), ${m!.quote_id}, 'equipment_bom', 'b2.xlsx', 0, 'x', ${m!.uploaded_by}, 2)`,
        ),
      ).rejects.toThrow();
    });
  });

  it('the synthetic data gives every quote that went to G2 "Capital required" a current BOM', async () => {
    await rolledBack(async (tx) => {
      const rows = await raw<{ quote_number: string }>(
        tx,
        sql`select q.quote_number from quote q
            join gate_decision d on d.quote_id = q.id and d.gate_key = 'G2' and d.outcome_key = 'capital_required'
            where not exists (
              select 1 from attachment a
              where a.quote_id = q.id and a.kind = 'equipment_bom'
                and a.superseded_at is null and a.removed_at is null
            )`,
      );
      expect(rows).toEqual([]);
    });
  });
});
