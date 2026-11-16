import { readFileSync } from 'node:fs';

import {
  ERF_COSTING_TEMPLATE_SEED,
  MODEL_SUMMARY_TEMPLATES_SEED,
  OFFER_LETTER_TEMPLATE_SEED,
  PERMISSION_MATRIX,
} from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { raw, testDb } from './helpers';
import type { Tx } from '../src/client';

/**
 * FB-20 data migration (0048's hand-written INSERT / UPDATE statements) re-run in a rolled-back
 * transaction against the state an environment had before it: no offer-letter settings or grants, and
 * the FB-14 costing map without the offer piece price. The schema half ran in the global setup.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0048_fb20_offer_letter.sql', import.meta.url),
  'utf8',
);
const DATA = MIGRATION.slice(MIGRATION.indexOf('-- ── FB-20 (hand-written)'));
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

const json = <T>(v: T): unknown => JSON.parse(JSON.stringify(v));

/** The costing map as FB-14 seeded it: no offer piece price, the FB-14 note. */
const PRE_FB20_TEMPLATES = json(
  MODEL_SUMMARY_TEMPLATES_SEED.map((t) =>
    t.templateId === ERF_COSTING_TEMPLATE_SEED.templateId
      ? {
          ...t,
          note: t.note!.replace(/ FB-20: .*$/, ''),
          fields: t.fields.filter((f) => f.key !== 'offer_piece_price'),
        }
      : t,
  ),
);

async function toPreFb20State(tx: Tx) {
  await tx.execute(sql`delete from app_setting where key like 'offer_letter_%'`);
  await tx.execute(
    sql`delete from role_permission where permission in ('offer.read', 'offer.generate')`,
  );
  await tx.execute(
    sql`update app_setting set value = ${JSON.stringify(PRE_FB20_TEMPLATES)}::jsonb, version = 1, approved_at = null
        where key = 'model_summary_templates'`,
  );
}

const settings = (tx: Tx) =>
  raw<{ key: string; value: unknown; provisional: boolean }>(
    tx,
    sql`select key, value, provisional from app_setting where key like 'offer_letter_%' order by key`,
  );
const templates = async (tx: Tx) =>
  (
    await raw<{ value: unknown }>(
      tx,
      sql`select value from app_setting where key = 'model_summary_templates'`,
    )
  )[0]!.value;
const grants = (tx: Tx) =>
  raw<{ role: string; permission: string; qualifier: unknown }>(
    tx,
    sql`select role, permission, qualifier from role_permission where permission like 'offer.%'`,
  );
const byKey = (g: { permission: string; role: string }) => `${g.permission}:${g.role}`;
const sorted = <T extends { permission: string; role: string }>(list: T[]) =>
  [...list].sort((a, b) => byKey(a).localeCompare(byKey(b)));

describe('0048 FB-20 data migration', () => {
  it('has the statements it is meant to have, and makes the letter tables insert-only', () => {
    expect(statements).toHaveLength(3);
    expect(MIGRATION).toMatch(
      /REVOKE UPDATE, DELETE, TRUNCATE ON "offer_letter", "offer_letter_item" FROM ccq_app/,
    );
    expect(MIGRATION).toMatch(/ALTER TABLE "offer_letter" FORCE ROW LEVEL SECURITY/);
    expect(MIGRATION).toMatch(/ALTER TABLE "offer_letter_item" FORCE ROW LEVEL SECURITY/);
  });

  it('on a seeded database: adds the settings as the seed, the grants as the matrix, and the piece price to the costing map', async () => {
    await rolledBack(async (tx) => {
      await toPreFb20State(tx);
      expect(await settings(tx)).toEqual([]);
      await runMigration(tx);
      expect(await settings(tx)).toEqual([
        { key: 'offer_letter_block_if_costing_changed', value: true, provisional: true },
        {
          key: 'offer_letter_template',
          value: json(OFFER_LETTER_TEMPLATE_SEED),
          provisional: true,
        },
        { key: 'offer_letter_wording_approved', value: false, provisional: true },
      ]);
      expect(await templates(tx)).toEqual(json(MODEL_SUMMARY_TEMPLATES_SEED));
      const expected = (['offer.generate', 'offer.read'] as const).flatMap((p) =>
        Object.entries(PERMISSION_MATRIX[p]).map(([role, grant]) => ({
          role,
          permission: p,
          qualifier: grant === true ? null : grant,
        })),
      );
      expect(sorted(await grants(tx))).toEqual(sorted(expected));
      // Idempotent: a second run adds nothing and does not add the field twice.
      await runMigration(tx);
      expect(await settings(tx)).toHaveLength(3);
      expect(await templates(tx)).toEqual(json(MODEL_SUMMARY_TEMPLATES_SEED));
    });
  });

  it('leaves an Admin-edited or approved costing map, and an existing setting, alone', async () => {
    await rolledBack(async (tx) => {
      await toPreFb20State(tx);
      await tx.execute(
        sql`update app_setting set version = 2 where key = 'model_summary_templates'`,
      );
      await tx.execute(
        sql`insert into app_setting (id, key, value, description, provisional)
            values (gen_random_uuid(), 'offer_letter_wording_approved', 'true'::jsonb, 'Legal approved', false)`,
      );
      await runMigration(tx);
      expect(await templates(tx)).toEqual(PRE_FB20_TEMPLATES);
      const [w] = await raw<{ value: unknown }>(
        tx,
        sql`select value from app_setting where key = 'offer_letter_wording_approved'`,
      );
      expect(w!.value).toBe(true);
      await tx.execute(
        sql`update app_setting set version = 1, approved_at = now() where key = 'model_summary_templates'`,
      );
      await runMigration(tx);
      expect(await templates(tx)).toEqual(PRE_FB20_TEMPLATES);
    });
  });

  it('on an empty database: inserts nothing (the config seed does that)', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`delete from app_setting`);
      await tx.execute(sql`delete from role_permission`);
      await runMigration(tx);
      expect(await raw(tx, sql`select 1 from app_setting`)).toEqual([]);
      expect(await raw(tx, sql`select 1 from role_permission`)).toEqual([]);
    });
  });
});
