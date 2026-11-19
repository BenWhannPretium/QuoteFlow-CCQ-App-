import { readFileSync } from 'node:fs';

import { CAPITAL_READINESS_DEFAULT_SEED } from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { G3_RULES_0031, G3_RULES_0049 } from './g3-rules-history';
import { raw, testDb } from './helpers';
import { CAPITAL_READINESS_DEFAULT_DESCRIPTION } from '../seeds/config/settings';
import type { Tx } from '../src/client';

/**
 * FB-21 Part A (0049): capital readiness "pending" is the normal state and never blocks.
 *
 * - The setting `capital_readiness_default` (provisional), only in a configured database.
 * - The G3 Advance rule as seeded by 0031 loses the two pending rules and gains "not approved refuses";
 *   an approved or Admin-edited rule is left alone.
 * - Open quotes in Quoting with no readiness start on the default, each with a system audit row; a
 *   chosen readiness, a closed quote and a quote in another stage are untouched.
 *
 * The migration ran in the global setup; each test re-runs it in a rolled-back transaction from the
 * state an environment had before it.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0049_fb21_capital_readiness.sql', import.meta.url),
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

/** The G3 Advance rule before FB-21, as 0031 left it. */
const OLD_G3_RULES = G3_RULES_0031;

async function g3Rules(tx: Tx) {
  const [row] = await raw<{ required_fields: unknown }>(
    tx,
    sql`select required_fields from gate_outcome_definition where gate_key = 'G3' and key = 'submit'`,
  );
  return row!.required_fields;
}

/** Before FB-21: no setting, the old G3 rule. */
async function preFb21(tx: Tx) {
  await tx.execute(sql`delete from app_setting where key = 'capital_readiness_default'`);
  await tx.execute(sql`
    update gate_outcome_definition
    set required_fields = ${JSON.stringify(OLD_G3_RULES)}::jsonb, approved_at = null, version = 1
    where gate_key = 'G3' and key = 'submit'`);
}

interface Candidate {
  id: string;
  version: number;
}

/**
 * `n` open quotes whose every item has an engineering review, moved into Quoting (open) with a current
 * pricing record holding no readiness. Synthetic data only.
 */
async function quotesInQuoting(tx: Tx, n: number): Promise<Candidate[]> {
  const list = await raw<{ id: string; version: number }>(
    tx,
    sql`select q.id, q.version from quote q
        where q.status <> 'closed'
          and exists (select 1 from quote_item qi where qi.quote_id = q.id)
          and not exists (
            select 1 from quote_item qi left join eng_review er on er.quote_item_id = qi.id
            where qi.quote_id = q.id and er.id is null)
        order by q.quote_number
        limit ${n}`,
  );
  expect(list.length).toBe(n);
  for (const q of list) {
    await tx.execute(
      sql`update quote set stage_key = 'QUOTING', status = 'active' where id = ${q.id}`,
    );
    await tx.execute(sql`
      insert into pricing_record (id, quote_id, quote_version)
      values (gen_random_uuid(), ${q.id}, ${q.version})
      on conflict (quote_id, quote_version) do nothing`);
    await tx.execute(sql`
      update pricing_record set capital_readiness = null, capital_pending_justification = null
      where quote_id = ${q.id} and quote_version = ${q.version}`);
    // No retired "capital required" decision unless a test adds one.
    await tx.execute(sql`
      update gate_decision set outcome_key = 'proceed'
      where quote_id = ${q.id} and gate_key = 'G2' and outcome_key = 'capital_required'`);
  }
  return list;
}

const setPrelim = (tx: Tx, quoteId: string, usd: number | null) =>
  tx.execute(sql`
    update eng_review set prelim_capital_usd = ${usd}
    where quote_item_id in (select id from quote_item where quote_id = ${quoteId})`);

async function readiness(tx: Tx, q: Candidate) {
  const [row] = await raw<{ capital_readiness: string | null }>(
    tx,
    sql`select capital_readiness from pricing_record
        where quote_id = ${q.id} and quote_version = ${q.version}`,
  );
  return row?.capital_readiness ?? null;
}

const migrationAudits = (tx: Tx) =>
  raw<{
    quote_id: string;
    actor_id: string | null;
    action: string;
    entity: string;
    before: unknown;
    after: { capitalReadiness: string; source: string; capitalNeeded: boolean };
    change_reason: string;
  }>(
    tx,
    sql`select quote_id, actor_id, action, entity, before, after, change_reason from audit_event
        where after->>'source' = 'migration:0049_fb21_capital_readiness'`,
  );

describe('migration 0049 (FB-21 Part A): capital readiness', () => {
  it('has three statements: the setting, the G3 rule, the open quotes', () => {
    expect(statements).toHaveLength(3);
    expect(OLD_G3_RULES).toHaveLength(G3_RULES_0049.length + 1);
  });

  it('brings an untouched environment to the seed: the setting and the G3 rule; safe to run twice', async () => {
    await rolledBack(async (tx) => {
      await preFb21(tx);
      await runMigration(tx);
      await runMigration(tx);
      expect(await g3Rules(tx)).toEqual(G3_RULES_0049);
      const settings = await raw<{ value: unknown; description: string; provisional: boolean }>(
        tx,
        sql`select value, description, provisional from app_setting where key = 'capital_readiness_default'`,
      );
      expect(settings).toEqual([
        {
          value: CAPITAL_READINESS_DEFAULT_SEED,
          description: CAPITAL_READINESS_DEFAULT_DESCRIPTION,
          provisional: true,
        },
      ]);
    });
  });

  it('leaves an approved or Admin-edited G3 rule and an edited setting alone', async () => {
    await rolledBack(async (tx) => {
      await preFb21(tx);
      await tx.execute(sql`
        update gate_outcome_definition set approved_at = now()
        where gate_key = 'G3' and key = 'submit'`);
      await runMigration(tx);
      expect(await g3Rules(tx)).toEqual(OLD_G3_RULES);
    });
    await rolledBack(async (tx) => {
      await preFb21(tx);
      const adminRules = OLD_G3_RULES.slice(0, 3);
      await tx.execute(sql`
        update gate_outcome_definition
        set required_fields = ${JSON.stringify(adminRules)}::jsonb, version = 2
        where gate_key = 'G3' and key = 'submit'`);
      await tx.execute(sql`
        insert into app_setting (id, key, value, description, provisional)
        values (gen_random_uuid(), 'capital_readiness_default',
          '{"whenNeeded":"pre_approved","whenNotNeeded":"pending"}'::jsonb, 'edited', false)`);
      await runMigration(tx);
      expect(await g3Rules(tx)).toEqual(adminRules);
      const [setting] = await raw<{ value: unknown; provisional: boolean }>(
        tx,
        sql`select value, provisional from app_setting where key = 'capital_readiness_default'`,
      );
      expect(setting).toEqual({
        value: { whenNeeded: 'pre_approved', whenNotNeeded: 'pending' },
        provisional: false,
      });
    });
  });

  it('back-fills open quotes in Quoting from their figures, with a system audit row each', async () => {
    await rolledBack(async (tx) => {
      await preFb21(tx);
      const [zero, above, blank, chosen, historical, otherStage, closed] = await quotesInQuoting(
        tx,
        7,
      );
      await setPrelim(tx, zero!.id, 0);
      await setPrelim(tx, above!.id, 20_000);
      await setPrelim(tx, blank!.id, null);
      await setPrelim(tx, chosen!.id, 20_000);
      await tx.execute(sql`
        update pricing_record set capital_readiness = 'pre_approved'
        where quote_id = ${chosen!.id} and quote_version = ${chosen!.version}`);
      // The retired "Advance – capital required" decision counts as needed whatever the figure.
      await setPrelim(tx, historical!.id, 0);
      await tx.execute(sql`
        update gate_decision set outcome_key = 'capital_required'
        where id = (select id from gate_decision where quote_id = ${historical!.id} and gate_key = 'G2'
                    order by decided_at desc limit 1)`);
      const hasG2 = await raw(
        tx,
        sql`select 1 from gate_decision where quote_id = ${historical!.id} and gate_key = 'G2'`,
      );
      await tx.execute(sql`update quote set stage_key = 'ENG_REVIEW' where id = ${otherStage!.id}`);
      await tx.execute(sql`
        update quote set status = 'closed', closed_at = now(), outcome = 'declined',
          outcome_reason_code = 'not_strategic', closure_owner_id = kam_user_id
        where id = ${closed!.id}`);

      await runMigration(tx);

      expect(await readiness(tx, zero!)).toBe('not_required');
      expect(await readiness(tx, above!)).toBe('pending');
      expect(await readiness(tx, blank!)).toBe('pending');
      expect(await readiness(tx, chosen!)).toBe('pre_approved');
      if (hasG2.length > 0) expect(await readiness(tx, historical!)).toBe('pending');
      expect(await readiness(tx, otherStage!)).toBeNull();
      expect(await readiness(tx, closed!)).toBeNull();

      const audits = await migrationAudits(tx);
      const byQuote = new Map(audits.map((a) => [a.quote_id, a]));
      expect(byQuote.get(zero!.id)).toMatchObject({
        actor_id: null,
        action: 'update',
        entity: 'pricing_record',
        before: { capitalReadiness: null },
        after: { capitalReadiness: 'not_required', capitalNeeded: false },
      });
      expect(byQuote.get(zero!.id)!.change_reason).toMatch(/^FB-21/);
      expect(byQuote.get(above!.id)!.after).toMatchObject({
        capitalReadiness: 'pending',
        capitalNeeded: true,
      });
      for (const q of [chosen, otherStage, closed]) expect(byQuote.has(q!.id)).toBe(false);

      // Run again: nothing left to fill, no second audit row.
      await runMigration(tx);
      expect((await migrationAudits(tx)).length).toBe(audits.length);
    });
  });

  it('follows a stored default and threshold', async () => {
    await rolledBack(async (tx) => {
      const [small, large] = await quotesInQuoting(tx, 2);
      await tx.execute(sql`
        update app_setting set value = '{"whenNeeded":"pre_approved","whenNotNeeded":"pending"}'::jsonb
        where key = 'capital_readiness_default'`);
      await tx.execute(sql`
        update app_setting set value = '50000'::jsonb where key = 'capital_needed_above_usd'`);
      await setPrelim(tx, small!.id, 50_000);
      await setPrelim(tx, large!.id, 50_001);
      await runMigration(tx);
      expect(await readiness(tx, small!)).toBe('pending');
      expect(await readiness(tx, large!)).toBe('pre_approved');
    });
  });

  it('on an empty database: inserts no setting, changes no rule and writes no audit row', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`delete from app_setting`);
      await tx.execute(
        sql`update pricing_record set capital_readiness = coalesce(capital_readiness, 'pending')`,
      );
      await tx.execute(sql`update gate_outcome_definition set approved_at = null`);
      const before = await g3Rules(tx);
      await runMigration(tx);
      expect(await raw(tx, sql`select 1 from app_setting`)).toEqual([]);
      expect(await g3Rules(tx)).toEqual(before);
      expect(await migrationAudits(tx)).toEqual([]);
    });
  });
});
