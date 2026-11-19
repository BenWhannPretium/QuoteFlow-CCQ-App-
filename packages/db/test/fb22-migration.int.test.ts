import { readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { raw, testDb } from './helpers';
import { ENG_LEAD_NOTIFY_WHEN_DESCRIPTION } from '../seeds/config/settings';
import type { Tx } from '../src/client';

/**
 * FB-22 (0052): the Engineering tab.
 *
 * - The setting `eng_lead_notify_when` (provisional, seed both_parts), only in a configured database; a
 *   value an Admin set is left alone.
 * - An open quote in Engineering that the engineer submitted while a production scheduler was assigned
 *   keeps reading "Ready for lead review": the scheduler's part is marked in at the same time, with a
 *   system audit row. A quote with no scheduler, a closed quote and one in another stage are untouched.
 *
 * The migration ran in the global setup; each test re-runs it in a rolled-back transaction.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0052_fb22_engineering_tab.sql', import.meta.url),
  'utf8',
);
// Only the hand-written statements: the column DDL above them cannot run twice.
const statements = MIGRATION.slice(MIGRATION.indexOf('-- ── FB-22 (hand-written)'))
  .split('--> statement-breakpoint')
  .filter((s) => s.replace(/--.*$/gm, '').trim() !== '');

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

const setting = async (tx: Tx) =>
  (
    await raw<{ value: unknown; provisional: boolean; description: string }>(
      tx,
      sql`select value, provisional, description from app_setting where key = 'eng_lead_notify_when'`,
    )
  )[0];

describe('0052: eng_lead_notify_when', () => {
  it('is inserted provisional with the seed value and description, and an Admin’s value is kept', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`delete from app_setting where key = 'eng_lead_notify_when'`);
      await runMigration(tx);
      expect(await setting(tx)).toEqual({
        value: 'both_parts',
        provisional: true,
        description: ENG_LEAD_NOTIFY_WHEN_DESCRIPTION,
      });
      await tx.execute(
        sql`update app_setting set value = '"each_part"'::jsonb where key = 'eng_lead_notify_when'`,
      );
      await runMigration(tx);
      expect((await setting(tx))?.value).toBe('each_part');
    });
  });
});

describe('0052: the scheduler’s part of a submitted review', () => {
  it('is marked in (and audited) only on open quotes in Engineering with a scheduler', async () => {
    await rolledBack(async (tx) => {
      const open = await raw<{ id: string }>(
        tx,
        sql`select id from quote where status <> 'closed' order by id limit 3`,
      );
      const [closedRow] = await raw<{ id: string }>(
        tx,
        sql`select id from quote where status = 'closed' order by id limit 1`,
      );
      const [user] = await raw<{ id: string }>(
        tx,
        sql`select id from app_user order by id limit 1`,
      );
      expect(open).toHaveLength(3);
      const [withScheduler, noScheduler, quoting] = open.map((q) => q.id) as [
        string,
        string,
        string,
      ];
      const closed = closedRow!.id;
      const submittedAt = '2026-11-18T15:00:00Z';
      await tx.execute(sql`
        update quote set stage_key = 'ENG_REVIEW', status = 'active', eng_submitted_at = ${submittedAt}::timestamptz,
          assigned_scheduler_id = ${user!.id}, capacity_submitted_at = null, capacity_submitted_by = null
        where id in (${withScheduler}, ${quoting})`);
      await tx.execute(sql`
        update quote set stage_key = 'ENG_REVIEW', status = 'active', eng_submitted_at = ${submittedAt}::timestamptz,
          assigned_scheduler_id = null, capacity_submitted_at = null
        where id = ${noScheduler}`);
      // A closed quote keeps its stage and status; it only gains the two values the back-fill reads.
      await tx.execute(sql`
        update quote set eng_submitted_at = ${submittedAt}::timestamptz,
          assigned_scheduler_id = ${user!.id}, capacity_submitted_at = null
        where id = ${closed}`);
      await tx.execute(sql`update quote set stage_key = 'QUOTING' where id = ${quoting}`);

      await runMigration(tx);
      const after = await raw<{
        id: string;
        capacity_submitted_at: Date | null;
        by: string | null;
      }>(
        tx,
        sql`select id, capacity_submitted_at, capacity_submitted_by as by from quote
            where id in (${withScheduler}, ${noScheduler}, ${closed}, ${quoting})`,
      );
      const of = (id: string) => after.find((r) => r.id === id)!;
      expect(new Date(of(withScheduler).capacity_submitted_at!).toISOString()).toBe(
        '2026-11-18T15:00:00.000Z',
      );
      expect(of(withScheduler).by).toBeNull();
      expect(of(noScheduler).capacity_submitted_at).toBeNull();
      expect(of(closed).capacity_submitted_at).toBeNull();
      expect(of(quoting).capacity_submitted_at).toBeNull();

      const audit = await raw<{ quote_id: string; actor_id: string | null; after: unknown }>(
        tx,
        sql`select quote_id, actor_id, after from audit_event
            where change_reason like 'FB-22 (N17-14)%'`,
      );
      expect(audit.map((a) => a.quote_id)).toEqual([withScheduler]);
      expect(audit[0]!.actor_id).toBeNull();
      expect(audit[0]!.after).toMatchObject({ source: 'migration:0052_fb22_engineering_tab' });

      // Safe to re-run: nothing changes the second time.
      await runMigration(tx);
      const again = await raw<{ n: number }>(
        tx,
        sql`select count(*)::int as n from audit_event where change_reason like 'FB-22 (N17-14)%'`,
      );
      expect(again[0]!.n).toBe(1);
    });
  });
});
