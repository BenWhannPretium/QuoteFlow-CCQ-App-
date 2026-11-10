import { readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { raw, testDb } from './helpers';
import type { Tx } from '../src/client';
import { fb09Report } from '../src/fb09Report';

/**
 * FB-09 data migration (0036's hand-written statements) re-run in a rolled-back transaction against the
 * state an environment had before it: the old resin and PCR lists, no additive list, product family not
 * yet approved and the FB-06 assignment rules still naming the retired resin codes. The schema half of
 * 0036 ran in the global setup.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0036_fb09_value_lists_other.sql', import.meta.url),
  'utf8',
);
const DATA = MIGRATION.slice(MIGRATION.indexOf('-- FB-09 (Data standards and value lists)'));
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

const OLD_RESIN = [
  ['HDPE', 'HDPE'],
  ['PET', 'PET'],
  ['PP', 'PP'],
  ['LDPE', 'LDPE'],
  ['PCR_HDPE', 'PCR-HDPE'],
  ['PCR_PET', 'PCR-PET'],
  ['PETG', 'PETG'],
  ['PVC', 'PVC'],
  ['PS', 'PS'],
  ['BIO_RESIN', 'Bio-resin'],
  ['OTHER', 'Other'],
] as const;
const OLD_PCR = [
  ['0', '0%'],
  ['25', '25%'],
  ['50', '50%'],
  ['100', '100%'],
] as const;
const FB06_RULES = {
  rules: [
    {
      processTypes: ['ISBM', 'RHB', 'IMM'],
      resins: [],
      engineerName: 'Neiberger',
      engineerUserId: null,
      note: 'a',
    },
    {
      processTypes: ['EBM', 'IBM'],
      resins: [],
      engineerName: 'Pasillas',
      engineerUserId: null,
      note: 'b',
    },
    {
      processTypes: [],
      resins: ['PET', 'PCR_PET', 'PETG'],
      engineerName: 'Neiberger',
      engineerUserId: null,
      note: 'c',
    },
    {
      processTypes: [],
      resins: ['HDPE', 'PCR_HDPE', 'PP', 'LDPE'],
      engineerName: 'Pasillas',
      engineerUserId: null,
      note: 'd',
    },
  ],
};

async function toPreFb09State(tx: Tx) {
  await tx.execute(
    sql`delete from value_list where list_key in ('resin', 'pcr_level', 'additive')`,
  );
  for (const [i, [code, label]] of OLD_RESIN.entries()) {
    await tx.execute(
      sql`insert into value_list (id, list_key, code, label, sort, active, meta, provisional)
          values (gen_random_uuid(), 'resin', ${code}, ${label}, ${(i + 1) * 10}, true, '{}'::jsonb, true)`,
    );
  }
  for (const [i, [code, label]] of OLD_PCR.entries()) {
    await tx.execute(
      sql`insert into value_list (id, list_key, code, label, sort, active, meta, provisional)
          values (gen_random_uuid(), 'pcr_level', ${code}, ${label}, ${(i + 1) * 10}, true, '{}'::jsonb, true)`,
    );
  }
  await tx.execute(
    sql`update value_list set provisional = true, approved_by = null, approved_at = null where list_key = 'product_family'`,
  );
  await tx.execute(
    sql`update app_setting set value = ${JSON.stringify(FB06_RULES)}::jsonb, provisional = true,
        approved_at = null, approved_by = null, version = 1 where key = 'engineering_assignment_rules'`,
  );
}

const rows = (tx: Tx, list: string) =>
  raw<{
    code: string;
    label: string;
    sort: number;
    active: boolean;
    provisional: boolean;
    approved_by: string | null;
    approved_at: Date | null;
    meta: Record<string, unknown>;
  }>(
    tx,
    sql`select code, label, sort, active, provisional, approved_by, approved_at, meta
        from value_list where list_key = ${list} order by sort, code`,
  );

describe('0036 FB-09 data migration', () => {
  it('approves product family for Danielle Leu (values unchanged)', async () => {
    await rolledBack(async (tx) => {
      await toPreFb09State(tx);
      await runMigration(tx);
      const family = await rows(tx, 'product_family');
      expect(family.map((r) => r.label)).toEqual([
        'Bottle',
        'Jar',
        'Closure',
        'Preform',
        'Canister/Tub',
        'Handleware',
        'Other',
      ]);
      for (const r of family) {
        expect(r).toMatchObject({ provisional: false });
        expect(r.meta).toMatchObject({ approvedByName: 'Danielle Leu' });
        expect(new Date(r.approved_at!).toISOString().slice(0, 10)).toBe('2026-11-09');
      }
    });
  });

  it('resin: her list and order, approved; the five retired codes are deactivated, not deleted', async () => {
    await rolledBack(async (tx) => {
      await toPreFb09State(tx);
      await runMigration(tx);
      const all = await rows(tx, 'resin');
      const active = all.filter((r) => r.active);
      expect(active.map((r) => r.label)).toEqual(['PET', 'HDPE', 'PP', 'LDPE', 'PS', 'Other']);
      expect(active.every((r) => !r.provisional && r.meta.approvedByName === 'Danielle Leu')).toBe(
        true,
      );
      expect(active.find((r) => r.code === 'OTHER')!.meta).toMatchObject({ freeText: true });
      const retired = all
        .filter((r) => !r.active)
        .map((r) => r.code)
        .sort();
      expect(retired).toEqual(['BIO_RESIN', 'PCR_HDPE', 'PCR_PET', 'PETG', 'PVC']);
      // Retired rows keep their label (old quotes show it).
      expect(all.find((r) => r.code === 'PCR_PET')!.label).toBe('PCR-PET');
    });
  });

  it('PCR: "0% / Virgin", 30 and Other added, still provisional', async () => {
    await rolledBack(async (tx) => {
      await toPreFb09State(tx);
      await runMigration(tx);
      const pcr = await rows(tx, 'pcr_level');
      expect(pcr.map((r) => r.label)).toEqual([
        '0% / Virgin',
        '25%',
        '30%',
        '50%',
        '100%',
        'Other',
      ]);
      expect(pcr.map((r) => r.code)).toEqual(['0', '25', '30', '50', '100', 'OTHER']);
      expect(pcr.every((r) => r.provisional && r.approved_at === null)).toBe(true);
      expect(pcr.find((r) => r.code === 'OTHER')!.meta).toEqual({ freeText: true });
    });
  });

  it('additive: a new provisional list', async () => {
    await rolledBack(async (tx) => {
      await toPreFb09State(tx);
      await runMigration(tx);
      const additive = await rows(tx, 'additive');
      expect(additive.map((r) => r.label)).toEqual([
        'None',
        'UV',
        'Barrier',
        'Antistat',
        'Impact Modifier',
        'Other',
      ]);
      expect(additive.every((r) => r.active && r.provisional && r.approved_at === null)).toBe(true);
      expect(additive.find((r) => r.code === 'OTHER')!.meta).toEqual({ freeText: true });
    });
  });

  it('does not touch the market list (FB-12)', async () => {
    await rolledBack(async (tx) => {
      await toPreFb09State(tx);
      const before = await rows(tx, 'market');
      await runMigration(tx);
      expect(await rows(tx, 'market')).toEqual(before);
    });
  });

  it('removes retired resin codes from the FB-06 rules; PET → Neiberger, HDPE / PP / LDPE → Pasillas', async () => {
    await rolledBack(async (tx) => {
      await toPreFb09State(tx);
      await runMigration(tx);
      const [row] = await raw<{ value: { rules: { resins: string[]; engineerName: string }[] } }>(
        tx,
        sql`select value from app_setting where key = 'engineering_assignment_rules'`,
      );
      expect(row!.value.rules.map((r) => r.resins)).toEqual([
        [],
        [],
        ['PET'],
        ['HDPE', 'PP', 'LDPE'],
      ]);
      expect(row!.value.rules.map((r) => r.engineerName)).toEqual([
        'Neiberger',
        'Pasillas',
        'Neiberger',
        'Pasillas',
      ]);
    });
  });

  it('leaves an Admin-edited assignment rule row alone', async () => {
    await rolledBack(async (tx) => {
      await toPreFb09State(tx);
      await tx.execute(
        sql`update app_setting set version = 2 where key = 'engineering_assignment_rules'`,
      );
      await runMigration(tx);
      const [row] = await raw<{ value: unknown }>(
        tx,
        sql`select value from app_setting where key = 'engineering_assignment_rules'`,
      );
      expect(row!.value).toEqual(FB06_RULES);
    });
  });

  it('D-016 defaults: packaging Other asks for the note; the cap and plant standards settings are provisional', async () => {
    await rolledBack(async (tx) => {
      await toPreFb09State(tx);
      await tx.execute(
        sql`update value_list set meta = '{}'::jsonb where list_key = 'packaging_type' and code = 'OTHER'`,
      );
      await tx.execute(
        sql`delete from app_setting where key in ('intake_free_text_max_length', 'plant_packaging_standards')`,
      );
      await runMigration(tx);
      const [other] = await rows(tx, 'packaging_type').then((r) =>
        r.filter((x) => x.code === 'OTHER'),
      );
      expect(other!.meta).toEqual({ freeText: true });
      const settings = await raw<{ key: string; value: unknown; provisional: boolean }>(
        tx,
        sql`select key, value, provisional from app_setting
            where key in ('intake_free_text_max_length', 'plant_packaging_standards') order by key`,
      );
      expect(settings).toEqual([
        { key: 'intake_free_text_max_length', value: 500, provisional: true },
        { key: 'plant_packaging_standards', value: {}, provisional: true },
      ]);
    });
  });

  it('is safe to run twice', async () => {
    await rolledBack(async (tx) => {
      await toPreFb09State(tx);
      await runMigration(tx);
      const once = await rows(tx, 'resin');
      await runMigration(tx);
      expect(await rows(tx, 'resin')).toEqual(once);
      expect((await rows(tx, 'additive')).length).toBe(6);
    });
  });
});

describe('FB-09 report (read only)', () => {
  it('lists quotes with a retired resin and quotes on a retired placeholder plant', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(
        sql`update quote set resin = 'PCR_HDPE'
            where id = (select id from quote where resin = 'HDPE' order by quote_number limit 1)`,
      );
      const report = await fb09Report(tx);
      expect(report.retiredResin.map((r) => r.code)).toEqual([
        'PCR_HDPE',
        'PCR_PET',
        'PETG',
        'PVC',
        'BIO_RESIN',
      ]);
      expect(report.retiredResin.find((r) => r.code === 'PCR_HDPE')!.quoteNumbers.length).toBe(1);
      expect(report.placeholderPlants.map((p) => p.code)).toEqual([
        'PLANT_01',
        'PLANT_02',
        'PLANT_03',
      ]);
      // FB-13: it also lists retired machine types (see fb13-migration.int.test.ts).
      expect(report.retiredMachineTypes.map((t) => t.code)).toContain('EBM_SHUTTLE');
    });
  });
});
