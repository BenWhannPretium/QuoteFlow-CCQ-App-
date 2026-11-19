import { readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { raw, testDb } from './helpers';
import {
  ATTACHMENT_KINDS_BY_PLACE,
  INTAKE_ALLOWED_REQUEST_CLASSES,
  INTAKE_MIN_SPEC_EXEMPT_CLASSES,
  SHIP_TO_SOURCES,
} from '../seeds/config/settings';
import type { Tx } from '../src/client';

/**
 * FB-24 (0051): the intake feedback of 2026-11-17/18 in existing environments.
 *
 * - decoration_types back-filled from the deprecated decoration_type on quotes and items, with the Fabric
 *   text companion; open drafts' items get decorationTypes.
 * - Concept / innovation and Soldier pack added (provisional); keepOrder on the two ordered lists; the
 *   Decoration follow-up renamed; CONCEPT submittable; the three new settings.
 * - An approved or Admin-edited row is left alone; a database with no config is untouched.
 *
 * The migration ran in the global setup (an empty database, then the seed); each test re-runs its data
 * statements in a rolled-back transaction from the state an environment had before it.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0051_fb24_intake.sql', import.meta.url),
  'utf8',
);
const DATA = MIGRATION.slice(MIGRATION.indexOf('-- ── FB-24 (hand-written)'));
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

const NEW_SETTINGS = [
  'intake_min_spec_exempt_classes',
  'ship_to_sources',
  'attachment_kinds_by_place',
];

/** Before FB-24: no new settings or entries, CCQ only, the old follow-up, no keepOrder. */
async function preFb24(tx: Tx) {
  await tx.execute(
    sql`delete from app_setting where key in ('intake_min_spec_exempt_classes', 'ship_to_sources', 'attachment_kinds_by_place')`,
  );
  await tx.execute(
    sql`update app_setting set value = '["CCQ"]'::jsonb where key = 'intake_allowed_request_classes'`,
  );
  await tx.execute(
    sql`delete from value_list where (list_key, code) in (('request_class', 'CONCEPT'), ('packaging_type', 'SOLDIER_PACK'))`,
  );
  await tx.execute(
    sql`update value_list set meta = jsonb_set(meta, '{followUps}', '["decoration_type","decoration_print_colors"]'::jsonb)
        where list_key = 'component' and code = 'DECORATION'`,
  );
  await tx.execute(
    sql`update value_list set meta = meta - 'keepOrder' where list_key in ('drawing_status', 'tooling_payment_terms')`,
  );
}

const setting = async (tx: Tx, key: string) =>
  (await raw<{ value: unknown }>(tx, sql`select value from app_setting where key = ${key}`))[0]
    ?.value;
const entry = async (tx: Tx, list: string, code: string) =>
  (
    await raw<{ label: string; meta: Record<string, unknown>; provisional: boolean }>(
      tx,
      sql`select label, meta, provisional from value_list where list_key = ${list} and code = ${code}`,
    )
  )[0];

describe('0051 config in a configured environment', () => {
  it('adds the settings, the entries and the flags as the seed has them', async () => {
    await rolledBack(async (tx) => {
      await preFb24(tx);
      await runMigration(tx);
      expect(await setting(tx, 'intake_allowed_request_classes')).toEqual(
        INTAKE_ALLOWED_REQUEST_CLASSES,
      );
      expect(await setting(tx, 'intake_min_spec_exempt_classes')).toEqual(
        INTAKE_MIN_SPEC_EXEMPT_CLASSES,
      );
      expect(await setting(tx, 'ship_to_sources')).toEqual(SHIP_TO_SOURCES);
      // 0051's lists (FB-26's migration adds the hand-off place after it, so today's seed has one more).
      const { handoff: _handoff, ...fb24Lists } = ATTACHMENT_KINDS_BY_PLACE;
      expect(await setting(tx, 'attachment_kinds_by_place')).toEqual(fb24Lists);
      expect(await entry(tx, 'request_class', 'CONCEPT')).toMatchObject({
        label: 'Concept / innovation',
        provisional: true,
      });
      expect(await entry(tx, 'packaging_type', 'SOLDIER_PACK')).toMatchObject({
        label: 'Soldier pack',
        provisional: true,
      });
      expect((await entry(tx, 'component', 'DECORATION'))!.meta.followUps).toEqual([
        'decoration_types',
        'decoration_print_colors',
      ]);
      expect((await entry(tx, 'drawing_status', 'COMING'))!.meta.keepOrder).toBe(true);
      expect((await entry(tx, 'tooling_payment_terms', 'UPFRONT'))!.meta.keepOrder).toBe(true);
      const help = (await setting(tx, 'intake_field_help')) as Record<string, string>;
      expect(help.concept_assumptions).toBeTruthy();
      expect(help.request_class).toContain('Concept / innovation');
      // Running it again changes nothing.
      const before = await raw(tx, sql`select key, value from app_setting order by key`);
      await runMigration(tx);
      expect(await raw(tx, sql`select key, value from app_setting order by key`)).toEqual(before);
    });
  });

  it('leaves an Admin-edited or approved row alone', async () => {
    await rolledBack(async (tx) => {
      await preFb24(tx);
      await tx.execute(
        sql`update app_setting set value = '["CCQ","STOCK"]'::jsonb where key = 'intake_allowed_request_classes'`,
      );
      await tx.execute(
        sql`update value_list set approved_at = now() where list_key = 'drawing_status'`,
      );
      await tx.execute(
        sql`update value_list set meta = jsonb_set(meta, '{followUps}', '["decoration_type"]'::jsonb)
            where list_key = 'component' and code = 'DECORATION'`,
      );
      await runMigration(tx);
      expect(await setting(tx, 'intake_allowed_request_classes')).toEqual(['CCQ', 'STOCK']);
      expect((await entry(tx, 'drawing_status', 'COMING'))!.meta.keepOrder).toBeUndefined();
      // The app reads the old follow-up name as the new one (config-sources).
      expect((await entry(tx, 'component', 'DECORATION'))!.meta.followUps).toEqual([
        'decoration_type',
      ]);
    });
  });

  it('a database with no config yet is untouched (the seed inserts the same values)', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`delete from value_list`);
      await tx.execute(sql`delete from app_setting`);
      await runMigration(tx);
      expect(await raw(tx, sql`select 1 from value_list`)).toEqual([]);
      expect(
        await raw(
          tx,
          sql`select key from app_setting where key in ${sql.raw(`('${NEW_SETTINGS.join("','")}')`)}`,
        ),
      ).toEqual([]);
    });
  });
});

describe('0051 data: decoration types', () => {
  it('back-fills decoration_types and its Fabric companion from the single code', async () => {
    await rolledBack(async (tx) => {
      const [q] = await raw<{ id: string }>(tx, sql`select id from quote order by id limit 1`);
      const [i] = await raw<{ id: string }>(tx, sql`select id from quote_item order by id limit 1`);
      await tx.execute(
        sql`update quote set decoration_type = 'HOT_STAMP', decoration_types = '{}' where id = ${q!.id}`,
      );
      await tx.execute(
        sql`update quote_item set decoration_type = 'SILK_SCREEN', decoration_types = '{}' where id = ${i!.id}`,
      );
      await runMigration(tx);
      const [quote] = await raw<{ t: string[]; json: string }>(
        tx,
        sql`select decoration_types as t, decoration_types_json as json from quote where id = ${q!.id}`,
      );
      expect(quote!.t).toEqual(['HOT_STAMP']);
      expect(JSON.parse(quote!.json)).toEqual(['HOT_STAMP']);
      const [item] = await raw<{ t: string[]; json: string }>(
        tx,
        sql`select decoration_types as t, decoration_types_json as json from quote_item where id = ${i!.id}`,
      );
      expect(item!.t).toEqual(['SILK_SCREEN']);
      expect(JSON.parse(item!.json)).toEqual(['SILK_SCREEN']);
      // Every row has its companion.
      expect(await raw(tx, sql`select 1 from quote where decoration_types_json is null`)).toEqual(
        [],
      );
    });
  });

  it("moves an open draft item's decorationType into decorationTypes", async () => {
    await rolledBack(async (tx) => {
      const [owner] = await raw<{ id: string }>(
        tx,
        sql`select id from app_user order by id limit 1`,
      );
      const data = {
        requestClass: 'CCQ',
        items: [
          { key: '0193f2a0-0000-4000-8000-000000000001', decorationType: 'SHRINK_SLEEVE' },
          { key: '0193f2a0-0000-4000-8000-000000000002', decorationTypes: ['HOT_STAMP'] },
          { key: '0193f2a0-0000-4000-8000-000000000003' },
        ],
      };
      const [draft] = await raw<{ id: string }>(
        tx,
        sql`insert into quote_draft (id, owner_user_id, data, step)
            values (gen_random_uuid(), ${owner!.id}, ${JSON.stringify(data)}::jsonb, 3) returning id`,
      );
      await runMigration(tx);
      const [after] = await raw<{ data: { items: Record<string, unknown>[] } }>(
        tx,
        sql`select data from quote_draft where id = ${draft!.id}`,
      );
      expect(after!.data.items).toEqual([
        { key: '0193f2a0-0000-4000-8000-000000000001', decorationTypes: ['SHRINK_SLEEVE'] },
        { key: '0193f2a0-0000-4000-8000-000000000002', decorationTypes: ['HOT_STAMP'] },
        { key: '0193f2a0-0000-4000-8000-000000000003' },
      ]);
    });
  });
});
