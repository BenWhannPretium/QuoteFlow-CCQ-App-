import { readFileSync } from 'node:fs';

import { MODEL_SUMMARY_LIMITS_SEED, MODEL_SUMMARY_TEMPLATES_SEED, hybridConfig } from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { raw, testDb } from './helpers';
import type { Tx } from '../src/client';

/**
 * FB-14 data migration (0042's hand-written statements) re-run in a rolled-back transaction against the
 * state an environment had before it: no model-summary settings, and the FB-07 "ROI" wording on the G3
 * help and the roi_required_when description. The schema half of 0042 ran in the global setup.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0042_fb14_model_summary.sql', import.meta.url),
  'utf8',
);
const DATA = MIGRATION.slice(MIGRATION.indexOf('-- ── FB-14 (hand-written)'));
// RLS and grants are DDL already applied by the global setup; re-run only the data statements.
const statements = DATA.split('--> statement-breakpoint').filter((s) => {
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

const G3_HELP = hybridConfig.outcomes.find(
  (x) => x.gateKey === 'G3' && x.key === 'submit',
)!.helpText!;
const OLD_HELP = G3_HELP.replace(
  'the payback model is on file too.',
  'the ROI model is on file too.',
);

async function toPreFb14State(tx: Tx) {
  await tx.execute(
    sql`delete from app_setting where key in ('model_summary_templates', 'model_summary_visible', 'model_summary_limits')`,
  );
  await tx.execute(
    sql`update gate_outcome_definition set help_text = ${OLD_HELP}, approved_at = null
        where gate_key = 'G3' and key = 'submit'`,
  );
  await tx.execute(
    sql`update app_setting set description = replace(description, ${`needs Finance's payback model (roi_model; "Payback" since FB-14) before`}, ${`needs Finance's ROI model before`}), version = 1, approved_at = null
        where key = 'roi_required_when'`,
  );
}

const settings = (tx: Tx) =>
  raw<{ key: string; value: unknown; provisional: boolean }>(
    tx,
    sql`select key, value, provisional from app_setting where key in ('model_summary_templates', 'model_summary_visible', 'model_summary_limits') order by key`,
  );

describe('0042 FB-14 data migration', () => {
  it('has the statements it is meant to have', () => {
    expect(statements).toHaveLength(3);
    expect(MIGRATION).toMatch(
      /REVOKE UPDATE, DELETE, TRUNCATE ON "model_summary", "model_summary_field" FROM ccq_app/,
    );
  });

  it('adds the three settings exactly as the seed, provisional, and says "payback model"', async () => {
    await rolledBack(async (tx) => {
      await toPreFb14State(tx);
      expect(await settings(tx)).toEqual([]);
      await runMigration(tx);
      expect(await settings(tx)).toEqual([
        { key: 'model_summary_limits', value: MODEL_SUMMARY_LIMITS_SEED, provisional: true },
        {
          key: 'model_summary_templates',
          value: JSON.parse(JSON.stringify(MODEL_SUMMARY_TEMPLATES_SEED)) as unknown,
          provisional: true,
        },
        { key: 'model_summary_visible', value: true, provisional: true },
      ]);
      const [o] = await raw<{ help_text: string }>(
        tx,
        sql`select help_text from gate_outcome_definition where gate_key = 'G3' and key = 'submit'`,
      );
      expect(o!.help_text).toBe(G3_HELP);
      const [d] = await raw<{ description: string }>(
        tx,
        sql`select description from app_setting where key = 'roi_required_when'`,
      );
      expect(d!.description).toContain(
        `needs Finance's payback model (roi_model; "Payback" since FB-14) before`,
      );
      // Idempotent.
      await runMigration(tx);
      expect(await settings(tx)).toHaveLength(3);
    });
  });

  it('leaves an approved or admin-edited row, and an existing setting, alone', async () => {
    await rolledBack(async (tx) => {
      await toPreFb14State(tx);
      await tx.execute(
        sql`update gate_outcome_definition set help_text = 'Our own words about the ROI model.'
            where gate_key = 'G3' and key = 'submit'`,
      );
      await tx.execute(sql`update app_setting set version = 2 where key = 'roi_required_when'`);
      await tx.execute(
        sql`insert into app_setting (id, key, value, description, provisional)
            values (gen_random_uuid(), 'model_summary_visible', 'false'::jsonb, 'set by an Admin', false)`,
      );
      await runMigration(tx);
      const [o] = await raw<{ help_text: string }>(
        tx,
        sql`select help_text from gate_outcome_definition where gate_key = 'G3' and key = 'submit'`,
      );
      expect(o!.help_text).toBe('Our own words about the ROI model.');
      const [d] = await raw<{ description: string }>(
        tx,
        sql`select description from app_setting where key = 'roi_required_when'`,
      );
      expect(d!.description).toContain(`needs Finance's ROI model before`);
      const [v] = await raw<{ value: unknown }>(
        tx,
        sql`select value from app_setting where key = 'model_summary_visible'`,
      );
      expect(v!.value).toBe(false);
    });
  });

  it('is a no-op on an empty config (the seed inserts the same values)', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`delete from app_setting`);
      await runMigration(tx);
      expect(await raw(tx, sql`select 1 from app_setting`)).toHaveLength(0);
    });
  });
});
