import { readFileSync } from 'node:fs';

import {
  CAPITAL_NEEDED_ABOVE_USD_SEED,
  HOLD_HELP,
  HOLD_OWNER_DEFAULT_SEED,
  hybridConfig,
  parseWorkflowConfig,
} from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { pgError, raw, testDb } from './helpers';
import type { Tx } from '../src/client';
import { loadWorkflowConfigInput } from '../src/repos/config';

/**
 * FB-17 (0046): gate decisions and holds, in the database.
 *
 * - The hand-written half of the migration re-run in a rolled-back transaction against the state an
 *   environment had before it (the schema half ran in the global setup, with the seed).
 * - The two new columns and the CHECK list on the group.
 * - History: a decision recorded with the switched-off outcome still finds its label.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0046_fb17_gate_decisions_holds.sql', import.meta.url),
  'utf8',
);
const DATA = MIGRATION.slice(MIGRATION.indexOf('-- ── FB-17 (hand-written)'));
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
const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute(q)) as unknown as T[];

const NEW_SETTINGS = ['capital_needed_above_usd', 'hold_owner_default'];

/** The labels before FB-17 (gate, outcome, label), as migration 0045 left them. */
const OLD_LABELS: [string, string, string][] = [
  ['G1', 'rework', 'Rework (back to KAM)'],
  ['G1', 'redirect', 'Redirect (not CCQ work)'],
  ['G2', 'rework', 'Rework (back to KAM)'],
  ['G2', 'redirect', 'Redirect (alternative platform / site)'],
  ['G3', 'recost', 'Rework (re-cost)'],
  ['G3', 'rework', 'Rework (back to Engineering)'],
  ['G3', 'rework_kam', 'Rework (back to KAM)'],
  ['G3', 'redirect', 'Redirect (alternative capital model)'],
  ['G4', 'return', 'Rework (back to the affected gate)'],
  ['G6', 'requote', 'Rework (re-quote)'],
];

/** The help texts before FB-17 (gate, outcome, text). */
const OLD_HELP: [string, string, string][] = [
  [
    'G1',
    'hold',
    'Pause it in Intake (for example, waiting on the customer). The clock stops. Needs a reason, an owner and a review date.',
  ],
  [
    'G2',
    'proceed',
    'The solution is feasible: the quote goes to Quoting. Needs the solution fields, capacity evidence and the capacity sign-off.',
  ],
  [
    'G2',
    'hold',
    'Pause it at this stage. The clock stops. Needs a reason, an owner and a review date.',
  ],
  [
    'G3',
    'hold',
    'Pause it in Quoting (for example, capital pre-approval pending). The clock stops. Needs a reason, an owner and a review date.',
  ],
  ['G4', 'hold', 'Pause the release. The clock stops. Needs a reason, an owner and a review date.'],
  [
    'G5',
    'on_hold',
    'The customer put it on hold. The Pretium clock stops. Needs a reason, an owner and a review date.',
  ],
  [
    'G6',
    'hold',
    'Commitment pending (for example, the CER is still with the approvers). Needs a reason, an owner and a review date.',
  ],
];

const seeded = (gate: string, key: string) =>
  hybridConfig.outcomes.find((o) => o.gateKey === gate && o.key === key)!;

/** The G2 Advance rule before FB-17: the seeded rule without its last two (the FB-17) entries. */
const OLD_G2_ADVANCE_RULES = seeded('G2', 'proceed').requiredFields.slice(0, -2);

/**
 * The pre-FB-17 state: no groups, every outcome on, the old labels, help texts and reason codes, the
 * G2 Advance rules without the capital figure and the BOM, and neither of the two settings.
 */
async function preFb17(tx: Tx) {
  await tx.execute(sql`
    DELETE FROM app_setting WHERE key IN ('capital_needed_above_usd', 'hold_owner_default')`);
  await tx.execute(sql`
    UPDATE gate_outcome_definition
    SET outcome_group = null, active = true, approved_at = null, version = 1`);
  for (const [gate, key, label] of OLD_LABELS) {
    await tx.execute(sql`
      UPDATE gate_outcome_definition SET label = ${label}
      WHERE gate_key = ${gate} AND key = ${key}`);
  }
  for (const [gate, key, help] of OLD_HELP) {
    await tx.execute(sql`
      UPDATE gate_outcome_definition SET help_text = ${help}
      WHERE gate_key = ${gate} AND key = ${key}`);
  }
  await tx.execute(sql`
    UPDATE gate_outcome_definition SET reason_context = null, requires_reason_code = false
    WHERE gate_key IN ('G2', 'G3') AND key = 'redirect'`);
  await tx.execute(sql`
    UPDATE gate_outcome_definition SET requires_reason_code = false
    WHERE gate_key = 'G4' AND key = 'return'`);
  await tx.execute(sql`
    UPDATE gate_outcome_definition
    SET required_fields = ${JSON.stringify(OLD_G2_ADVANCE_RULES)}::jsonb
    WHERE gate_key = 'G2' AND key IN ('proceed', 'proceed_with_risk')`);
}

interface OutcomeRow {
  gate_key: string;
  key: string;
  label: string;
  help_text: string | null;
  requires_reason_code: boolean;
  reason_context: string | null;
  active: boolean;
  outcome_group: string | null;
  required_fields: unknown;
}

/** Every outcome row, keyed `gate/outcome`. Sorted in code: no ORDER BY to get wrong. */
async function outcomes(tx: Tx) {
  const list = await rows<OutcomeRow>(
    tx,
    sql`SELECT gate_key, key, label, help_text, requires_reason_code, reason_context, active,
               outcome_group, required_fields
        FROM gate_outcome_definition`,
  );
  return new Map(list.map((r) => [`${r.gate_key}/${r.key}`, r]));
}

/** What the seed holds for the same columns. */
const seededRow = (o: (typeof hybridConfig.outcomes)[number]): OutcomeRow => ({
  gate_key: o.gateKey,
  key: o.key,
  label: o.label,
  help_text: o.helpText,
  requires_reason_code: o.requiresReasonCode,
  reason_context: o.reasonContext ?? null,
  active: o.active,
  outcome_group: o.outcomeGroup ?? null,
  required_fields: o.requiredFields,
});

describe('migration 0046 (FB-17 gate decisions and holds): the data half', () => {
  it('has a hand-written half to re-run', () => {
    expect(statements).toHaveLength(8);
  });

  it('the test knows the old value of everything the seed changed', () => {
    for (const [gate, key, label] of OLD_LABELS) {
      expect(seeded(gate, key).label, `${gate}/${key}`).not.toBe(label);
    }
    for (const [gate, key, help] of OLD_HELP) {
      expect(seeded(gate, key).helpText, `${gate}/${key}`).not.toBe(help);
    }
    expect(OLD_G2_ADVANCE_RULES).toHaveLength(8);
    expect(seeded('G2', 'proceed').requiredFields.slice(-2)).toEqual([
      { field: 'prelim_capital_usd', op: 'present' },
      {
        anyOf: [
          { field: 'eng_capital_needed', op: 'equals', value: false },
          { field: 'equipment_bom_on_file', op: 'equals', value: true },
        ],
      },
    ]);
  });

  it('brings an untouched environment to exactly what the seed holds; safe to run twice', async () => {
    await rolledBack(async (tx) => {
      await preFb17(tx);
      const before = await outcomes(tx);
      expect(before.get('G2/capital_required')).toMatchObject({
        active: true,
        outcome_group: null,
      });
      expect(before.get('G1/rework')!.label).toBe('Rework (back to KAM)');

      await runMigration(tx);
      await runMigration(tx); // idempotent

      const after = await outcomes(tx);
      expect(after.size).toBe(hybridConfig.outcomes.length);
      for (const o of hybridConfig.outcomes) {
        expect(after.get(`${o.gateKey}/${o.key}`), `${o.gateKey}/${o.key}`).toEqual(seededRow(o));
      }
      // The config the app loads is valid, and it is the seeded workflow.
      const loaded = parseWorkflowConfig(await loadWorkflowConfigInput(tx));
      expect(loaded.outcomes).toEqual(hybridConfig.outcomes);

      const settings = await rows<{ key: string; value: unknown; provisional: boolean }>(
        tx,
        sql`SELECT key, value, provisional FROM app_setting
            WHERE key IN ('capital_needed_above_usd', 'hold_owner_default')`,
      );
      expect([...settings].sort((a, b) => a.key.localeCompare(b.key))).toEqual([
        {
          key: 'capital_needed_above_usd',
          value: CAPITAL_NEEDED_ABOVE_USD_SEED,
          provisional: true,
        },
        { key: 'hold_owner_default', value: HOLD_OWNER_DEFAULT_SEED, provisional: true },
      ]);
    });
  });

  it('switches off "Advance – capital required" and nothing else; the row and its label stay', async () => {
    await rolledBack(async (tx) => {
      await preFb17(tx);
      await runMigration(tx);
      const after = await outcomes(tx);
      const off = [...after.values()].filter((r) => !r.active);
      expect(off.map((r) => `${r.gate_key}/${r.key}`)).toEqual(['G2/capital_required']);
      expect(after.get('G2/capital_required')).toMatchObject({
        label: 'Advance – capital required',
        outcome_group: 'advance',
      });
    });
  });

  it('groups: the four choices, G5 as the customer answer, every hold a hold', async () => {
    await rolledBack(async (tx) => {
      await preFb17(tx);
      await runMigration(tx);
      const after = await outcomes(tx);
      const group = (id: string) => after.get(id)!.outcome_group;
      expect(group('G1/redirect')).toBe('stop');
      expect(group('G2/redirect')).toBe('send_back');
      expect(group('G3/recost')).toBe('send_back');
      expect(group('G4/return')).toBe('send_back');
      expect(group('G6/requote')).toBe('send_back');
      expect(group('G5/requote')).toBe('customer_outcome');
      expect(group('G5/on_hold')).toBe('hold');
      for (const [id, row] of after) {
        if (row.outcome_group === 'hold') expect(row.help_text, id).toBe(HOLD_HELP);
        if (row.outcome_group === 'send_back') {
          expect([row.requires_reason_code, row.reason_context !== null], id).toEqual([true, true]);
        }
      }
    });
  });

  it('keeps what the business approved; only the group (a new column) is filled in', async () => {
    await rolledBack(async (tx) => {
      await preFb17(tx);
      await tx.execute(sql`UPDATE gate_outcome_definition SET approved_at = now()`);
      const before = await outcomes(tx);
      await runMigration(tx);
      const after = await outcomes(tx);
      for (const [id, row] of after) {
        const o = hybridConfig.outcomes.find((x) => `${x.gateKey}/${x.key}` === id)!;
        expect(row, id).toEqual({ ...before.get(id)!, outcome_group: o.outcomeGroup });
      }
      // In particular the approved "Advance – capital required" stays on, with the old G2 rules.
      expect(after.get('G2/capital_required')!.active).toBe(true);
      expect(after.get('G2/proceed')!.required_fields).toEqual(OLD_G2_ADVANCE_RULES);
    });
  });

  it('keeps what an Admin changed: a label, a help text, a rule, a group and a setting', async () => {
    await rolledBack(async (tx) => {
      await preFb17(tx);
      const adminRules = OLD_G2_ADVANCE_RULES.slice(0, 5);
      await tx.execute(sql`
        UPDATE gate_outcome_definition SET label = 'Return to the KAM', version = 2
        WHERE gate_key = 'G1' AND key = 'rework'`);
      await tx.execute(sql`
        UPDATE gate_outcome_definition SET help_text = 'Admin wording', version = 2
        WHERE gate_key = 'G2' AND key = 'hold'`);
      await tx.execute(sql`
        UPDATE gate_outcome_definition
        SET required_fields = ${JSON.stringify(adminRules)}::jsonb, version = 2
        WHERE gate_key = 'G2' AND key = 'proceed'`);
      await tx.execute(sql`
        UPDATE gate_outcome_definition SET outcome_group = 'send_back'
        WHERE gate_key = 'G5' AND key = 'requote'`);
      await tx.execute(sql`
        UPDATE gate_outcome_definition SET requires_reason_code = true, reason_context = 'stop'
        WHERE gate_key = 'G3' AND key = 'redirect'`);
      await runMigration(tx);
      const after = await outcomes(tx);
      expect(after.get('G1/rework')!.label).toBe('Return to the KAM');
      expect(after.get('G2/hold')!.help_text).toBe('Admin wording');
      expect(after.get('G2/proceed')!.required_fields).toEqual(adminRules);
      // The seed files G5 "Re-quote" under the customer's answer; a group already set is not replaced.
      expect(after.get('G5/requote')!.outcome_group).toBe('send_back');
      expect(after.get('G3/redirect')).toMatchObject({
        requires_reason_code: true,
        reason_context: 'stop',
      });
      // The untouched neighbours still moved.
      expect(after.get('G2/rework')!.label).toBe('Send back to the KAM (fix the intake)');
      expect(after.get('G2/proceed_with_risk')!.required_fields).toEqual(
        seeded('G2', 'proceed_with_risk').requiredFields,
      );
    });
    await rolledBack(async (tx) => {
      await preFb17(tx);
      await runMigration(tx);
      await tx.execute(sql`
        UPDATE app_setting SET value = '50000'::jsonb, version = 2
        WHERE key = 'capital_needed_above_usd'`);
      await runMigration(tx);
      const [row] = await rows<{ value: unknown }>(
        tx,
        sql`SELECT value FROM app_setting WHERE key = 'capital_needed_above_usd'`,
      );
      expect(row!.value).toBe(50000);
    });
  });

  it('seeds the same values on a fresh database (the config seed)', async () => {
    const fresh = await outcomes(db as never);
    for (const o of hybridConfig.outcomes) {
      expect(fresh.get(`${o.gateKey}/${o.key}`), `${o.gateKey}/${o.key}`).toEqual(seededRow(o));
    }
    const settings = await raw<{ key: string }>(
      db as never,
      sql`SELECT key FROM app_setting
          WHERE key IN ('capital_needed_above_usd', 'hold_owner_default')`,
    );
    expect(settings.map((r) => r.key).sort()).toEqual([...NEW_SETTINGS].sort());
  });

  it('history: a decision recorded with the switched-off outcome still finds its label', async () => {
    const decided = await raw<{ decisions: number; labelled: number }>(
      db as never,
      sql`SELECT count(*)::int AS decisions, count(od.label)::int AS labelled
          FROM gate_decision g
          LEFT JOIN gate_outcome_definition od
            ON od.gate_key = g.gate_key AND od.key = g.outcome_key
          WHERE g.gate_key = 'G2' AND g.outcome_key = 'capital_required'`,
    );
    // The synthetic history holds such decisions (it predates FB-17), and each one resolves.
    expect(decided[0]!.decisions).toBeGreaterThan(0);
    expect(decided[0]!.labelled).toBe(decided[0]!.decisions);
    const label = await raw<{ label: string; active: boolean }>(
      db as never,
      sql`SELECT label, active FROM gate_outcome_definition
          WHERE gate_key = 'G2' AND key = 'capital_required'`,
    );
    expect(label).toEqual([{ label: 'Advance – capital required', active: false }]);
  });
});

describe('migration 0046: the schema half', () => {
  it('adds active (boolean, default true) and outcome_group (text) with Fabric-safe types', async () => {
    const cols = await raw<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      db as never,
      sql`SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'gate_outcome_definition'
            AND column_name IN ('active', 'outcome_group')`,
    );
    const byName = new Map(cols.map((c) => [c.column_name, c]));
    expect(byName.get('active')).toMatchObject({
      data_type: 'boolean',
      is_nullable: 'NO',
      column_default: 'true',
    });
    expect(byName.get('outcome_group')).toMatchObject({
      data_type: 'text',
      is_nullable: 'YES',
      column_default: null,
    });
  });

  it('the group takes the five choices or none, and refuses anything else', async () => {
    await rolledBack(async (tx) => {
      for (const group of ['advance', 'send_back', 'hold', 'stop', 'customer_outcome']) {
        await tx.execute(sql`
          UPDATE gate_outcome_definition SET outcome_group = ${group}
          WHERE gate_key = 'G1' AND key = 'advance'`);
      }
      await tx.execute(sql`
        UPDATE gate_outcome_definition SET outcome_group = null
        WHERE gate_key = 'G1' AND key = 'advance'`);
    });
    expect(
      await pgError(
        db.execute(sql`
          UPDATE gate_outcome_definition SET outcome_group = 'rework'
          WHERE gate_key = 'G1' AND key = 'advance'`),
      ),
    ).toBe('23514');
  });
});
