import { readFileSync } from 'node:fs';

import {
  MACHINE_TYPE_PROCESS_MAP_SEED,
  PACK_OUT_RULE_SEED,
  PERMISSION_MATRIX,
  TWO_STEP_PLANT_MACHINE_TYPES_SEED,
} from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, asPersona, persona, pgError, raw, testDb } from './helpers';
import type { Tx } from '../src/client';
import { uuidv7 } from '../src/ids';

/**
 * FB-16 (0045): the Production Scheduler role end to end in the database.
 *
 * - The hand-written half of the migration re-run in a rolled-back transaction against the state an
 *   environment had before it (the schema half ran in the global setup, with the seed).
 * - The new columns and the widened CHECK lists.
 * - Row-level security: a scheduler sees the quotes they are assigned to as scheduler, not another
 *   scheduler's, and the child rows follow.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0045_fb16_engineering_capacity.sql', import.meta.url),
  'utf8',
);
const DATA = MIGRATION.slice(MIGRATION.indexOf('-- ── FB-16 (hand-written)'));
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

const NEW_SETTINGS = ['machine_type_process_map', 'two_step_plant_machine_types', 'pack_out_rule'];

/** The pre-FB-16 state: no scheduler grants, no capacity.edit, none of the three settings, the old label. */
async function preFb16(tx: Tx) {
  await tx.execute(sql`
    DELETE FROM role_permission WHERE role = 'ProductionScheduler' OR permission = 'capacity.edit'`);
  await tx.execute(sql`
    DELETE FROM app_setting
    WHERE key IN ('machine_type_process_map', 'two_step_plant_machine_types', 'pack_out_rule')`);
  await tx.execute(sql`
    UPDATE stage_definition SET label = 'Engineering Review', approved_at = null, version = 1
    WHERE key = 'ENG_REVIEW'`);
}

async function stageLabel(tx: Tx) {
  const [row] = await rows<{ label: string }>(
    tx,
    sql`SELECT label FROM stage_definition WHERE key = 'ENG_REVIEW'`,
  );
  return row!.label;
}

describe('migration 0045 (FB-16 engineering and capacity): the data half', () => {
  it('has a hand-written half to re-run', () => {
    expect(statements.length).toBeGreaterThanOrEqual(9);
  });

  it('adds the matrix rows, the three settings and the stage label; safe to run twice', async () => {
    await rolledBack(async (tx) => {
      await preFb16(tx);
      await runMigration(tx);
      await runMigration(tx); // idempotent
      const grants = await rows<{ g: string; qualifier: unknown; provisional: boolean }>(
        tx,
        sql`SELECT role || ':' || permission AS g, qualifier, provisional FROM role_permission
            WHERE role = 'ProductionScheduler' OR permission = 'capacity.edit'
            ORDER BY (role || ':' || permission) COLLATE "C"`,
      );
      expect(grants.map((r) => [r.g, r.qualifier])).toEqual([
        ['EngLead:capacity.edit', null],
        ['Engineer:capacity.edit', { kind: 'assigned' }],
        ['ProductionScheduler:capacity.edit', { kind: 'assignedScheduler' }],
        ['ProductionScheduler:capacity.signoff', { kind: 'assignedScheduler' }],
        ['ProductionScheduler:engQueue.read', null],
        ['ProductionScheduler:quote.read', null],
        ['ProductionScheduler:quote.read.commercialFields', null],
      ]);
      expect(grants.every((r) => r.provisional)).toBe(true);
      // The migration writes exactly what the policy matrix (the control) holds for them.
      const matrix = Object.entries(PERMISSION_MATRIX)
        .flatMap(([permission, byRole]) =>
          Object.keys(byRole)
            .filter((role) => role === 'ProductionScheduler' || permission === 'capacity.edit')
            .map((role) => `${role}:${permission}`),
        )
        .sort();
      expect(grants.map((r) => r.g)).toEqual(matrix);

      const settings = await rows<{ key: string; value: unknown; provisional: boolean }>(
        tx,
        sql`SELECT key, value, provisional FROM app_setting
            WHERE key IN ('machine_type_process_map', 'two_step_plant_machine_types', 'pack_out_rule')
            ORDER BY key`,
      );
      expect(settings).toEqual([
        {
          key: 'machine_type_process_map',
          value: MACHINE_TYPE_PROCESS_MAP_SEED,
          provisional: true,
        },
        { key: 'pack_out_rule', value: PACK_OUT_RULE_SEED, provisional: true },
        {
          key: 'two_step_plant_machine_types',
          value: TWO_STEP_PLANT_MACHINE_TYPES_SEED,
          provisional: true,
        },
      ]);
      expect(await stageLabel(tx)).toBe('Engineering & Capacity');
    });
  });

  it('every machine type in the seeded map is an active machine type, every process an active process type', async () => {
    await rolledBack(async (tx) => {
      const active = async (list: string) =>
        (
          await rows<{ code: string }>(
            tx,
            sql`SELECT code FROM value_list WHERE list_key = ${list} AND active`,
          )
        ).map((r) => r.code);
      const machines = await active('machine_type');
      const processes = await active('process_type');
      expect(Object.keys(MACHINE_TYPE_PROCESS_MAP_SEED).sort()).toEqual([...machines].sort());
      for (const process of Object.values(MACHINE_TYPE_PROCESS_MAP_SEED)) {
        expect(processes, process).toContain(process);
      }
      for (const code of [
        ...TWO_STEP_PLANT_MACHINE_TYPES_SEED.preform,
        ...TWO_STEP_PLANT_MACHINE_TYPES_SEED.blow,
      ]) {
        expect(machines, code).toContain(code);
      }
    });
  });

  it('keeps a stage label the business approved, and one an Admin changed', async () => {
    await rolledBack(async (tx) => {
      await preFb16(tx);
      await tx.execute(
        sql`UPDATE stage_definition SET approved_at = now() WHERE key = 'ENG_REVIEW'`,
      );
      await runMigration(tx);
      expect(await stageLabel(tx)).toBe('Engineering Review');
    });
    await rolledBack(async (tx) => {
      await preFb16(tx);
      await tx.execute(
        sql`UPDATE stage_definition SET label = 'Upfront Engineering', version = 2
            WHERE key = 'ENG_REVIEW'`,
      );
      await runMigration(tx);
      expect(await stageLabel(tx)).toBe('Upfront Engineering');
    });
  });

  it('keeps a setting an Admin already holds (e.g. pack-out switched on)', async () => {
    await rolledBack(async (tx) => {
      const edited = { requireOneOf: true, notTogether: [] };
      await tx.execute(sql`
        UPDATE app_setting SET value = ${JSON.stringify(edited)}::jsonb, version = 2
        WHERE key = 'pack_out_rule'`);
      await runMigration(tx);
      const [row] = await rows<{ value: unknown }>(
        tx,
        sql`SELECT value FROM app_setting WHERE key = 'pack_out_rule'`,
      );
      expect(row!.value).toEqual(edited);
    });
  });

  it('seeds the same three settings on a fresh database (the config seed)', async () => {
    const seeded = await raw<{ key: string }>(
      db as never,
      sql`SELECT key FROM app_setting
          WHERE key IN ('machine_type_process_map', 'two_step_plant_machine_types', 'pack_out_rule')`,
    );
    expect(seeded.map((r) => r.key).sort()).toEqual([...NEW_SETTINGS].sort());
  });
});

describe('migration 0045: the schema half', () => {
  it('adds the second assignee, the send-back target and the capacity-ready mark with Fabric-safe types', async () => {
    const cols = await raw<{ table_name: string; column_name: string; data_type: string }>(
      db as never,
      sql`SELECT table_name, column_name, data_type FROM information_schema.columns
          WHERE table_schema = 'public'
            AND (table_name, column_name) IN (
              ('quote', 'assigned_scheduler_id'), ('quote', 'assigned_scheduler_at'),
              ('quote', 'eng_returned_to'), ('eng_review', 'capacity_ready_at'))
          ORDER BY table_name, column_name`,
    );
    expect(cols.map((c) => [c.table_name, c.column_name, c.data_type])).toEqual([
      ['eng_review', 'capacity_ready_at', 'timestamp with time zone'],
      ['quote', 'assigned_scheduler_at', 'timestamp with time zone'],
      ['quote', 'assigned_scheduler_id', 'uuid'],
      ['quote', 'eng_returned_to', 'uuid'],
    ]);
  });

  it('the role and permission CHECK lists take the new role and capacity.edit, and still refuse others', async () => {
    const someone = persona('finance').id;
    await rolledBack(async (tx) => {
      await tx.execute(
        sql`INSERT INTO user_role (id, user_id, role) VALUES (${uuidv7()}, ${someone}, 'ProductionScheduler')`,
      );
      await tx.execute(sql`
        UPDATE role_permission SET permission = 'capacity.edit'
        WHERE role = 'Leadership' AND permission = 'audit.read'`);
    });
    expect(
      await pgError(
        db.execute(
          sql`INSERT INTO user_role (id, user_id, role) VALUES (${uuidv7()}, ${someone}, 'Scheduler')`,
        ),
      ),
    ).toBe('23514');
    expect(
      await pgError(
        db.execute(sql`
          UPDATE role_permission SET permission = 'capacity.approve'
          WHERE role = 'Leadership' AND permission = 'audit.read'`),
      ),
    ).toBe('23514');
  });

  it('the quote policy uses the six-argument function; the five-argument one is gone', async () => {
    const fns = await raw<{ args: number }>(
      db as never,
      sql`SELECT pronargs::int AS args FROM pg_proc WHERE proname = 'app_quote_visible'`,
    );
    expect(fns.map((f) => f.args)).toEqual([6]);
    const [policy] = await raw<{ qual: string }>(
      db as never,
      sql`SELECT qual FROM pg_policies WHERE tablename = 'quote' AND policyname = 'quote_app'`,
    );
    expect(policy!.qual).toContain('assigned_scheduler_id');
  });
});

describe('RLS: the production scheduler', () => {
  const scheduler = persona('production-scheduler');
  // Any other user id will do as "another scheduler": RLS reads the request context, not user_role.
  const otherScheduler = persona('finance');
  const ownerScoped = { userId: scheduler.id, roles: ['ProductionScheduler'] as const };
  let mine = '';
  let theirs = '';
  let unassigned = '';
  let total = 0;

  beforeAll(async () => {
    const quotes = await raw<{ id: string }>(
      db as never,
      sql`SELECT id FROM quote WHERE stage_key = 'ENG_REVIEW' AND status <> 'closed'
          ORDER BY quote_number LIMIT 3`,
    );
    expect(quotes).toHaveLength(3);
    [mine, theirs, unassigned] = quotes.map((q) => q.id) as [string, string, string];
    await db.execute(
      sql`UPDATE quote SET assigned_scheduler_id = ${scheduler.id}, assigned_scheduler_at = now()
          WHERE id = ${mine}`,
    );
    await db.execute(
      sql`UPDATE quote SET assigned_scheduler_id = ${otherScheduler.id}, assigned_scheduler_at = now()
          WHERE id = ${theirs}`,
    );
    const [n] = await raw<{ n: number }>(db as never, sql`SELECT count(*)::int AS n FROM quote`);
    total = n!.n;
  });
  afterAll(async () => {
    await db.execute(
      sql`UPDATE quote SET assigned_scheduler_id = null, assigned_scheduler_at = null
          WHERE id IN (${mine}, ${theirs})`,
    );
  });

  it('owner scope: sees the quote assigned to them as scheduler, not another scheduler’s or an unassigned one', async () => {
    await as(db, { ...ownerScoped, scope: { type: 'owner' } }, async (tx) => {
      const seen = await raw<{ id: string }>(tx, sql`SELECT id FROM quote`);
      expect(seen.map((r) => r.id)).toEqual([mine]);
      expect(await raw(tx, sql`SELECT 1 FROM quote WHERE id = ${theirs}`)).toHaveLength(0);
      expect(await raw(tx, sql`SELECT 1 FROM quote WHERE id = ${unassigned}`)).toHaveLength(0);
    });
  });

  it('child rows follow the quote', async () => {
    await as(db, { ...ownerScoped, scope: { type: 'owner' } }, async (tx) => {
      for (const table of ['stage_history', 'eng_review', 'capacity_evidence', 'activity_event']) {
        const other = await raw(
          tx,
          sql`SELECT 1 FROM ${sql.identifier(table)} WHERE quote_id IN (${theirs}, ${unassigned})`,
        );
        expect(other, table).toHaveLength(0);
      }
      const own = await raw(tx, sql`SELECT 1 FROM stage_history WHERE quote_id = ${mine}`);
      expect(own.length).toBeGreaterThan(0);
    });
  });

  it('owner scope: cannot change another scheduler’s quote, or take one over (zero rows, WITH CHECK)', async () => {
    await as(db, { ...ownerScoped, scope: { type: 'owner' } }, async (tx) => {
      const updated = await raw(
        tx,
        sql`UPDATE quote SET description = 'hijacked' WHERE id = ${theirs} RETURNING id`,
      );
      expect(updated).toHaveLength(0);
    });
    // Handing their own quote to someone else would make the row invisible to them: refused.
    const code = await pgError(
      as(db, { ...ownerScoped, scope: { type: 'owner' } }, (tx) =>
        raw(
          tx,
          sql`UPDATE quote SET assigned_scheduler_id = ${otherScheduler.id} WHERE id = ${mine}`,
        ),
      ),
    );
    expect(code).toBe('42501');
  });

  it('owner scope: an Engineer is not let in through the scheduler column, nor a scheduler through the engineer column', async () => {
    await as(
      db,
      { userId: scheduler.id, roles: ['Engineer'], scope: { type: 'owner' } },
      async (tx) => {
        expect(await raw(tx, sql`SELECT 1 FROM quote WHERE id = ${mine}`)).toHaveLength(0);
      },
    );
    const [assigned] = await raw<{ id: string; assigned_engineer_id: string }>(
      db as never,
      sql`SELECT id, assigned_engineer_id FROM quote
          WHERE assigned_engineer_id IS NOT NULL AND assigned_scheduler_id IS NULL LIMIT 1`,
    );
    await as(
      db,
      {
        userId: assigned!.assigned_engineer_id,
        roles: ['ProductionScheduler'],
        scope: { type: 'owner' },
      },
      async (tx) => {
        expect(await raw(tx, sql`SELECT 1 FROM quote WHERE id = ${assigned!.id}`)).toHaveLength(0);
      },
    );
  });

  it('scope all (the dev persona): reads every quote, as an Engineer with scope all does', async () => {
    await asPersona(db, 'production-scheduler', async (tx) => {
      const [n] = await raw<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM quote`);
      expect(n!.n).toBe(total);
    });
  });

  it('reads the pricing-app history like every role that reads commercial fields (rule 2)', async () => {
    const [all] = await raw<{ n: number }>(
      db as never,
      sql`SELECT count(*)::int AS n FROM pricing_history_record`,
    );
    await asPersona(db, 'production-scheduler', async (tx) => {
      const [n] = await raw<{ n: number }>(
        tx,
        sql`SELECT count(*)::int AS n FROM pricing_history_record`,
      );
      expect(n!.n).toBe(all!.n);
    });
  });
});
