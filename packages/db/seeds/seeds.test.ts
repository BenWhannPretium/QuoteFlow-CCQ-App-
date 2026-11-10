import { readFileSync } from 'node:fs';

import { PERMISSION_MATRIX, SEED_REASON_CODES, hybridConfig } from '@ccq/domain';
import { describe, expect, it } from 'vitest';

import { rolePermissionRows, valueListRows, workflowRows } from './config/index';
import { RETIRED_VALUE_LISTS } from './config/value-lists';
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
    // FB-09: Danielle Leu approved product family and resin on 2026-11-09; everything else is provisional.
    const approved = rows.filter((r) => !r.provisional);
    expect([...new Set(approved.map((r) => r.listKey))].sort()).toEqual([
      'product_family',
      'resin',
    ]);
    expect(approved.every((r) => r.meta.approvedByName === 'Danielle Leu')).toBe(true);
    expect(
      rows
        .filter((r) => r.listKey === 'pcr_level' || r.listKey === 'additive')
        .every((r) => r.provisional),
    ).toBe(true);
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
      expect(rows.find((r) => r.listKey === k && r.code === 'OTHER')?.meta).toEqual({
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
