import { readFileSync } from 'node:fs';

import {
  INTAKE_GUARDRAILS_SEED,
  parseScoringModel,
  SCORING_MODEL_V3_INPUT,
  VOLUME_ROUTING_SEED,
} from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { raw, testDb } from './helpers';
import type { Tx } from '../src/client';
import { scoringModelInputFromRow } from '../src/repos/config';

/**
 * FB-10 (priority calibration) data migration (0034). Each block between its markers is re-run inside a
 * transaction that is rolled back, against rows set up the way an environment before FB-10 has them.
 * The test database is also freshly seeded, so the seed's draft is checked against the migration's.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0034_fb10_priority_calibration.sql', import.meta.url),
  'utf8',
);

/** 0037 (FB-12) re-keys the draft 0034 makes from market to sub-market; applied after 0034 as in an environment. */
const MIGRATION_0037 = readFileSync(
  new URL('../migrations/0037_fb12_sub_market_scoring.sql', import.meta.url),
  'utf8',
);

/** 0035: Danielle Leu's correction of the platform minimums (2026-11-09). */
const MIGRATION_0035 = readFileSync(
  new URL('../migrations/0035_platform_minimums_correction.sql', import.meta.url),
  'utf8',
);

/** What 0034 seeded, before Danielle Leu's correction (ISBM and IMM were swapped). */
const FB10_GUARDRAILS = {
  ...INTAKE_GUARDRAILS_SEED,
  minAnnualVolumeByProcess: {
    ISBM: 3_000_000,
    RHB: 1_000_000,
    IMM: 1_000_000,
    IBM: 3_000_000,
    EBM: 1_000_000,
  },
};

function block(name: string, source = MIGRATION): string[] {
  const start = source.indexOf(`-- ${name}:start`);
  const end = source.indexOf(`-- ${name}:end`);
  expect(start, name).toBeGreaterThan(0);
  return source
    .slice(start, end)
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gm, '').trim() !== '');
}

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

const run = async (tx: Tx, statements: string[]) => {
  for (const s of statements) await tx.execute(sql.raw(s));
};

type ModelRow = {
  model_version: number;
  effective_from: Date | null;
  provisional: boolean;
  change_reason: string;
  attributes: {
    key: string;
    weight: number;
    map?: { values: Record<string, number>; default?: number; bySegment?: unknown };
  }[];
  tier_thresholds: unknown;
};

const models = (tx: Tx) =>
  raw<ModelRow>(
    tx,
    sql`select model_version, effective_from, provisional, change_reason, attributes, tier_thresholds
        from scoring_model order by model_version`,
  );

const fit = (m: ModelRow) => m.attributes.find((a) => a.key === 'strategic_fit')!;

describe('FB-10 seed: the v3 draft', () => {
  it('is an inactive, provisional draft equal to the active model except strategic fit', async () => {
    const all = await db.transaction((tx) => models(tx));
    const draft = all.filter((m) => m.effective_from === null);
    expect(draft).toHaveLength(1);
    const d = draft[0]!;
    const active = all
      .filter((m) => m.effective_from !== null && new Date(m.effective_from) <= new Date())
      .at(-1)!;
    expect(d.model_version).toBe(Math.max(...all.map((m) => m.model_version)));
    expect(d.provisional).toBe(true);
    // FB-12 re-keyed the draft from market to sub-market (its reason now names FB-12).
    expect(d.change_reason).toMatch(/^FB-12/);
    expect(d.tier_thresholds).toEqual(active.tier_thresholds);
    expect(d.attributes.filter((a) => a.key !== 'strategic_fit')).toEqual(
      active.attributes.filter((a) => a.key !== 'strategic_fit'),
    );
    const v3Fit = SCORING_MODEL_V3_INPUT.attributes.find((a) => a.key === 'strategic_fit') as {
      map: unknown;
    };
    expect(fit(d).map).toEqual(v3Fit.map);
    expect(fit(active).map!.values).toEqual({}); // the live model is untouched
    expect((fit(active).map as { bySegment?: unknown }).bySegment).toBeUndefined();
    // It parses as a scoring model.
    const row = (await db.query.scoringModel.findFirst({
      where: (t, { isNull }) => isNull(t.effectiveFrom),
    }))!;
    expect(() => parseScoringModel(scoringModelInputFromRow(row))).not.toThrow();
  });

  it('seeds both settings off and provisional', async () => {
    const rows = await db.transaction((tx) =>
      raw<{ key: string; value: unknown; provisional: boolean }>(
        tx,
        sql`select key, value, provisional from app_setting
          where key in ('g1_volume_routing', 'intake_guardrails') order by key`,
      ),
    );
    expect(rows).toEqual([
      { key: 'g1_volume_routing', value: VOLUME_ROUTING_SEED, provisional: true },
      { key: 'intake_guardrails', value: INTAKE_GUARDRAILS_SEED, provisional: true },
    ]);
  });
});

describe('0034 migration', () => {
  /** An environment before FB-10: v1 and v2 only, v2 in effect, no draft. */
  async function beforeFb10(tx: Tx) {
    await tx.execute(sql`delete from scoring_model where effective_from is null`);
    await tx.execute(
      sql`delete from app_setting where key in ('g1_volume_routing', 'intake_guardrails')`,
    );
  }

  it('makes the same draft as the seed, copied from the model in effect, once', async () => {
    await rolledBack(async (tx) => {
      const seeded = (await models(tx)).find((m) => m.effective_from === null)!;
      await beforeFb10(tx);
      expect((await models(tx)).filter((m) => m.effective_from === null)).toHaveLength(0);
      await run(tx, block('fb10-config'));
      await run(tx, block('fb10-config')); // idempotent: a draft now exists
      // 0034 alone made FB-10's draft (market points); 0037 then re-keys it to sub-markets, as in an environment.
      expect(
        fit((await models(tx)).find((m) => m.effective_from === null)!).map!.values,
      ).toHaveProperty('PERSONAL_CARE', 90);
      await run(tx, block('fb12-draft', MIGRATION_0037));
      const after = await models(tx);
      const drafts = after.filter((m) => m.effective_from === null);
      expect(drafts).toHaveLength(1);
      const d = drafts[0]!;
      expect(d.model_version).toBe(seeded.model_version);
      expect(d.attributes).toEqual(seeded.attributes);
      expect(d.tier_thresholds).toEqual(seeded.tier_thresholds);
      expect(d.change_reason).toBe(seeded.change_reason);
      expect(d.provisional).toBe(true);
    });
  });

  it('creates the two settings off, and keeps an Admin’s own values', async () => {
    await rolledBack(async (tx) => {
      await beforeFb10(tx);
      await run(tx, block('fb10-config'));
      const get = () =>
        raw<{ key: string; value: Record<string, unknown> }>(
          tx,
          sql`select key, value from app_setting where key in ('g1_volume_routing', 'intake_guardrails') order by key`,
        );
      const rows = await get();
      expect(rows.map((r) => [r.key, r.value.enabled])).toEqual([
        ['g1_volume_routing', false],
        ['intake_guardrails', false],
      ]);
      expect(rows[0]!.value).toEqual(VOLUME_ROUTING_SEED);
      expect(rows[1]!.value).toEqual(FB10_GUARDRAILS); // 0035 corrects it (below)
      await tx.execute(
        sql`update app_setting set value = jsonb_set(value, '{min}', '2500000') where key = 'g1_volume_routing'`,
      );
      await run(tx, block('fb10-config'));
      expect((await get())[0]!.value.min).toBe(2_500_000);
    });
  });

  it('leaves an existing draft alone', async () => {
    await rolledBack(async (tx) => {
      await run(tx, block('fb10-config')); // the seeded draft is there
      expect((await models(tx)).filter((m) => m.effective_from === null)).toHaveLength(1);
      const before = await models(tx);
      await run(tx, block('fb10-config'));
      expect(await models(tx)).toEqual(before);
    });
  });

  it('makes no second draft after an FB-10 version was activated or discarded', async () => {
    await rolledBack(async (tx) => {
      // The seeded draft stands in for FB-10's: same row, with the reason 0034 gave it.
      await tx.execute(
        sql`update scoring_model set change_reason = 'FB-10 (test): the draft 0034 made'
          where effective_from is null`,
      );
      await tx.execute(
        sql`update scoring_model set effective_from = now() - interval '1 day' where effective_from is null`,
      ); // an Admin activated it
      await run(tx, block('fb10-config'));
      expect((await models(tx)).filter((m) => m.effective_from === null)).toHaveLength(0);
    });
  });

  it('does not overwrite strategic-fit points an Admin already set on the active model', async () => {
    await rolledBack(async (tx) => {
      await beforeFb10(tx);
      await tx.execute(sql`update scoring_model set attributes = (
          select jsonb_agg(case when a.e->>'key' = 'strategic_fit'
            then jsonb_set(a.e, '{map,values}', '{"FOOD": 99}') else a.e end order by a.i)
          from jsonb_array_elements(attributes) with ordinality as a(e, i))
        where effective_from is not null and model_version = (select max(model_version) from scoring_model)`);
      await run(tx, block('fb10-config'));
      expect((await models(tx)).filter((m) => m.effective_from === null)).toHaveLength(0);
    });
  });

  it('skips the draft on an empty database (the seed makes it)', async () => {
    await rolledBack(async (tx) => {
      await beforeFb10(tx);
      await tx.execute(sql`delete from scoring_model`);
      await run(tx, block('fb10-config'));
      expect(await models(tx)).toHaveLength(0);
    });
  });
});

describe('0035 migration (platform minimums, Danielle Leu 2026-11-09)', () => {
  const guardrails = (tx: Tx) =>
    raw<{ value: Record<string, unknown>; version: number; provisional: boolean }>(
      tx,
      sql`select value, version, provisional from app_setting where key = 'intake_guardrails'`,
    );
  const asFb10Seeded = (tx: Tx) =>
    tx.execute(sql`update app_setting
      set value = ${JSON.stringify(FB10_GUARDRAILS)}::jsonb, version = 1, approved_at = null, provisional = true
      where key = 'intake_guardrails'`);
  const fix = () => block('fb10-platform-minimums', MIGRATION_0035);

  it('corrects the FB-10 minimums to the seed, keeps the warning off, and is idempotent', async () => {
    await rolledBack(async (tx) => {
      await asFb10Seeded(tx);
      await run(tx, fix());
      await run(tx, fix());
      const [row] = await guardrails(tx);
      expect(row!.value).toEqual(INTAKE_GUARDRAILS_SEED);
      expect(row!.value.enabled).toBe(false);
      expect(row!.provisional).toBe(true);
    });
  });

  it('keeps the enabled flag an Admin set while the minimums are still the FB-10 ones', async () => {
    await rolledBack(async (tx) => {
      await asFb10Seeded(tx);
      await tx.execute(
        sql`update app_setting set value = jsonb_set(value, '{enabled}', 'true') where key = 'intake_guardrails'`,
      );
      await run(tx, fix());
      const [row] = await guardrails(tx);
      expect(row!.value.enabled).toBe(true);
      expect(row!.value.minAnnualVolumeByProcess).toEqual(
        INTAKE_GUARDRAILS_SEED.minAnnualVolumeByProcess,
      );
    });
  });

  it('leaves an Admin-edited, approved or different row alone', async () => {
    for (const change of [
      sql`update app_setting set version = 2 where key = 'intake_guardrails'`,
      sql`update app_setting set approved_at = now(), provisional = false where key = 'intake_guardrails'`,
      sql`update app_setting set value = jsonb_set(value, '{minAnnualVolumeByProcess,EBM}', '2000000') where key = 'intake_guardrails'`,
    ]) {
      await rolledBack(async (tx) => {
        await asFb10Seeded(tx);
        await tx.execute(change);
        const before = (await guardrails(tx))[0]!.value;
        await run(tx, fix());
        expect((await guardrails(tx))[0]!.value).toEqual(before);
      });
    }
  });
});
