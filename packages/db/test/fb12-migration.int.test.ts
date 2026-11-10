import { readFileSync } from 'node:fs';

import {
  SCORING_DRAFT_V3_CHANGE_REASON,
  SCORING_MODEL_V3_INPUT,
  WHERE_TO_PLAY_SUB_MARKET_POINTS,
  WHERE_TO_PLAY_UNSCORED_SUB_MARKETS,
} from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { raw, testDb } from './helpers';
import { RETIRED_MARKETS, SUB_MARKETS } from '../seeds/config/value-lists';
import type { Tx } from '../src/client';
import { fb12Report, MARKET_OLD_TO_NEW, renderFb12Report } from '../src/fb12Report';

/**
 * FB-12 (F-020, F-073, D-004): the market list, the sub-market list and the inactive draft scoring model
 * re-keyed to sub-market (migration 0037). Each block between its markers is re-run inside a transaction
 * that is rolled back, against rows set up the way an environment before FB-12 has them. The test
 * database is also freshly seeded, so the seed is checked against the migration.
 */
const { db } = testDb();
const MIGRATION = readFileSync(
  new URL('../migrations/0037_fb12_sub_market_scoring.sql', import.meta.url),
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

const ACTIVE_MARKETS = [
  ['FOOD', 'Food'],
  ['BEVERAGE', 'Beverage'],
  ['NUTRITION_WELLNESS', 'Nutrition & Wellness'],
  ['OTC_HEALTH', 'OTC Health'],
  ['CLINICAL', 'Clinical'],
  ['PERSONAL_CARE', 'Personal Care'],
  ['HOME_CARE', 'Home Care'],
  ['AUTO_COMMERCIAL_CHEMICAL', 'Auto & Commercial Chemical'],
] as const;

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
  approved: r.approved_at !== null,
  meta: r.meta,
});

/** An environment before FB-12: the placeholder market list as FB-02 seeded it, all provisional. */
async function toPreFb12State(tx: Tx) {
  await tx.execute(sql`delete from value_list where list_key = 'sub_market'`);
  await tx.execute(
    sql`delete from value_list where list_key = 'market'
        and code in ('NUTRITION_WELLNESS', 'OTC_HEALTH', 'CLINICAL', 'HOME_CARE', 'AUTO_COMMERCIAL_CHEMICAL')`,
  );
  await tx.execute(sql`update value_list set provisional = true, approved_at = null, version = 1,
      active = true, meta = '{}'::jsonb
    where list_key = 'market'`);
  for (const [code, label, sort] of [
    ['FOOD', 'Food', 10],
    ['BEVERAGE', 'Beverage', 20],
    ['NUTRITION', 'Nutrition/Supplements', 30],
    ['PERSONAL_CARE', 'Personal Care', 40],
    ['HOUSEHOLD_CHEMICAL', 'Household Chemical', 50],
    ['PHARMA_HEALTH', 'Pharma/Health', 60],
    ['INDUSTRIAL_CHEMICAL', 'Industrial/Chemical', 70],
    ['PET', 'Pet', 80],
  ] as const) {
    await tx.execute(
      sql`update value_list set label = ${label}, sort = ${sort} where list_key = 'market' and code = ${code}`,
    );
  }
  await tx.execute(
    sql`update app_setting set value = value - 'sub_market' where key = 'intake_field_help'`,
  );
}

describe('FB-12 seed: markets and sub-markets', () => {
  it('has Melanie Rasche’s 8 markets active, approved, in her order, and the 5 old codes inactive', async () => {
    const all = await db.transaction((tx) => rows(tx, 'market'));
    const active = all.filter((r) => r.active);
    expect(active.map((r) => [r.code, r.label])).toEqual(ACTIVE_MARKETS.map((m) => [...m]));
    expect(active.map((r) => r.sort)).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
    for (const r of active) {
      expect(r.provisional, r.code).toBe(false);
      expect(r.approved_at, r.code).not.toBeNull();
      expect(new Date(r.approved_at!).toISOString().slice(0, 10), r.code).toBe('2026-11-09');
      expect(r.meta.approvedByName, r.code).toBe('Melanie Rasche');
    }
    const retired = all.filter((r) => !r.active);
    expect(retired.map((r) => r.code).sort()).toEqual([...RETIRED_MARKETS].sort());
    for (const r of retired) expect(r.provisional, r.code).toBe(true); // they stay as they are
  });

  it('has the 30 sub-markets, provisional, each under an active market, in her order', async () => {
    const subs = await db.transaction((tx) => rows(tx, 'sub_market'));
    expect(subs).toHaveLength(30);
    expect(subs.map((r) => r.code)).toEqual(SUB_MARKETS.map(([, code]) => code));
    expect(subs.map((r) => r.label)).toEqual(SUB_MARKETS.map(([, , label]) => label));
    const markets = new Set(ACTIVE_MARKETS.map(([code]) => code));
    for (const r of subs) {
      expect(r.active, r.code).toBe(true);
      expect(r.provisional, r.code).toBe(true);
      expect(markets.has(r.meta.market as never), r.code).toBe(true);
    }
    // 8 + 10 + 9 scored, 3 not.
    expect(Object.keys(WHERE_TO_PLAY_SUB_MARKET_POINTS)).toHaveLength(27);
    for (const code of Object.keys(WHERE_TO_PLAY_SUB_MARKET_POINTS)) {
      expect(
        subs.map((r) => r.code),
        code,
      ).toContain(code);
    }
    for (const code of WHERE_TO_PLAY_UNSCORED_SUB_MARKETS) {
      expect(
        subs.map((r) => r.code),
        code,
      ).toContain(code);
    }
  });

  it('has the intake help text for the sub-market', async () => {
    const [row] = await db.transaction((tx) =>
      raw<{ value: Record<string, string> }>(
        tx,
        sql`select value from app_setting where key = 'intake_field_help'`,
      ),
    );
    expect(row!.value.sub_market).toBe(
      'Pick the closest sub-market. It sets the strategic-fit score.',
    );
  });
});

describe('0037 migration: markets and sub-markets', () => {
  it('turns the old placeholder list into the same rows the seed makes, once', async () => {
    await rolledBack(async (tx) => {
      const seededMarkets = (await rows(tx, 'market')).filter((r) => r.active).map(shape);
      const seededSubs = (await rows(tx, 'sub_market')).map(shape);
      const seededHelp = await raw<{ value: Record<string, string> }>(
        tx,
        sql`select value from app_setting where key = 'intake_field_help'`,
      );
      await toPreFb12State(tx);
      await run(tx, block('fb12-markets'));
      await run(tx, block('fb12-sub-markets'));
      const after = await rows(tx, 'market');
      expect(after.filter((r) => r.active).map(shape)).toEqual(seededMarkets);
      // The 5 old codes are deactivated, never deleted, and keep their labels.
      const retired = after.filter((r) => !r.active);
      expect(retired.map((r) => r.code).sort()).toEqual([...RETIRED_MARKETS].sort());
      expect(retired.find((r) => r.code === 'PHARMA_HEALTH')!.label).toBe('Pharma/Health');
      expect((await rows(tx, 'sub_market')).map(shape)).toEqual(seededSubs);
      const help = await raw<{ value: Record<string, string> }>(
        tx,
        sql`select value from app_setting where key = 'intake_field_help'`,
      );
      expect(help[0]!.value.sub_market).toBe(seededHelp[0]!.value.sub_market);
      // Idempotent: a second run changes nothing (not even the config version).
      const once = await rows(tx, 'market');
      await run(tx, block('fb12-markets'));
      await run(tx, block('fb12-sub-markets'));
      expect(await rows(tx, 'market')).toEqual(once);
    });
  });

  it('does not remap quotes: a quote on a retired code keeps it', async () => {
    await rolledBack(async (tx) => {
      await toPreFb12State(tx);
      await tx.execute(sql`update quote set market = 'PHARMA_HEALTH'
        where id = (select id from quote order by quote_number limit 1)`);
      const count = () =>
        raw<{ n: number }>(
          tx,
          sql`select count(*)::int as n from quote where market in
              ('NUTRITION', 'HOUSEHOLD_CHEMICAL', 'PHARMA_HEALTH', 'INDUSTRIAL_CHEMICAL', 'PET')`,
        );
      const before = await count();
      await run(tx, block('fb12-markets'));
      expect(await count()).toEqual(before);
      expect(before[0]!.n).toBeGreaterThan(0);
    });
  });

  it('leaves an Admin-edited or already approved market alone, and still adds the new ones', async () => {
    await rolledBack(async (tx) => {
      await toPreFb12State(tx);
      // An Admin renamed Food (version 2) and deactivated nothing; Nutrition was edited and kept active.
      await tx.execute(
        sql`update value_list set label = 'Food & Grocery', version = 2 where list_key = 'market' and code = 'FOOD'`,
      );
      await tx.execute(
        sql`update value_list set version = 3 where list_key = 'market' and code = 'NUTRITION'`,
      );
      // Beverage was approved by the business already.
      await tx.execute(
        sql`update value_list set provisional = false, approved_at = now() - interval '5 days'
            where list_key = 'market' and code = 'BEVERAGE'`,
      );
      await run(tx, block('fb12-markets'));
      const after = Object.fromEntries((await rows(tx, 'market')).map((r) => [r.code, r]));
      expect(after.FOOD).toMatchObject({ label: 'Food & Grocery', version: 2, provisional: true });
      expect(after.NUTRITION).toMatchObject({ active: true, version: 3 });
      expect(after.BEVERAGE!.meta).toEqual({}); // untouched: still the business's own approval
      expect(after.NUTRITION_WELLNESS).toMatchObject({ active: true, provisional: false });
      expect(after.HOUSEHOLD_CHEMICAL).toMatchObject({ active: false });
    });
  });

  it('is a no-op on an empty database (the seed makes the lists)', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`delete from value_list where list_key in ('market', 'sub_market')`);
      await run(tx, block('fb12-markets'));
      await run(tx, block('fb12-sub-markets'));
      expect(await rows(tx, 'market')).toHaveLength(0);
      expect(await rows(tx, 'sub_market')).toHaveLength(0);
    });
  });

  it('keeps an Admin’s own help text for the sub-market', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(
        sql`update app_setting set value = jsonb_set(value, '{sub_market}', '"My own words"')
            where key = 'intake_field_help'`,
      );
      await run(tx, block('fb12-sub-markets'));
      const [row] = await raw<{ value: Record<string, string> }>(
        tx,
        sql`select value from app_setting where key = 'intake_field_help'`,
      );
      expect(row!.value.sub_market).toBe('My own words');
    });
  });
});

type ModelRow = {
  id: string;
  model_version: number;
  version: number;
  effective_from: Date | null;
  provisional: boolean;
  approved_at: Date | null;
  change_reason: string;
  attributes: { key: string; weight: number; map?: Record<string, unknown> }[];
  tier_thresholds: unknown;
};
const models = (tx: Tx) =>
  raw<ModelRow>(
    tx,
    sql`select id, model_version, version, effective_from, provisional, approved_at, change_reason,
          attributes, tier_thresholds from scoring_model order by model_version`,
  );
const draftOf = async (tx: Tx) => (await models(tx)).find((m) => m.effective_from === null);
const fit = (m: ModelRow) => m.attributes.find((a) => a.key === 'strategic_fit')!;

/** FB-10's strategic-fit map (market points) and the reason migration 0034 gave the draft. */
const FB10_MAP = {
  by: 'market',
  values: {
    PERSONAL_CARE: 90,
    NUTRITION: 75,
    FOOD: 75,
    PET: 75,
    BEVERAGE: 60,
    HOUSEHOLD_CHEMICAL: 50,
    INDUSTRIAL_CHEMICAL: 50,
    PHARMA_HEALTH: 20,
  },
  default: 50,
};
const FB10_REASON =
  'FB-10 (F-073, D-004 open): DRAFT. Weights and tiers equal the active model. Strategic fit scores by market from the Where-to-Play 9-box (provisional points; the cell placement is unconfirmed, see feedback/inputs/9-box.md). Not active: compare it in the preview, then activate once D-004 is decided.';

/** Puts the seeded draft into the state an environment has after FB-10 and before FB-12. */
async function asFb10Draft(tx: Tx) {
  await tx.execute(sql`update scoring_model set
      attributes = (select jsonb_agg(case when a.e->>'key' = 'strategic_fit'
          then jsonb_set(a.e, '{map}', ${JSON.stringify(FB10_MAP)}::jsonb) else a.e end order by a.i)
        from jsonb_array_elements(attributes) with ordinality as a(e, i)),
      change_reason = ${FB10_REASON}, version = 1, provisional = true, approved_at = null
    where effective_from is null`);
}

describe('FB-12 seed: the v3 draft by sub-market', () => {
  it('is the one inactive, provisional draft: v2 with only strategic fit re-keyed to sub-market', async () => {
    const all = await db.transaction((tx) => models(tx));
    const drafts = all.filter((m) => m.effective_from === null);
    expect(drafts).toHaveLength(1);
    const d = drafts[0]!;
    const live = all
      .filter((m) => m.effective_from !== null && new Date(m.effective_from) <= new Date())
      .at(-1)!;
    expect(d.provisional).toBe(true);
    expect(d.approved_at).toBeNull();
    expect(d.change_reason).toBe(SCORING_DRAFT_V3_CHANGE_REASON);
    expect(d.change_reason).toContain('FB-12');
    expect(d.change_reason).toContain('Melanie Rasche');
    expect(d.tier_thresholds).toEqual(live.tier_thresholds);
    expect(d.attributes.filter((a) => a.key !== 'strategic_fit')).toEqual(
      live.attributes.filter((a) => a.key !== 'strategic_fit'),
    );
    expect(fit(d).map).toEqual({
      by: 'market',
      values: {},
      default: 50,
      bySegment: { by: 'sub_market', values: { ...WHERE_TO_PLAY_SUB_MARKET_POINTS } },
      defaultNote: 'Pick a sub-market to score strategic fit',
    });
    expect(Object.values((fit(d).map!.bySegment as { values: object }).values)).toHaveLength(27);
    // The live model is v2 and still scores strategic fit a neutral 50 for everything.
    expect(fit(live).map).toEqual({ by: 'market', values: {}, default: 50 });
    expect(SCORING_MODEL_V3_INPUT.version).toBe(3);
  });
});

describe('0037 migration: the draft scoring model', () => {
  const rekey = () => block('fb12-draft');

  it('re-keys FB-10’s draft in place to the same draft the seed makes, once', async () => {
    await rolledBack(async (tx) => {
      const seeded = (await draftOf(tx))!;
      await asFb10Draft(tx);
      expect(fit((await draftOf(tx))!).map).toEqual(FB10_MAP);
      await run(tx, rekey());
      const once = (await draftOf(tx))!;
      await run(tx, rekey()); // idempotent
      const twice = (await draftOf(tx))!;
      expect(twice).toEqual(once);
      // Same row, same version, still inactive and provisional.
      expect(once.id).toBe(seeded.id);
      expect(once.model_version).toBe(seeded.model_version);
      expect(once.version).toBe(1);
      expect(once.effective_from).toBeNull();
      expect(once.provisional).toBe(true);
      expect(once.attributes).toEqual(seeded.attributes);
      expect(once.tier_thresholds).toEqual(seeded.tier_thresholds);
      expect(once.change_reason).toBe(seeded.change_reason);
      expect(once.change_reason).toContain('FB-12');
    });
  });

  it('changes nothing about the live model', async () => {
    await rolledBack(async (tx) => {
      await asFb10Draft(tx);
      const live = async () => (await models(tx)).filter((m) => m.effective_from !== null);
      const before = await live();
      await run(tx, rekey());
      expect(await live()).toEqual(before);
    });
  });

  it('leaves an Admin-edited, approved, activated or changed draft alone', async () => {
    const changes: [string, ReturnType<typeof sql>][] = [
      [
        'edited (version 2)',
        sql`update scoring_model set version = 2 where effective_from is null`,
      ],
      [
        'approved',
        sql`update scoring_model set provisional = false, approved_at = now() where effective_from is null`,
      ],
      [
        'activated',
        sql`update scoring_model set effective_from = now() - interval '1 day' where effective_from is null`,
      ],
      [
        'strategic-fit points changed',
        sql`update scoring_model set attributes = (
            select jsonb_agg(case when a.e->>'key' = 'strategic_fit'
              then jsonb_set(a.e, '{map,values,FOOD}', '80') else a.e end order by a.i)
            from jsonb_array_elements(attributes) with ordinality as a(e, i))
          where effective_from is null`,
      ],
      [
        'reason rewritten',
        sql`update scoring_model set change_reason = 'Admin: my own draft' where effective_from is null`,
      ],
    ];
    for (const [name, change] of changes) {
      await rolledBack(async (tx) => {
        await asFb10Draft(tx);
        await tx.execute(change);
        const before = await models(tx);
        await run(tx, rekey());
        expect(await models(tx), name).toEqual(before);
      });
    }
  });

  it('does nothing when the draft was discarded, and on an empty database', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`delete from scoring_model where effective_from is null`);
      const before = await models(tx);
      await run(tx, rekey());
      expect(await models(tx)).toEqual(before);
      expect(await draftOf(tx)).toBeUndefined();
      await tx.execute(sql`delete from scoring_model`);
      await run(tx, rekey());
      expect(await models(tx)).toHaveLength(0);
    });
  });
});

describe('the FB-12 report (read only)', () => {
  it('lists quote numbers by retired market code with the suggested new market, and changes nothing', async () => {
    await rolledBack(async (tx) => {
      expect(Object.keys(MARKET_OLD_TO_NEW).sort()).toEqual([...RETIRED_MARKETS].sort());
      const ids = await raw<{ id: string; quote_number: string }>(
        tx,
        sql`select id, quote_number from quote order by quote_number limit 3`,
      );
      const [a, b, c] = ids;
      await tx.execute(sql`update quote set market = 'PHARMA_HEALTH' where id = ${a!.id}`);
      await tx.execute(sql`update quote set market = 'PET' where id = ${b!.id}`);
      await tx.execute(sql`update quote set market = 'NUTRITION' where id = ${c!.id}`);
      const before = await raw(tx, sql`select id, market from quote order by id`);
      const report = await fb12Report(tx);
      expect(await raw(tx, sql`select id, market from quote order by id`)).toEqual(before);
      expect(report.retiredMarketCounts).toEqual({ PHARMA_HEALTH: 1, PET: 1, NUTRITION: 1 });
      const row = (qn: string) => report.retiredMarketQuotes.find((q) => q.quoteNumber === qn)!;
      expect(row(a!.quote_number)).toMatchObject({
        market: 'PHARMA_HEALTH',
        suggested: 'OTC_HEALTH or CLINICAL',
        automatic: false,
      });
      expect(row(b!.quote_number)).toMatchObject({ suggested: 'HOME_CARE', automatic: true });
      expect(row(c!.quote_number)).toMatchObject({ suggested: 'NUTRITION_WELLNESS' });
      const text = renderFb12Report(report, new Date('2026-11-10T12:00:00Z'));
      expect(text).toContain(a!.quote_number);
      expect(text).toContain('no automatic mapping');
    });
  });

  it('says what the migration will do: done on a seeded database, will change on an old one, skipped when edited', async () => {
    await rolledBack(async (tx) => {
      const done = await fb12Report(tx);
      expect(done.markets.every((m) => m.outcome === 'already done')).toBe(true);
      expect(done.draft.outcome).toBe('already done');

      await toPreFb12State(tx);
      await asFb10Draft(tx);
      await tx.execute(
        sql`update value_list set label = 'Edited', version = 2 where list_key = 'market' and code = 'PET'`,
      );
      const old = await fb12Report(tx);
      const outcome = (code: string) => old.markets.find((m) => m.code === code)!.outcome;
      expect(outcome('FOOD')).toBe('will change');
      expect(outcome('CLINICAL')).toBe('will change'); // to be added
      expect(outcome('PHARMA_HEALTH')).toBe('will change'); // to be deactivated
      expect(outcome('PET')).toBe('skipped: admin changed');
      expect(old.draft).toMatchObject({ outcome: 'will change' });

      await tx.execute(sql`update scoring_model set version = 2 where effective_from is null`);
      expect((await fb12Report(tx)).draft.outcome).toBe('skipped: admin changed');
      await tx.execute(sql`delete from scoring_model where effective_from is null`);
      expect((await fb12Report(tx)).draft.outcome).toBe('missing');
    });
  });
});
