import { readFileSync } from 'node:fs';

import { hybridConfig } from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { G3_HELP_0042, G3_HELP_0050, G3_RULES_0049, G3_RULES_0050 } from './g3-rules-history';
import { raw, testDb } from './helpers';
import { ROI_REQUIRED_WHEN_DESCRIPTION } from '../seeds/config/settings';
import type { Tx } from '../src/client';

/**
 * FB-21 Part B (0050): a payback model only when someone asks Finance for one.
 *
 * - The schema half (the six payback columns and their check) ran in the global setup.
 * - The hand-written half re-run in a rolled-back transaction from the state 0049 left: the two
 *   `payback.request` grants, the G3 rule and help text, the `roi_required_when` description. A row
 *   the business approved or an Admin edited is left alone; an empty database gets nothing.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0050_fb21_payback_request.sql', import.meta.url),
  'utf8',
);
const DATA = MIGRATION.slice(MIGRATION.indexOf('-- ── FB-21 Part B (hand-written)'));
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

const OLD_DESCRIPTION =
  'FB-07 (D-001): when a quote needs Finance\'s payback model (roi_model; "Payback" since FB-14) before the pricing lead approves the price (G3). Any of: Engineering\'s latest G2 outcome is in g2Outcomes, the quote is flagged capital likely (capitalLikely), or the tooling funding model is in fundingModels. Seed: capital required, $0 CER included. Provisional.';

async function g3(tx: Tx) {
  const [row] = await raw<{ required_fields: unknown; help_text: string }>(
    tx,
    sql`select required_fields, help_text from gate_outcome_definition
        where gate_key = 'G3' and key = 'submit'`,
  );
  return row!;
}
async function grants(tx: Tx) {
  return raw<{ role: string; qualifier: unknown; provisional: boolean }>(
    tx,
    sql`select role, qualifier, provisional from role_permission
        where permission = 'payback.request' order by role`,
  );
}
const description = async (tx: Tx) =>
  (
    await raw<{ description: string }>(
      tx,
      sql`select description from app_setting where key = 'roi_required_when'`,
    )
  )[0]?.description;

/** Before FB-21 Part B: no grants, the 0049 rule, the 0042 help text and description. */
async function prePartB(tx: Tx) {
  await tx.execute(sql`delete from role_permission where permission = 'payback.request'`);
  await tx.execute(sql`
    update gate_outcome_definition
    set required_fields = ${JSON.stringify(G3_RULES_0049)}::jsonb, help_text = ${G3_HELP_0042},
      approved_at = null, version = 1
    where gate_key = 'G3' and key = 'submit'`);
  await tx.execute(sql`
    update app_setting set description = ${OLD_DESCRIPTION}, approved_at = null, version = 1
    where key = 'roi_required_when'`);
}

describe('migration 0050 (FB-21 Part B): payback on request', () => {
  it('the seed is what 0050 writes', () => {
    const seeded = hybridConfig.outcomes.find((o) => o.gateKey === 'G3' && o.key === 'submit')!;
    expect(seeded.requiredFields).toEqual(G3_RULES_0050);
    expect(seeded.helpText).toBe(G3_HELP_0050);
    expect(statements).toHaveLength(4);
  });

  it('brings an untouched environment to the seed; safe to run twice', async () => {
    await rolledBack(async (tx) => {
      await prePartB(tx);
      await runMigration(tx);
      await runMigration(tx);
      expect(await g3(tx)).toEqual({ required_fields: G3_RULES_0050, help_text: G3_HELP_0050 });
      expect(await grants(tx)).toEqual([
        { role: 'Pricing', qualifier: { kind: 'assignedPricer' }, provisional: true },
        { role: 'PricingLead', qualifier: null, provisional: true },
      ]);
      expect(await description(tx)).toBe(ROI_REQUIRED_WHEN_DESCRIPTION);
    });
  });

  it('leaves an approved or Admin-edited rule, help text and description alone', async () => {
    await rolledBack(async (tx) => {
      await prePartB(tx);
      await tx.execute(sql`
        update gate_outcome_definition set approved_at = now()
        where gate_key = 'G3' and key = 'submit'`);
      await tx.execute(sql`update app_setting set version = 2 where key = 'roi_required_when'`);
      await runMigration(tx);
      expect(await g3(tx)).toEqual({ required_fields: G3_RULES_0049, help_text: G3_HELP_0042 });
      expect(await description(tx)).toBe(OLD_DESCRIPTION);
    });
  });

  it('on an empty database: inserts no grant', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`delete from role_permission`);
      await runMigration(tx);
      expect(await raw(tx, sql`select 1 from role_permission`)).toEqual([]);
    });
  });

  it('the payback columns refuse a withdrawal without a request and an over-long note', async () => {
    await rolledBack(async (tx) => {
      const [rec] = await raw<{ id: string }>(tx, sql`select id from pricing_record limit 1`);
      const [user] = await raw<{ id: string }>(tx, sql`select id from app_user limit 1`);
      await expect(
        tx.execute(sql`
          update pricing_record set payback_request_withdrawn_at = now(),
            payback_request_withdrawn_by = ${user!.id}, payback_requested_at = null,
            payback_requested_by = null
          where id = ${rec!.id}`),
      ).rejects.toThrow();
    });
    await rolledBack(async (tx) => {
      const [rec] = await raw<{ id: string }>(tx, sql`select id from pricing_record limit 1`);
      const [user] = await raw<{ id: string }>(tx, sql`select id from app_user limit 1`);
      await expect(
        tx.execute(sql`
          update pricing_record set payback_requested_at = now(), payback_requested_by = ${user!.id},
            payback_request_note = ${'x'.repeat(501)}
          where id = ${rec!.id}`),
      ).rejects.toThrow();
    });
  });
});
