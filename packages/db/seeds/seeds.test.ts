import { readFileSync } from 'node:fs';

import {
  PERMISSION_MATRIX,
  SEED_REASON_CODES,
  WHERE_TO_PLAY_SUB_MARKET_BANDS,
  WHERE_TO_PLAY_UNSCORED_SUB_MARKETS,
  hybridConfig,
} from '@ccq/domain';
import { describe, expect, it } from 'vitest';

import { rolePermissionRows, valueListRows, workflowRows } from './config/index';
import { RETIRED_MARKETS, RETIRED_VALUE_LISTS } from './config/value-lists';
import { buildCustomers, buildOpportunities, SF_STAGE_COUNTS } from './synthetic/opportunities';
import { PERSONA_DEFS, buildPersonas } from './synthetic/personas';
import { DEFAULT_ANCHOR, createRng } from './synthetic/rng';
import { SF_FIXTURE_PATH, buildSfFixture, renderSfFixture } from './synthetic/sfFixture';
import { VALUE_LIST_KEYS } from '../src/schema/enums';

describe('config seeds derive from the domain', () => {
  it('workflow rows mirror the hybrid config one-to-one', () => {
    const rows = workflowRows();
    expect(rows.stages.map((s) => s.key)).toEqual(hybridConfig.stages.map((s) => s.key));
    expect(rows.outcomes).toHaveLength(hybridConfig.outcomes.length);
    expect(rows.transitions).toHaveLength(hybridConfig.transitions.length);
    expect(rows.reasonCodes).toHaveLength(SEED_REASON_CODES.length);
  });

  it('lost reason codes are the B-03 list, Other needs a note', () => {
    const lost = SEED_REASON_CODES.filter((r) => r.context === 'lost');
    expect(lost.map((r) => r.label)).toEqual([
      'Price',
      'Lead time',
      'Capability',
      'Capacity',
      'Customer cancelled',
      'Competitor relationship',
      'Other (note required)',
    ]);
    expect(lost.filter((r) => r.requiresNote).map((r) => r.code)).toEqual(['other']);
  });

  it('role_permission rows cover the matrix', () => {
    const n = Object.values(PERMISSION_MATRIX).reduce((acc, g) => acc + Object.keys(g).length, 0);
    expect(rolePermissionRows()).toHaveLength(n);
  });

  it('value list codes are unique per list; only lists a named owner signed off are approved', () => {
    const rows = valueListRows();
    expect(new Set(rows.map((r) => `${r.listKey}:${r.code}`)).size).toBe(rows.length);
    const approved = rows.filter((r) => !r.provisional);
    // FB-09: Danielle Leu approved product family and resin on 2026-11-09.
    expect(
      [...new Set(approved.filter((r) => r.listKey !== 'market').map((r) => r.listKey))].sort(),
    ).toEqual(['product_family', 'resin']);
    expect(
      approved
        .filter((r) => r.listKey !== 'market')
        .every((r) => r.meta.approvedByName === 'Danielle Leu'),
    ).toBe(true);
    // FB-12: Melanie Rasche approved the 8 active markets on 2026-11-09.
    expect(approved.filter((r) => r.listKey === 'market').map((r) => r.code)).toEqual([
      'FOOD',
      'BEVERAGE',
      'NUTRITION_WELLNESS',
      'OTC_HEALTH',
      'CLINICAL',
      'PERSONAL_CARE',
      'HOME_CARE',
      'AUTO_COMMERCIAL_CHEMICAL',
    ]);
    expect(
      approved
        .filter((r) => r.listKey === 'market')
        .every((r) => r.active && r.meta.approvedByName === 'Melanie Rasche'),
    ).toBe(true);
    expect(
      approved.every(
        (r) => 'approvedAt' in r && r.approvedAt.toISOString().startsWith('2026-11-09'),
      ),
    ).toBe(true);
    // Everything else stays provisional (PCR, additive, sub-markets, …).
    expect(
      rows
        .filter((r) => ['pcr_level', 'additive', 'sub_market'].includes(r.listKey))
        .every((r) => r.provisional),
    ).toBe(true);
  });

  it('markets: the five old codes are kept inactive, never deleted (FB-12)', () => {
    const markets = valueListRows().filter((r) => r.listKey === 'market');
    expect(markets.filter((r) => r.active)).toHaveLength(8);
    expect(markets.filter((r) => !r.active).map((r) => r.code)).toEqual([...RETIRED_MARKETS]);
  });

  it('sub-markets: 30, each under an active market, and every scored code in where-to-play exists with the right parent (FB-12)', () => {
    const rows = valueListRows();
    const activeMarkets = new Set(
      rows.filter((r) => r.listKey === 'market' && r.active).map((r) => r.code),
    );
    const subs = rows.filter((r) => r.listKey === 'sub_market');
    expect(subs).toHaveLength(30);
    expect(subs.every((r) => r.active && r.provisional)).toBe(true);
    const parent = new Map<string, string>();
    for (const s of subs) {
      const market = (s.meta as { market?: string }).market;
      expect(activeMarkets.has(market ?? ''), s.code).toBe(true);
      parent.set(s.code, market!);
    }
    const scored = Object.keys(WHERE_TO_PLAY_SUB_MARKET_BANDS);
    expect(scored).toHaveLength(27);
    for (const code of scored) expect(parent.has(code), code).toBe(true);
    for (const code of WHERE_TO_PLAY_UNSCORED_SUB_MARKETS)
      expect(parent.has(code), code).toBe(true);
    // The two sets together are exactly the list.
    expect(new Set([...scored, ...WHERE_TO_PLAY_UNSCORED_SUB_MARKETS])).toEqual(
      new Set(parent.keys()),
    );
    // Parents, by code prefix (a mistyped parent would put a sub-market under the wrong market).
    const PREFIX: Record<string, string> = {
      FOOD_: 'FOOD',
      BEV_: 'BEVERAGE',
      NW_: 'NUTRITION_WELLNESS',
      OTC_: 'OTC_HEALTH',
      CLIN_: 'CLINICAL',
      PC_: 'PERSONAL_CARE',
      HC_: 'HOME_CARE',
      ACC_: 'AUTO_COMMERCIAL_CHEMICAL',
    };
    for (const [code, market] of parent) {
      const prefix = Object.keys(PREFIX).find((p) => code.startsWith(p))!;
      expect(market, code).toBe(PREFIX[prefix]);
    }
  });

  it('FB-09: Danielle Leu\'s lists, in her order, with "Other" asking for the detail', () => {
    const rows = valueListRows();
    const list = (k: string) => rows.filter((r) => r.listKey === k && r.active).map((r) => r.label);
    expect(list('product_family')).toEqual([
      'Bottle',
      'Jar',
      'Closure',
      'Preform',
      'Canister/Tub',
      'Handleware',
      'Other',
    ]);
    expect(list('resin')).toEqual(['PET', 'HDPE', 'PP', 'LDPE', 'PS', 'Other']);
    expect(list('pcr_level')).toEqual(['0% / Virgin', '25%', '30%', '50%', '100%', 'Other']);
    expect(list('additive')).toEqual([
      'None',
      'UV',
      'Barrier',
      'Antistat',
      'Impact Modifier',
      'Other',
    ]);
    for (const k of ['resin', 'pcr_level', 'additive']) {
      expect(rows.find((r) => r.listKey === k && r.code === 'OTHER')?.meta).toMatchObject({
        freeText: true,
      });
    }
  });

  it('FB-09: every value list a form reads has at least one active value', () => {
    const rows = valueListRows();
    for (const k of VALUE_LIST_KEYS) {
      if (RETIRED_VALUE_LISTS.has(k)) continue;
      expect(
        rows.some((r) => r.listKey === k && r.active),
        k,
      ).toBe(true);
    }
  });
});

describe('synthetic generator', () => {
  it('is deterministic for a seed', () => {
    const run = () => {
      const rng = createRng(7);
      const personas = buildPersonas(rng, DEFAULT_ANCHOR);
      const customers = buildCustomers(rng, DEFAULT_ANCHOR);
      return { personas, opps: buildOpportunities(rng, DEFAULT_ANCHOR, customers) };
    };
    expect(run()).toEqual(run());
  });

  it('FB-12: markets are on the new list, sub-markets belong to them, and a retired code never appears', () => {
    const customers = buildCustomers(createRng(7), DEFAULT_ANCHOR);
    const opps = buildOpportunities(createRng(7), DEFAULT_ANCHOR, customers);
    const rows = valueListRows();
    const active = new Set(
      rows.filter((r) => r.listKey === 'market' && r.active).map((r) => r.code),
    );
    const parent = new Map(
      rows
        .filter((r) => r.listKey === 'sub_market')
        .map((r) => [r.code, (r.meta as { market: string }).market]),
    );
    for (const o of opps) {
      expect(active.has(o.spec.market), o.spec.market).toBe(true);
      if (o.spec.subMarket) expect(parent.get(o.spec.subMarket)).toBe(o.spec.market);
    }
    // Some quotes carry a sub-market, some a market only, and every market is drawn.
    expect(opps.some((o) => o.spec.subMarket !== null)).toBe(true);
    expect(opps.some((o) => o.spec.subMarket === null)).toBe(true);
    expect(new Set(opps.map((o) => o.spec.market))).toEqual(active);
  });

  it('has a persona per role plus the multi-role and scoped variants, all on example.com', () => {
    const personas = buildPersonas(createRng(), DEFAULT_ANCHOR);
    expect(personas).toHaveLength(14);
    expect(new Set(personas.flatMap((p) => p.roles))).toEqual(
      new Set([
        'KAM',
        'SalesLeader',
        'EngLead',
        'Engineer',
        'Pricing',
        'PricingLead',
        'Finance',
        'Approver',
        'Leadership',
        'Admin',
      ]),
    );
    expect(personas.every((p) => p.email.endsWith('@example.com'))).toBe(true);
    expect(PERSONA_DEFS.map((p) => p.key)).toContain('kam-owner');
  });

  it('builds 102 opportunities with the report stage mix and the expected name shape', () => {
    const rng = createRng();
    const opps = buildOpportunities(rng, DEFAULT_ANCHOR, buildCustomers(rng, DEFAULT_ANCHOR));
    expect(opps).toHaveLength(102);
    expect(SF_STAGE_COUNTS.reduce((n, [, c]) => n + c, 0)).toBe(102);
    for (const o of opps) {
      expect(o.name).toMatch(/^.+ \/ .+ \/ \d+oz \S+ .+ \S+$/);
      const monthsOut =
        (new Date(o.closeDate).getTime() - DEFAULT_ANCHOR.getTime()) / (30.44 * 86_400_000);
      expect(monthsOut).toBeGreaterThanOrEqual(1.95);
      expect(monthsOut).toBeLessThanOrEqual(9.05);
    }
  });
});

describe('Salesforce fake fixture', () => {
  it('matches the generator (run `pnpm db:sf-fixture` after changing the seeds or fieldMap.ts)', () => {
    const committed = readFileSync(SF_FIXTURE_PATH, 'utf8');
    expect(committed).toBe(renderSfFixture(buildSfFixture()));
  });

  it('keeps the seeded opportunity ids and names, and includes the messy cases', () => {
    const fixture = buildSfFixture();
    const rng = createRng();
    buildPersonas(rng, DEFAULT_ANCHOR);
    const seeded = buildOpportunities(rng, DEFAULT_ANCHOR, buildCustomers(rng, DEFAULT_ANCHOR));
    expect(fixture.opportunities.map((o) => [o.Id, o.Name])).toEqual(
      seeded.map((o) => [o.sfOpportunityId, o.name]),
    );
    const amounts = fixture.opportunities.map((o) => o.Amount);
    expect(amounts).toContain(0.31);
    expect(amounts).toContain(null);
    expect(fixture.opportunities.some((o) => o.AccountId === null)).toBe(true);
    expect(fixture.deleted).toHaveLength(1);
  });
});
