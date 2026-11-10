import { readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { raw, testDb } from './helpers';
import {
  MACHINE_TYPES,
  PLANT_LIST_APPROVED_AT,
  PLANT_LIST_APPROVER,
  PLANTS,
  plantCode,
  RETIRED_MACHINE_TYPES,
  RETIRED_PLANTS,
} from '../seeds/config/plants';
import type { Tx } from '../src/client';
import {
  fb09Report,
  MACHINE_TYPE_OLD_TO_NEW,
  PLACEHOLDER_PLANT_CODES,
  RETIRED_MACHINE_TYPE_CODES,
  renderFb09Report,
} from '../src/fb09Report';

/**
 * FB-13 (F-057): Jim Zweifel's plant and machine-type lists (2026-11-10) and migration 0039. The migration's
 * statements are re-run inside a transaction that is rolled back, against rows set up the way an environment
 * before FB-13 has them. The test database is freshly seeded, so the seed is checked against the migration.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0039_fb13_plants_machine_types.sql', import.meta.url),
  'utf8',
);
const start = MIGRATION.indexOf('-- fb13-plants:start');
const end = MIGRATION.indexOf('-- fb13-plants:end');
const statements = MIGRATION.slice(start, end)
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
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

type ListRow = {
  list_key: string;
  code: string;
  label: string;
  sort: number;
  active: boolean;
  provisional: boolean;
  approved_at: Date | null;
  version: number;
  meta: Record<string, unknown>;
};
const rows = (tx: Tx, listKey: string) =>
  raw<ListRow>(
    tx,
    sql`select list_key, code, label, sort, active, provisional, approved_at, version, meta
        from value_list where list_key = ${listKey} order by sort, code`,
  );
const shape = (r: ListRow) => ({
  code: r.code,
  label: r.label,
  sort: r.sort,
  active: r.active,
  provisional: r.provisional,
  approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
  meta: r.meta,
});
const active = (all: ListRow[]) => all.filter((r) => r.active);

const OLD_PLANT_LABELS: Record<string, string> = {
  PLANT_01: 'Placeholder plant 01',
  PLANT_02: 'Placeholder plant 02',
  PLANT_03: 'Placeholder plant 03',
};

/** An environment before FB-13: only the placeholders (all provisional, version 1; EBM_WHEEL inactive since FB-03). */
async function toPreFb13State(tx: Tx) {
  await tx.execute(
    sql`delete from value_list where list_key = 'plant' and code not in ('PLANT_01', 'PLANT_02', 'PLANT_03')`,
  );
  await tx.execute(
    sql`delete from value_list where list_key = 'machine_type'
        and code not in ('EBM_SHUTTLE', 'EBM_WHEEL', 'IBM_PRESS', 'ISBM_1STEP', 'ISBM_2STEP', 'INJECTION_PRESS', 'OTHER')`,
  );
  await tx.execute(
    sql`update value_list set active = true, sort = (case code
        when 'PLANT_01' then 10 when 'PLANT_02' then 20 when 'PLANT_03' then 30
        when 'EBM_SHUTTLE' then 10 when 'EBM_WHEEL' then 20 when 'IBM_PRESS' then 30
        when 'ISBM_1STEP' then 40 when 'ISBM_2STEP' then 50 when 'INJECTION_PRESS' then 60
        else 70 end),
      provisional = true, approved_at = null, version = 1, meta = '{}'::jsonb
      where list_key in ('plant', 'machine_type')`,
  );
  await tx.execute(
    sql`update value_list set active = false, version = 2 where list_key = 'machine_type' and code = 'EBM_WHEEL'`,
  );
}

describe('FB-13 seed: Jim Zweifel’s plants and machine types', () => {
  it('has the 22 locations active, as sent, in his order, approved by Jim Zweifel', async () => {
    const all = await db.transaction((tx) => rows(tx, 'plant'));
    const act = active(all);
    expect(act).toHaveLength(22);
    expect(act.map((r) => r.label)).toEqual(PLANTS.map((p) => p.name));
    expect(act.map((r) => r.code)).toEqual(PLANTS.map((p) => plantCode(p.name)));
    // Spot checks against the table as sent, including the entries that look odd.
    const byLabel = new Map(act.map((r) => [r.label, r]));
    expect(byLabel.get('Etten.Leur')!.code).toBe('ETTEN_LEUR');
    expect(byLabel.get('Cleveland, OH')!.code).toBe('CLEVELAND_OH');
    expect(byLabel.get('Lerma, Ediplast')!.code).toBe('LERMA_EDIPLAST');
    expect(byLabel.get('St. Charles')!.meta.machineTypes).toEqual([
      '12B',
      'INJ-CAP',
      'ISBM',
      'RHB',
      'DECO',
    ]);
    expect(byLabel.get('Lerma, Ediprint')!.meta.machineTypes).toEqual([
      'DIE CUTTING',
      'LAMINATION',
      'PRINTING',
      'STAMPING',
    ]);
    for (const r of act) {
      expect(r.provisional, r.code).toBe(false);
      expect(new Date(r.approved_at!).toISOString(), r.code).toBe(
        PLANT_LIST_APPROVED_AT.toISOString(),
      );
      expect(r.meta.approvedByName, r.code).toBe(PLANT_LIST_APPROVER);
    }
  });

  it('has Jim’s 14 machine types active, labels as sent, approved; every plant’s types are on the list', async () => {
    const all = await db.transaction((tx) => rows(tx, 'machine_type'));
    const act = active(all);
    expect(act.map((r) => [r.code, r.label])).toEqual(MACHINE_TYPES.map(([c, l]) => [c, l]));
    expect(act.map((r) => r.code)).toEqual([
      'EBM',
      'IBM',
      'ISBM',
      'RHB',
      'INJ-CAP',
      'INJ-PREFORM',
      'INJ-OTHER',
      'DECO',
      'PAD PRINTING',
      '12B',
      'DIE CUTTING',
      'LAMINATION',
      'PRINTING',
      'STAMPING',
    ]);
    for (const r of act) {
      expect(r.provisional, r.code).toBe(false);
      expect(r.meta.approvedByName, r.code).toBe('Jim Zweifel');
    }
    const codes = new Set(act.map((r) => r.code));
    for (const p of PLANTS) for (const m of p.machineTypes) expect(codes.has(m), m).toBe(true);
  });

  it('keeps the placeholders, inactive and still provisional (never deleted)', async () => {
    const plants = (await db.transaction((tx) => rows(tx, 'plant'))).filter((r) => !r.active);
    expect(plants.map((r) => r.code).sort()).toEqual([...RETIRED_PLANTS].sort());
    expect(plants.find((r) => r.code === 'PLANT_01')!.label).toBe(OLD_PLANT_LABELS.PLANT_01);
    const machines = (await db.transaction((tx) => rows(tx, 'machine_type'))).filter(
      (r) => !r.active,
    );
    expect(machines.map((r) => r.code).sort()).toEqual([...RETIRED_MACHINE_TYPES].sort());
    for (const r of [...plants, ...machines]) expect(r.provisional, r.code).toBe(true);
  });
});

describe('0039 migration: plants and machine types', () => {
  it('turns the placeholder lists into the same rows the seed makes, once', async () => {
    await rolledBack(async (tx) => {
      const seededPlants = active(await rows(tx, 'plant')).map(shape);
      const seededMachines = active(await rows(tx, 'machine_type')).map(shape);
      await toPreFb13State(tx);
      await runMigration(tx);
      const plants = await rows(tx, 'plant');
      const machines = await rows(tx, 'machine_type');
      expect(active(plants).map(shape)).toEqual(seededPlants);
      expect(active(machines).map(shape)).toEqual(seededMachines);
      // The placeholders are deactivated, never deleted, and keep their labels.
      expect(
        plants
          .filter((r) => !r.active)
          .map((r) => r.code)
          .sort(),
      ).toEqual([...RETIRED_PLANTS]);
      expect(plants.find((r) => r.code === 'PLANT_02')!.label).toBe('Placeholder plant 02');
      expect(
        machines
          .filter((r) => !r.active)
          .map((r) => r.code)
          .sort(),
      ).toEqual([...RETIRED_MACHINE_TYPES].sort());
      expect(machines.find((r) => r.code === 'EBM_SHUTTLE')!.label).toBe('EBM shuttle');
      // A retired placeholder sorts after the offered values.
      for (const r of [...plants, ...machines].filter((x) => !x.active)) {
        expect(r.sort, r.code).toBeGreaterThan(900);
      }
    });
  });

  it('is idempotent: a second run changes nothing', async () => {
    await rolledBack(async (tx) => {
      await toPreFb13State(tx);
      await runMigration(tx);
      const once = [...(await rows(tx, 'plant')), ...(await rows(tx, 'machine_type'))];
      await runMigration(tx);
      expect([...(await rows(tx, 'plant')), ...(await rows(tx, 'machine_type'))]).toEqual(once);
      expect(active(await rows(tx, 'plant'))).toHaveLength(22);
      expect(active(await rows(tx, 'machine_type'))).toHaveLength(14);
    });
  });

  it('leaves an Admin-edited or already-approved placeholder alone', async () => {
    await rolledBack(async (tx) => {
      await toPreFb13State(tx);
      // An Admin relabelled PLANT_01 in the console (version bump); the business approved IBM_PRESS.
      await tx.execute(
        sql`update value_list set label = 'Our test plant', version = 2 where list_key = 'plant' and code = 'PLANT_01'`,
      );
      await tx.execute(
        sql`update value_list set provisional = false, approved_at = '2026-11-01T00:00:00Z'
            where list_key = 'machine_type' and code = 'IBM_PRESS'`,
      );
      await runMigration(tx);
      const plants = await rows(tx, 'plant');
      const machines = await rows(tx, 'machine_type');
      const p1 = plants.find((r) => r.code === 'PLANT_01')!;
      expect([p1.active, p1.label, p1.version]).toEqual([true, 'Our test plant', 2]);
      const ibm = machines.find((r) => r.code === 'IBM_PRESS')!;
      expect([ibm.active, ibm.provisional]).toEqual([true, false]);
      // The untouched placeholders were retired, and the 22 + 14 new values still arrived.
      expect(plants.find((r) => r.code === 'PLANT_02')!.active).toBe(false);
      expect(machines.find((r) => r.code === 'ISBM_1STEP')!.active).toBe(false);
      expect(active(plants).filter((r) => !r.code.startsWith('PLANT_'))).toHaveLength(22);
      expect(active(machines).filter((r) => r.code !== 'IBM_PRESS')).toHaveLength(14);
    });
  });

  it('keeps a value an Admin already created with one of the new codes', async () => {
    await rolledBack(async (tx) => {
      await toPreFb13State(tx);
      await tx.execute(
        sql`insert into value_list (id, list_key, code, label, sort, meta, provisional, version)
            values (gen_random_uuid(), 'plant', 'AURORA', 'Aurora (Admin wording)', 5, '{"note":"kept"}', true, 3)`,
      );
      await runMigration(tx);
      const a = (await rows(tx, 'plant')).find((r) => r.code === 'AURORA')!;
      expect([a.label, a.sort, a.provisional, a.version, a.meta]).toEqual([
        'Aurora (Admin wording)',
        5,
        true,
        3,
        { note: 'kept' },
      ]);
      expect((await rows(tx, 'plant')).filter((r) => r.code === 'AURORA')).toHaveLength(1);
    });
  });

  it('does nothing on an empty database (the seed loads the lists)', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`delete from value_list where list_key in ('plant', 'machine_type')`);
      await runMigration(tx);
      expect(await rows(tx, 'plant')).toEqual([]);
      expect(await rows(tx, 'machine_type')).toEqual([]);
    });
  });

  it('leaves a quote on a placeholder code untouched', async () => {
    await rolledBack(async (tx) => {
      const [er] = await raw<{ quote_id: string }>(
        tx,
        sql`select quote_id from eng_review limit 1`,
      );
      await tx.execute(
        sql`update eng_review set plant_code = 'PLANT_01', machine_type = 'EBM_SHUTTLE' where quote_id = ${er!.quote_id}`,
      );
      await toPreFb13State(tx);
      await runMigration(tx);
      const [after] = await raw<{ plant_code: string; machine_type: string }>(
        tx,
        sql`select plant_code, machine_type from eng_review where quote_id = ${er!.quote_id}`,
      );
      expect(after).toEqual({ plant_code: 'PLANT_01', machine_type: 'EBM_SHUTTLE' });
    });
  });
});

describe('FB-13 report (read only)', () => {
  it('knows the same retired codes as the seed', () => {
    expect([...PLACEHOLDER_PLANT_CODES]).toEqual([...RETIRED_PLANTS]);
    expect([...RETIRED_MACHINE_TYPE_CODES]).toEqual([...RETIRED_MACHINE_TYPES]);
  });

  it('lists quotes still on a retired plant or machine type with the suggested new value, and remaps nothing', async () => {
    await rolledBack(async (tx) => {
      const [a, b, c] = await raw<{ quote_id: string; quote_number: string }>(
        tx,
        sql`select er.quote_id, q.quote_number from eng_review er join quote q on q.id = er.quote_id
            order by q.quote_number limit 3`,
      );
      await tx.execute(
        sql`update eng_review set plant_code = 'PLANT_01', machine_type = 'EBM_SHUTTLE' where quote_id = ${a!.quote_id}`,
      );
      await tx.execute(
        sql`update eng_review set blow_plant_code = 'PLANT_02', machine_type = 'INJECTION_PRESS' where quote_id = ${b!.quote_id}`,
      );
      await tx.execute(
        sql`update eng_review set machine_type = 'OTHER' where quote_id = ${c!.quote_id}`,
      );
      const report = await fb09Report(tx);
      expect(
        report.placeholderPlants.find((p) => p.code === 'PLANT_01')!.reviewQuoteNumbers,
      ).toContain(a!.quote_number);
      expect(
        report.placeholderPlants.find((p) => p.code === 'PLANT_02')!.reviewQuoteNumbers,
      ).toContain(b!.quote_number);
      const byCode = new Map(report.retiredMachineTypes.map((t) => [t.code, t]));
      expect(byCode.get('EBM_SHUTTLE')).toMatchObject({ suggested: 'EBM' });
      expect(byCode.get('EBM_SHUTTLE')!.quoteNumbers).toContain(a!.quote_number);
      expect(byCode.get('INJECTION_PRESS')!.suggested).toMatch(/INJ-CAP/);
      expect(byCode.get('INJECTION_PRESS')!.quoteNumbers).toContain(b!.quote_number);
      expect(byCode.get('OTHER')!.quoteNumbers).toContain(c!.quote_number);
      // Every suggestion is on the new list (or says nobody maps).
      const codes = new Set(MACHINE_TYPES.map(([code]) => code));
      for (const old of RETIRED_MACHINE_TYPES) {
        const s = MACHINE_TYPE_OLD_TO_NEW[old].suggested;
        if (s.startsWith('(')) continue;
        for (const one of s.split(/, | or /)) expect(codes.has(one), `${old} -> ${one}`).toBe(true);
      }
      expect(report.placeholderStatus.every((s) => s.status === 'retired')).toBe(true);
      const text = renderFb09Report(report, new Date('2026-11-10T12:00:00Z'));
      expect(text).toContain('EBM_SHUTTLE -> EBM');
      expect(text).toContain('plant PLANT_01: retired');
      // Nothing was remapped by the report.
      const [still] = await raw<{ plant_code: string }>(
        tx,
        sql`select plant_code from eng_review where quote_id = ${a!.quote_id}`,
      );
      expect(still!.plant_code).toBe('PLANT_01');
    });
  });
});
