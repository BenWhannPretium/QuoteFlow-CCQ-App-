import { readFileSync } from 'node:fs';

import { G4_REQUIRED_CHECKS_SEED, hybridConfig } from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { raw, testDb } from './helpers';
import { G4_REQUIRED_CHECKS_DESCRIPTION } from '../seeds/config/settings';
import type { Tx } from '../src/client';

/**
 * FB-25 (0053): Final Review requires the customer tooling commitment (N17-26, N18-02), and standard payment
 * terms are never non-standard (N17-28).
 *
 * - `g4_required_checks` gains `tooling_commitment_answered`, only while unedited (version 1) and unapproved.
 * - The G4 Advance rule as FB-08 seeded it gains the tooling-commitment rule; an approved or edited one is
 *   left alone.
 * - Open quotes with a standard code and the box ticked by hand are cleared, each with a system audit row.
 *
 * The migration ran in the global setup; each test re-runs it in a rolled-back transaction from the state an
 * environment had before it. Synthetic data only.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0053_fb25_quote_page_final_review.sql', import.meta.url),
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

/** Today's seeded G4 Advance rule (hybrid.ts) and the one FB-08 (0038) left. */
const G4_RULE_NOW = hybridConfig.outcomes.find(
  (o) => o.gateKey === 'G4' && o.key === 'approve',
)!.requiredFields;
const G4_RULE_0038 = G4_RULE_NOW.slice(0, 4);

const setting = async (tx: Tx) =>
  (
    await raw<{ value: string[]; description: string; provisional: boolean }>(
      tx,
      sql`select value, description, provisional from app_setting where key = 'g4_required_checks'`,
    )
  )[0]!;
const g4Rule = async (tx: Tx) =>
  (
    await raw<{ required_fields: unknown[] }>(
      tx,
      sql`select required_fields from gate_outcome_definition where gate_key = 'G4' and key = 'approve'`,
    )
  )[0]!.required_fields;

/** Before FB-25: the FB-08 checks and the FB-08 G4 rule, untouched. */
async function preFb25(tx: Tx) {
  await tx.execute(sql`
    update app_setting set value = '["terms_exception","terms_finalized"]'::jsonb,
      approved_at = null, version = 1
    where key = 'g4_required_checks'`);
  await tx.execute(sql`
    update gate_outcome_definition
    set required_fields = ${JSON.stringify(G4_RULE_0038)}::jsonb, approved_at = null, version = 1
    where gate_key = 'G4' and key = 'approve'`);
}

const flag = async (tx: Tx, id: string) =>
  (
    await raw<{ terms_nonstandard: boolean }>(
      tx,
      sql`select terms_nonstandard from quote where id = ${id}`,
    )
  )[0]!.terms_nonstandard;

const migrationAudits = (tx: Tx) =>
  raw<{
    quote_id: string;
    actor_id: string | null;
    entity: string;
    before: unknown;
    after: Record<string, unknown>;
    change_reason: string;
  }>(
    tx,
    sql`select quote_id, actor_id, entity, before, after, change_reason from audit_event
        where after->>'source' = 'migration:0053_fb25_quote_page_final_review'`,
  );

describe('migration 0053 (FB-25): tooling commitment at Final Review, standard terms', () => {
  it('has three statements: the setting, the G4 rule, the open quotes', () => {
    expect(statements).toHaveLength(3);
    expect(G4_RULE_NOW).toHaveLength(5);
  });

  it('brings an untouched environment to the seed; safe to run twice', async () => {
    await rolledBack(async (tx) => {
      await preFb25(tx);
      await runMigration(tx);
      await runMigration(tx);
      const s = await setting(tx);
      expect([...s.value].sort()).toEqual([...G4_REQUIRED_CHECKS_SEED].sort());
      expect(s.description).toBe(G4_REQUIRED_CHECKS_DESCRIPTION);
      expect(s.provisional).toBe(true);
      expect(await g4Rule(tx)).toEqual(G4_RULE_NOW);
    });
  });

  it('leaves an approved or Admin-edited setting and rule alone', async () => {
    await rolledBack(async (tx) => {
      await preFb25(tx);
      await tx.execute(
        sql`update app_setting set approved_at = now() where key = 'g4_required_checks'`,
      );
      await tx.execute(sql`
        update gate_outcome_definition set approved_at = now() where gate_key = 'G4' and key = 'approve'`);
      await runMigration(tx);
      expect((await setting(tx)).value).toEqual(['terms_exception', 'terms_finalized']);
      expect(await g4Rule(tx)).toEqual(G4_RULE_0038);
    });
    await rolledBack(async (tx) => {
      await preFb25(tx);
      // An Admin removed a check (the console bumps the version) and edited the rule.
      await tx.execute(sql`
        update app_setting set value = '["terms_finalized"]'::jsonb, version = 2
        where key = 'g4_required_checks'`);
      const edited = G4_RULE_0038.slice(0, 2);
      await tx.execute(sql`
        update gate_outcome_definition set required_fields = ${JSON.stringify(edited)}::jsonb, version = 2
        where gate_key = 'G4' and key = 'approve'`);
      await runMigration(tx);
      expect((await setting(tx)).value).toEqual(['terms_finalized']);
      expect(await g4Rule(tx)).toEqual(edited);
    });
  });

  it('clears the box on open quotes at a standard code, with a system audit row each', async () => {
    await rolledBack(async (tx) => {
      const quotes = await raw<{ id: string }>(
        tx,
        sql`select id from quote where status <> 'closed' order by quote_number limit 4`,
      );
      expect(quotes).toHaveLength(4);
      const [standard, nonstandard, blank, closed] = quotes.map((q) => q.id);
      const set = (id: string, code: string | null) =>
        tx.execute(sql`
          update quote set terms_payment_terms_code = ${code}, terms_nonstandard = true
          where id = ${id}`);
      await set(standard!, 'NET_30');
      await set(nonstandard!, 'NET_60');
      await set(blank!, null);
      await set(closed!, 'NET_15');
      await tx.execute(sql`
        update quote set status = 'closed', closed_at = now(), outcome = 'declined',
          outcome_reason_code = 'not_strategic', closure_owner_id = kam_user_id
        where id = ${closed!}`);

      await runMigration(tx);

      expect(await flag(tx, standard!)).toBe(false);
      expect(await flag(tx, nonstandard!)).toBe(true);
      expect(await flag(tx, blank!)).toBe(true);
      expect(await flag(tx, closed!)).toBe(true);
      const audits = await migrationAudits(tx);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        quote_id: standard,
        actor_id: null,
        entity: 'quote',
        before: { termsNonstandard: true },
        after: { termsNonstandard: false, termsPaymentTermsCode: 'NET_30' },
      });
      expect(audits[0]!.change_reason).toMatch(/^FB-25/);

      await runMigration(tx);
      expect(await migrationAudits(tx)).toHaveLength(1);
    });
  });
});
