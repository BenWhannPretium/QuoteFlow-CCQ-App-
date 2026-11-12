import { readFileSync } from 'node:fs';

import { ROI_REQUIRED_WHEN_SEED, hybridConfig } from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { asPersona, raw, testDb } from './helpers';
import type { Tx } from '../src/client';
import { FB07, fb07DryRun, renderFb07DryRun } from '../src/fb07DryRun';

/**
 * FB-07 data migration (0031's hand-written statements) re-run in a rolled-back transaction against the
 * state an environment had before it: the old G3 name, label, help and rule, no roi_required_when, no
 * Finance grants, and quotes in Quoting with costing attested and no costing model. The dry run is
 * checked against what the statements then do. The schema half of 0031 ran in the global setup.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0031_fb07_costing_roi_price.sql', import.meta.url),
  'utf8',
);
const DATA = MIGRATION.slice(MIGRATION.indexOf('-- ── FB-07 (hand-written)'));
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

/** Quotes open in Quoting, with whether the current version's costing is attested. */
const openInQuoting = (tx: Tx) =>
  raw<{ id: string; quote_number: string; costing_completed: boolean | null }>(
    tx,
    sql`select q.id, q.quote_number, pr.costing_completed
        from quote q left join pricing_record pr on pr.quote_id = q.id and pr.quote_version = q.version
        where q.stage_key = 'QUOTING' and q.status <> 'closed' order by q.quote_number`,
  );

async function toPreFb07State(tx: Tx) {
  await tx.execute(sql`update gate_definition set label = ${FB07.gateLabel.from} where key = 'G3'`);
  await tx.execute(
    sql`update gate_outcome_definition
        set label = ${FB07.outcomeLabel.from}, help_text = ${FB07.outcomeHelp.from},
            required_fields = ${JSON.stringify(FB07.seededRule)}::jsonb
        where gate_key = 'G3' and key = 'submit'`,
  );
  await tx.execute(sql`delete from app_setting where key = 'roi_required_when'`);
  await tx.execute(
    sql`delete from role_permission where role = 'Finance' or permission = 'roi.upload'`,
  );
  // Before FB-07 nobody uploaded a costing model, and every record was "required".
  await tx.execute(
    sql`update attachment set removed_at = now(), removed_by = uploaded_by
        where kind in ('cost_model', 'roi_model', 'price_table') and removed_at is null`,
  );
  await tx.execute(sql`update pricing_record set cost_model_requirement = 'required'`);
  // Pricing had attested costing on two of the open quotes in Quoting (the synthetic data prices a quote
  // only right before G3, so none is attested there yet).
  const open = await openInQuoting(tx);
  for (const q of open.slice(0, 2)) {
    await tx.execute(
      sql`insert into pricing_record (id, quote_id, quote_version, costing_completed, costing_attested_at)
          select gen_random_uuid(), q.id, q.version, true, now() from quote q where q.id = ${q.id}
          on conflict (quote_id, quote_version)
          do update set costing_completed = true, costing_attested_at = now()`,
    );
  }
}

describe('0031 FB-07 data migration', () => {
  it('the pre-FB-07 state has open quotes in Quoting both with and without costing attested', async () => {
    await rolledBack(async (tx) => {
      await toPreFb07State(tx);
      const open = await openInQuoting(tx);
      expect(open.some((q) => q.costing_completed)).toBe(true);
      expect(open.some((q) => !q.costing_completed)).toBe(true);
    });
  });

  it('grandfathers open quotes in Quoting with costing attested and no model, and nothing else', async () => {
    await rolledBack(async (tx) => {
      await toPreFb07State(tx);
      const open = await openInQuoting(tx);
      await runMigration(tx);
      const marked = await raw<{ quote_id: string; quote_version: number; stage_key: string }>(
        tx,
        sql`select pr.quote_id, pr.quote_version, q.stage_key from pricing_record pr
            join quote q on q.id = pr.quote_id
            where pr.cost_model_requirement = 'grandfathered'`,
      );
      expect(marked.map((m) => m.quote_id).sort()).toEqual(
        open
          .filter((q) => q.costing_completed)
          .map((q) => q.id)
          .sort(),
      );
      expect(marked.every((m) => m.stage_key === 'QUOTING')).toBe(true);
    });
  });

  it('a quote that already has a costing model is not grandfathered', async () => {
    await rolledBack(async (tx) => {
      await toPreFb07State(tx);
      const [q] = (await openInQuoting(tx)).filter((r) => r.costing_completed);
      const [by] = await raw<{ id: string }>(tx, sql`select id from app_user limit 1`);
      await tx.execute(
        sql`insert into attachment (id, quote_id, kind, file_name, size, mime, uploaded_by, version)
            values (gen_random_uuid(), ${q!.id}, 'cost_model', 'c.xlsx', 0, 'x', ${by!.id},
                    (select coalesce(max(version), 0) + 1 from attachment
                     where quote_id = ${q!.id} and kind = 'cost_model'))`,
      );
      const [count] = await raw<{ n: number }>(
        tx,
        sql`select count(*)::int as n from attachment
            where quote_id = ${q!.id} and kind = 'cost_model' and removed_at is null`,
      );
      expect(count!.n).toBe(1);
      await runMigration(tx);
      const [row] = await raw<{ r: string }>(
        tx,
        sql`select pr.cost_model_requirement as r from pricing_record pr join quote q
            on q.id = pr.quote_id and pr.quote_version = q.version where q.id = ${q!.id}`,
      );
      expect(row!.r).toBe('required');
    });
  });

  it('F-081 / F-032: renames the gate and its Advance, extends the seeded rule, adds the setting and grants', async () => {
    await rolledBack(async (tx) => {
      await toPreFb07State(tx);
      await runMigration(tx);
      const [gate] = await raw<{ label: string }>(
        tx,
        sql`select label from gate_definition where key = 'G3'`,
      );
      expect(gate!.label).toBe('Price approved');
      const [o] = await raw<{ label: string; help_text: string; required_fields: unknown }>(
        tx,
        sql`select label, help_text, required_fields from gate_outcome_definition
            where gate_key = 'G3' and key = 'submit'`,
      );
      const seeded = hybridConfig.outcomes.find((x) => x.gateKey === 'G3' && x.key === 'submit')!;
      expect(o!.label).toBe(seeded.label);
      // 0031 writes the FB-07 wording; FB-14's 0042 then says "payback model" (fb14-migration test).
      expect(o!.help_text).toBe(
        (seeded.helpText ?? '').replace(
          'the payback model is on file too.',
          'the ROI model is on file too.',
        ),
      );
      expect(o!.required_fields).toEqual(seeded.requiredFields);
      const [setting] = await raw<{ value: unknown; provisional: boolean }>(
        tx,
        sql`select value, provisional from app_setting where key = 'roi_required_when'`,
      );
      expect(setting).toEqual({ value: ROI_REQUIRED_WHEN_SEED, provisional: true });
      const grants = await raw<{ g: string }>(
        tx,
        sql`select role || ':' || permission as g from role_permission
            where role = 'Finance' or permission = 'roi.upload' order by 1`,
      );
      expect(grants.map((r) => r.g)).toEqual([
        'Admin:roi.upload',
        'Finance:quote.read',
        'Finance:quote.read.commercialFields',
        'Finance:roi.upload',
        'PricingLead:roi.upload',
      ]);
    });
  });

  it('skips rows the business approved or an admin changed', async () => {
    await rolledBack(async (tx) => {
      await toPreFb07State(tx);
      await tx.execute(sql`update gate_definition set label = 'Pricing sign-off' where key = 'G3'`);
      await tx.execute(
        sql`update gate_outcome_definition set approved_at = now() where gate_key = 'G3' and key = 'submit'`,
      );
      await runMigration(tx);
      const [gate] = await raw<{ label: string }>(
        tx,
        sql`select label from gate_definition where key = 'G3'`,
      );
      expect(gate!.label).toBe('Pricing sign-off');
      const [o] = await raw<{ label: string; required_fields: unknown }>(
        tx,
        sql`select label, required_fields from gate_outcome_definition where gate_key = 'G3' and key = 'submit'`,
      );
      expect(o!.label).toBe(FB07.outcomeLabel.from);
      expect(o!.required_fields).toEqual(FB07.seededRule);
    });
  });

  it('the dry run predicts what the migration does, and reads "already done" after it', async () => {
    await rolledBack(async (tx) => {
      await toPreFb07State(tx);
      const before = await fb07DryRun(tx);
      expect(before.config.map((c) => c.outcome)).toEqual([
        'will change',
        'will change',
        'will change',
        'will change',
        'will change',
        'will change',
      ]);
      const open = await openInQuoting(tx);
      expect(before.grandfathered.map((r) => r.quoteNumber)).toEqual(
        open.filter((q) => q.costing_completed).map((q) => q.quote_number),
      );
      expect(before.needModel.map((r) => r.quoteNumber)).toEqual(
        open.filter((q) => !q.costing_completed).map((q) => q.quote_number),
      );
      const md = renderFb07DryRun(before, new Date('2026-11-09T18:00:00Z'));
      expect(md).toContain(`## Grandfathered: ${before.grandfathered.length} quote(s)`);
      expect(md).toContain(
        '| G3 gate label → "Price approved" | Price approved & capital ready | will change |',
      );

      await runMigration(tx);
      const after = await fb07DryRun(tx);
      expect(after.config.every((c) => c.outcome === 'already done')).toBe(true);
    });
  });
});

describe('F-083: Finance under RLS', () => {
  it('sees every quote, like Pricing, and the pricing-app history', async () => {
    const [finance, pricing] = await Promise.all([
      asPersona(db, 'finance', (tx) =>
        raw<{ n: number }>(tx, sql`select count(*)::int as n from quote`),
      ),
      asPersona(db, 'pricing', (tx) =>
        raw<{ n: number }>(tx, sql`select count(*)::int as n from quote`),
      ),
    ]);
    expect(finance[0]!.n).toBeGreaterThan(0);
    expect(finance[0]!.n).toBe(pricing[0]!.n);
    await asPersona(db, 'finance', async (tx) => {
      // The policy admits the role (the table may be empty in the synthetic data).
      await expect(
        raw(tx, sql`select 1 from pricing_history_record limit 1`),
      ).resolves.toBeDefined();
      const [ctx] = await raw<{ visible: boolean }>(
        tx,
        sql`select app_sees_all_quotes() as visible`,
      );
      expect(ctx!.visible).toBe(true);
    });
  });
});

describe('F-074: one current version per quote and kind (database)', () => {
  it('a second current costing model on one quote violates the unique partial index', async () => {
    await rolledBack(async (tx) => {
      const [m] = await raw<{ quote_id: string; uploaded_by: string; version: number }>(
        tx,
        sql`select quote_id, uploaded_by, version from attachment
            where kind = 'cost_model' and superseded_at is null and removed_at is null
            order by version desc limit 1`,
      );
      expect(m).toBeDefined();
      await expect(
        tx.execute(
          sql`insert into attachment (id, quote_id, kind, file_name, size, mime, uploaded_by, version)
              values (gen_random_uuid(), ${m!.quote_id}, 'cost_model', 'dup.xlsx', 0, 'x', ${m!.uploaded_by}, ${m!.version + 1})`,
        ),
      ).rejects.toThrow();
    });
  });

  it('a versioned kind needs a version; other kinds may not have one', async () => {
    await rolledBack(async (tx) => {
      const [m] = await raw<{ quote_id: string; uploaded_by: string }>(
        tx,
        sql`select quote_id, uploaded_by from attachment where quote_id is not null limit 1`,
      );
      await expect(
        tx.execute(
          sql`insert into attachment (id, quote_id, kind, file_name, size, mime, uploaded_by)
              values (gen_random_uuid(), ${m!.quote_id}, 'roi_model', 'r.xlsx', 0, 'x', ${m!.uploaded_by})`,
        ),
      ).rejects.toThrow();
    });
    await rolledBack(async (tx) => {
      const [m] = await raw<{ quote_id: string; uploaded_by: string }>(
        tx,
        sql`select quote_id, uploaded_by from attachment where quote_id is not null limit 1`,
      );
      await expect(
        tx.execute(
          sql`insert into attachment (id, quote_id, kind, file_name, size, mime, uploaded_by, version)
              values (gen_random_uuid(), ${m!.quote_id}, 'spec', 's.pdf', 0, 'x', ${m!.uploaded_by}, 1)`,
        ),
      ).rejects.toThrow();
    });
  });
});
