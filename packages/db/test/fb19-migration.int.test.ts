import { readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { testDb } from './helpers';
import type { Tx } from '../src/client';
import { uuidv7 } from '../src/ids';

/**
 * FB-19 (0047): multi-item quotes, in the database.
 *
 * The data half of the migration (item 1 for every quote, the review, capacity and drawing rows pointed at
 * it, the drafts' items) is re-run in a rolled-back transaction against the state an environment had
 * before 0047, twice: the second run changes nothing. The schema half ran in the global setup on an
 * empty database (so the migration is a no-op there), then the seed.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0047_fb19_multi_item_quotes.sql', import.meta.url),
  'utf8',
);
const statementsBetween = (from: string, to: string) =>
  MIGRATION.slice(MIGRATION.indexOf(from), MIGRATION.indexOf(to))
    .split('--> statement-breakpoint')
    .filter((s) => s.replace(/--.*$/gm, '').trim() !== '');
/** Item 1 for every quote, the review / capacity / drawing rows, the drafts' items. */
const DATA = statementsBetween(
  "-- Existing quotes: item 1 from the quote's own columns",
  '-- Now that every row has its item',
);
const SETTINGS = statementsBetween('-- The settings (provisional', "-- B-07's unique index");

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
const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute(q)) as unknown as T[];
const run = async (tx: Tx, statements: string[]) => {
  for (const s of statements) await tx.execute(sql.raw(s));
};

/** The state before 0047: no items, no item ids, drafts with flat product fields. */
async function pre0047(tx: Tx) {
  await tx.execute(sql`alter table eng_review alter column quote_item_id drop not null`);
  await tx.execute(sql`alter table capacity_evidence alter column quote_item_id drop not null`);
  await tx.execute(sql`update eng_review set quote_item_id = null`);
  await tx.execute(sql`update capacity_evidence set quote_item_id = null`);
  await tx.execute(sql`update attachment set quote_item_id = null`);
  await tx.execute(sql`delete from quote_item_drawing`);
  await tx.execute(sql`delete from quote_item`);
  const [kam] = await rows<{ kam_user_id: string; sf_opportunity_id: string }>(
    tx,
    sql`select kam_user_id, sf_opportunity_id from quote limit 1`,
  );
  // A draft saved before FB-19 (flat), and one with nothing in it yet.
  await tx.execute(sql`
    insert into quote_draft (id, owner_user_id, sf_opportunity_id, step, data)
    values
      (${uuidv7()}, ${kam!.kam_user_id}, ${kam!.sf_opportunity_id}, 3,
       ${JSON.stringify({ market: 'FOOD', resin: 'HDPE', containerSize: '16 oz', estAnnualVolume: 250000, sfPrefill: { resin: 'HDPE' } })}::jsonb),
      (${uuidv7()}, ${kam!.kam_user_id}, ${kam!.sf_opportunity_id}, 1, '{}'::jsonb)`);
}

describe('migration 0047: items for existing quotes and drafts', () => {
  it('gives every quote item 1 from its own columns, and points its rows at it', async () => {
    await rolledBack(async (tx) => {
      await pre0047(tx);
      await run(tx, DATA);
      const [quotes] = await rows<{ n: number }>(tx, sql`select count(*)::int as n from quote`);
      const [items] = await rows<{ n: number; quotes: number; ones: number }>(
        tx,
        sql`select count(*)::int as n, count(distinct quote_id)::int as quotes,
                   count(*) filter (where item_no = 1)::int as ones from quote_item`,
      );
      expect(quotes!.n).toBeGreaterThan(0);
      expect(items).toEqual({ n: quotes!.n, quotes: quotes!.n, ones: quotes!.n });
      // Item 1 holds the quote's product columns (the size and standard come from structured_description).
      const [mismatch] = await rows<{ n: number }>(
        tx,
        sql`select count(*)::int as n from quote q join quote_item qi on qi.quote_id = q.id
            where qi.product_family is distinct from q.product_family
               or qi.resin is distinct from q.resin
               or qi.components is distinct from q.components
               or qi.est_annual_volume is distinct from q.est_annual_volume
               or qi.neck_diameter is distinct from q.neck_diameter
               or qi.drawing_status is distinct from q.drawing_status
               or qi.product_needed_by is distinct from q.product_needed_by
               or qi.container_size is distinct from nullif(btrim(q.structured_description->>'size'), '')`,
      );
      expect(mismatch!.n).toBe(0);
      // Fabric: the companion is filled by the trigger.
      const [companion] = await rows<{ n: number }>(
        tx,
        sql`select count(*)::int as n from quote_item where components_json is distinct from to_jsonb(components)::text`,
      );
      expect(companion!.n).toBe(0);
      for (const table of ['eng_review', 'capacity_evidence']) {
        const [left] = await rows<{ n: number }>(
          tx,
          sql`select count(*)::int as n from ${sql.identifier(table)} t
              where t.quote_item_id is distinct from
                (select qi.id from quote_item qi where qi.quote_id = t.quote_id and qi.item_no = 1)`,
        );
        expect(left!.n, table).toBe(0);
      }
      const [drawings] = await rows<{ n: number; other: number }>(
        tx,
        sql`select count(*) filter (where kind in ('bottle_drawing', 'spec', 'competitor_drawing') and quote_id is not null and quote_item_id is null)::int as n,
                   count(*) filter (where kind not in ('bottle_drawing', 'spec', 'competitor_drawing') and quote_item_id is not null)::int as other
            from attachment`,
      );
      expect(drawings).toEqual({ n: 0, other: 0 });
    });
  });

  it("moves a flat draft's product fields into items[0] and leaves the request at the top", async () => {
    await rolledBack(async (tx) => {
      await pre0047(tx);
      await run(tx, DATA);
      const drafts = await rows<{ data: Record<string, unknown>; step: number }>(
        tx,
        sql`select data, step from quote_draft where step in (1, 3) order by step`,
      );
      const flat = drafts.find((d) => d.step === 3)!.data;
      expect(flat).toMatchObject({ market: 'FOOD' });
      expect(flat).not.toHaveProperty('resin');
      expect(flat).not.toHaveProperty('sfPrefill');
      const items = flat.items as Record<string, unknown>[];
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        resin: 'HDPE',
        containerSize: '16 oz',
        estAnnualVolume: 250000,
        sfPrefill: { resin: 'HDPE' },
      });
      expect(items[0]!.key).toMatch(/^[0-9a-f-]{36}$/);
      const empty = drafts.find((d) => d.step === 1)!.data;
      expect((empty.items as unknown[]).length).toBe(1);
    });
  });

  it('is idempotent: a second run changes nothing', async () => {
    await rolledBack(async (tx) => {
      await pre0047(tx);
      await run(tx, DATA);
      const snapshot = async () =>
        rows(
          tx,
          sql`select
                (select count(*)::int from quote_item) as items,
                (select string_agg(id::text || quote_item_id::text, ',' order by id) from eng_review) as reviews,
                (select string_agg(id::text || coalesce(quote_item_id::text, ''), ',' order by id) from attachment) as files,
                (select string_agg(data::text, ',' order by id) from quote_draft) as drafts`,
        );
      const first = await snapshot();
      await run(tx, DATA);
      expect(await snapshot()).toEqual(first);
    });
  });

  it('on the seeded database (items already there) the data half adds nothing', async () => {
    await rolledBack(async (tx) => {
      // Only drafts with items (a draft written raw by another test has none and would be backfilled).
      const snapshot = () =>
        rows(
          tx,
          sql`select (select count(*)::int from quote_item) as items,
                     (select string_agg(id::text || quote_item_id::text, ',' order by id) from eng_review) as reviews,
                     (select string_agg(data::text, ',' order by id) from quote_draft where data ? 'items') as drafts`,
        );
      const before = await snapshot();
      await run(tx, DATA);
      expect(await snapshot()).toEqual(before);
    });
  });

  it('adds the settings only to a configured database, and never overwrites one', async () => {
    await rolledBack(async (tx) => {
      // An environment without config (an empty database): nothing is inserted.
      await tx.execute(
        sql`delete from app_setting where key in ('quote_items_max', 'opportunity_active_quotes', 'opportunity_active_quote_message')`,
      );
      await tx.execute(
        sql`create temp table saved_settings on commit drop as select * from app_setting`,
      );
      await tx.execute(sql`delete from app_setting`);
      await run(tx, SETTINGS);
      expect(await rows(tx, sql`select key from app_setting`)).toEqual([]);
      await tx.execute(sql`insert into app_setting select * from saved_settings`);
      // A configured one gets the three, provisional; an edited value is left alone.
      await tx.execute(sql`
        insert into app_setting (id, key, value, description, provisional)
        values (${uuidv7()}, 'quote_items_max', '5'::jsonb, 'edited', false)`);
      await run(tx, SETTINGS);
      const settings = await rows<{ key: string; value: unknown; provisional: boolean }>(
        tx,
        sql`select key, value, provisional from app_setting
            where key in ('quote_items_max', 'opportunity_active_quotes', 'opportunity_active_quote_message')
            order by key`,
      );
      expect(settings.map((s) => [s.key, s.provisional])).toEqual([
        ['opportunity_active_quote_message', true],
        ['opportunity_active_quotes', true],
        ['quote_items_max', false],
      ]);
      expect(settings.find((s) => s.key === 'quote_items_max')!.value).toBe(5);
      expect(settings.find((s) => s.key === 'opportunity_active_quotes')!.value).toBe('warn');
    });
  });

  it('one review row per item; two items of a quote are numbered once each', async () => {
    const [q] = await rows<{ id: string }>(
      db as never,
      sql`select q.id from quote q join quote_item qi on qi.quote_id = q.id and qi.item_no = 1 limit 1`,
    );
    await rolledBack(async (tx) => {
      const dup = tx.execute(
        sql`insert into quote_item (id, quote_id, item_no) values (${uuidv7()}, ${q!.id}, 1)`,
      );
      await expect(dup).rejects.toThrow();
    });
    await rolledBack(async (tx) => {
      const [item1] = await rows<{ id: string }>(
        tx,
        sql`select id from quote_item where quote_id = ${q!.id} and item_no = 1`,
      );
      await tx.execute(sql`
        insert into eng_review (id, quote_id, quote_item_id) values (${uuidv7()}, ${q!.id}, ${item1!.id})
        on conflict do nothing`);
      const second = tx.execute(
        sql`insert into eng_review (id, quote_id, quote_item_id) values (${uuidv7()}, ${q!.id}, ${item1!.id})`,
      );
      await expect(second).rejects.toThrow();
    });
  });

  it('the one-active-quote index is gone', async () => {
    const [idx] = await rows<{ n: number }>(
      db as never,
      sql`select count(*)::int as n from pg_indexes where indexname = 'quote_one_active_per_opportunity_uidx'`,
    );
    expect(idx!.n).toBe(0);
  });
});
