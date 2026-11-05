import { readFileSync } from 'node:fs';

import {
  OVERRIDE_SETTINGS_SEED,
  parseOverrideSettings,
  SF_OUTCOME_STAGE_NAMES_SEED,
} from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { raw, testDb } from './helpers';
import { SF_STAGES } from '../seeds/config/settings';
import { SHARED_HELP, ZERO_CER_HELP } from '../seeds/config/value-lists';
import type { Tx } from '../src/client';

/**
 * FB-04 data migration (0029) re-run in a rolled-back transaction against the state an environment
 * had before it: the old priority_tier approver rule, the old "$0 CER" label, no SHARED option and no
 * Salesforce settings. Also checks that the seeds carry the same values as the migration.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0029_fb04_qualification_funding_sf_link.sql', import.meta.url),
  'utf8',
);
const statements = MIGRATION.split('--> statement-breakpoint').filter(
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

const OLD_TIER_RULE = {
  field: 'priority_tier',
  label: 'Priority tier',
  approval: 'approver',
  requestRoles: ['KAM', 'SalesLeader', 'EngLead', 'Pricing'],
  approverRoles: ['SalesLeader', 'EngLead'],
  revertRoles: ['SalesLeader', 'EngLead', 'Admin'],
  ownQuoteOnlyRoles: [],
};

async function toPreFb04State(tx: Tx) {
  const fields = OVERRIDE_SETTINGS_SEED.fields.map((f) =>
    f.field === 'priority_tier' ? OLD_TIER_RULE : f,
  );
  await tx.execute(
    sql`update app_setting set value = ${JSON.stringify(fields)}::jsonb where key = 'overridable_fields'`,
  );
  await tx.execute(
    sql`update value_list set label = '$0 CER', meta = '{}'::jsonb where list_key = 'tooling_funding_model' and code = 'ZERO_CER'`,
  );
  await tx.execute(
    sql`delete from value_list where list_key = 'tooling_funding_model' and code = 'SHARED'`,
  );
  await tx.execute(
    sql`delete from app_setting where key in ('salesforce_instance_url', 'sf_outcome_stage_names')`,
  );
}

describe('0029 FB-04 data migration', () => {
  it('F-065: priority_tier becomes SalesLeader-only and self-applied; ship_to and queue_position are untouched', async () => {
    await rolledBack(async (tx) => {
      await toPreFb04State(tx);
      await runMigration(tx);
      const [row] = await raw<{ value: Record<string, unknown>[] }>(
        tx,
        sql`select value from app_setting where key = 'overridable_fields'`,
      );
      const parsed = parseOverrideSettings({ fields: row!.value, justificationMinLength: 15 });
      const byField = Object.fromEntries(parsed.fields.map((f) => [f.field, f]));
      expect(byField.priority_tier).toMatchObject({
        approval: 'self',
        requestRoles: ['SalesLeader'],
        approverRoles: [],
        revertRoles: ['SalesLeader', 'EngLead', 'Admin'],
      });
      expect(byField.ship_to).toMatchObject({
        approval: 'self',
        requestRoles: ['KAM', 'SalesLeader'],
      });
      expect(byField.queue_position).toMatchObject({ approval: 'self', requestRoles: ['EngLead'] });
      expect(parsed.fields.map((f) => f.field)).toEqual([
        'priority_tier',
        'ship_to',
        'queue_position',
      ]);
    });
  });

  it('F-065: a request that was already waiting is left as it is (not rejected)', async () => {
    await rolledBack(async (tx) => {
      await toPreFb04State(tx);
      const [q] = await raw<{ id: string; kam_user_id: string }>(
        tx,
        sql`select id, kam_user_id from quote where status = 'active' limit 1`,
      );
      await tx.execute(sql`insert into override (id, quote_id, field, approval_mode, original_value, requested_value, justification, requested_by, status)
        values (gen_random_uuid(), ${q!.id}, 'priority_tier', 'approver', '"LOW"'::jsonb, '"HIGH"'::jsonb, 'Customer launch moved up', ${q!.kam_user_id}, 'requested')`);
      await runMigration(tx);
      const rows = await raw<{ status: string }>(
        tx,
        sql`select status from override where quote_id = ${q!.id} and field = 'priority_tier'`,
      );
      expect(rows.map((r) => r.status)).toEqual(['requested']);
    });
  });

  it('F-022 / V-055: $0 CER is relabelled with help text and Shared is added (provisional)', async () => {
    await rolledBack(async (tx) => {
      await toPreFb04State(tx);
      await runMigration(tx);
      const rows = await raw<{
        code: string;
        label: string;
        sort: number;
        active: boolean;
        provisional: boolean;
        meta: { helpText?: string };
      }>(
        tx,
        sql`select code, label, sort, active, provisional, meta from value_list where list_key = 'tooling_funding_model' order by sort`,
      );
      const by = Object.fromEntries(rows.map((r) => [r.code, r]));
      expect(by.ZERO_CER).toMatchObject({ label: '$0 CER (customer-reimbursed capital)' });
      expect(by.ZERO_CER!.meta.helpText).toBe(ZERO_CER_HELP);
      expect(by.SHARED).toMatchObject({
        label: 'Shared (company and customer)',
        active: true,
        provisional: true,
        sort: 50,
      });
      expect(by.SHARED!.meta.helpText).toBe(SHARED_HELP);
      expect(rows.map((r) => r.code)).toEqual([
        'COMPANY_FUNDED',
        'CUSTOMER_FUNDED',
        'ZERO_CER',
        'AMORTIZED',
        'SHARED',
      ]);
    });
  });

  it('F-076: salesforce_instance_url is seeded empty and the outcome stage names match the seed', async () => {
    await rolledBack(async (tx) => {
      await toPreFb04State(tx);
      await runMigration(tx);
      const settings = await raw<{ key: string; value: unknown; provisional: boolean }>(
        tx,
        sql`select key, value, provisional from app_setting where key in ('salesforce_instance_url', 'sf_outcome_stage_names')`,
      );
      const by = Object.fromEntries(settings.map((s) => [s.key, s]));
      expect(by.salesforce_instance_url).toMatchObject({ value: '', provisional: true });
      expect(by.sf_outcome_stage_names!.value).toEqual(SF_OUTCOME_STAGE_NAMES_SEED);
      expect(by.sf_outcome_stage_names!.provisional).toBe(true);
    });
  });

  it('every Salesforce stage named in sf_outcome_stage_names is a stage in the stage map', () => {
    const known = new Set(SF_STAGES.map(([name]) => name));
    for (const stage of Object.values(SF_OUTCOME_STAGE_NAMES_SEED))
      expect(known.has(stage)).toBe(true);
  });

  it('is safe to run twice (nothing duplicates, nothing is overwritten the second time)', async () => {
    await rolledBack(async (tx) => {
      await toPreFb04State(tx);
      await runMigration(tx);
      await tx.execute(
        sql`update app_setting set value = '"https://pretium.lightning.force.com"'::jsonb where key = 'salesforce_instance_url'`,
      );
      await runMigration(tx);
      const [url] = await raw<{ value: string }>(
        tx,
        sql`select value from app_setting where key = 'salesforce_instance_url'`,
      );
      expect(url!.value).toBe('https://pretium.lightning.force.com');
      const shared = await raw<{ n: number }>(
        tx,
        sql`select count(*)::int as n from value_list where code = 'SHARED'`,
      );
      expect(shared[0]!.n).toBe(1);
    });
  });
});
