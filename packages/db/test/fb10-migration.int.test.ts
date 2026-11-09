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

function block(name: string): string[] {
  const start = MIGRATION.indexOf(`-- ${name}:start`);
  const end = MIGRATION.indexOf(`-- ${name}:end`);
  expect(start, name).toBeGreaterThan(0);
  return MIGRATION.slice(start, end)
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
    map?: { values: Record<string, number>; default?: number };
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
    expect(d.change_reason).toMatch(/^FB-10/);
    expect(d.tier_thresholds).toEqual(active.tier_thresholds);
    expect(d.attributes.filter((a) => a.key !== 'strategic_fit')).toEqual(
      active.attributes.filter((a) => a.key !== 'strategic_fit'),
    );
    const v3Fit = SCORING_MODEL_V3_INPUT.attributes.find((a) => a.key === 'strategic_fit') as {
      map: { values: Record<string, number> };
    };
    expect(fit(d).map!.values).toEqual(v3Fit.map.values);
    expect(fit(active).map!.values).toEqual({}); // the live model is untouched
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
      expect(rows[1]!.value).toEqual(INTAKE_GUARDRAILS_SEED);
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
