import { describe, expect, it } from 'vitest';

import { makeActor } from '../test-utils';
import { redact } from './redact';
import { isCommercialKey, toSnakeCase } from './sensitivity';
import { ROLES } from '../types/roles';

const quote = () => ({
  id: 'q1',
  quote_number: 'CCQ-2026-00001',
  priority_score: 82,
  prelim_capital_usd: 1_200_000,
  est_annual_volume: 5_000_000,
  eng_review: { process_type: 'IBM', prelim_capital_usd: 900_000, cavitation: 8, cycle_time_s: 12 },
  pricing_record: {
    price_approved_by: 'u9',
    pricing_refs: { erf: 'E-1' },
    capital_readiness: 'pending',
  },
  capacity_evidence: [
    {
      site: 'Plant A',
      assumed_effectiveness_pct: 70,
      cycle_time_s: 11,
      utilization_pct: 80,
      buffer_pct: 10,
      notes: 'ok',
    },
    {
      site: 'Plant B',
      assumed_effectiveness_pct: 65,
      cycle_time_s: 13,
      utilization_pct: 60,
      buffer_pct: 5,
      notes: 'ok',
    },
  ],
  priceRange: '1-2',
  margin_pct: 22,
  marginNote: 'x',
  history: [{ at: new Date('2026-01-01T00:00:00Z'), detail: { price_floor: 3, keep: 1 } }],
});

describe('redact', () => {
  it.each(['KAM', 'Engineer', 'SalesLeader', 'PostAward'] as const)(
    'strips commercial fields for %s',
    (role) => {
      const out = redact(quote(), makeActor(role)) as ReturnType<typeof quote> &
        Record<string, unknown>;
      expect(out).not.toHaveProperty('prelim_capital_usd');
      expect(out).not.toHaveProperty('pricing_record');
      expect(out).not.toHaveProperty('priceRange');
      expect(out).not.toHaveProperty('margin_pct');
      expect(out).not.toHaveProperty('marginNote');
      expect(out.eng_review).toEqual({ process_type: 'IBM', cavitation: 8, cycle_time_s: 12 });
      expect(out.capacity_evidence).toEqual([
        { site: 'Plant A', notes: 'ok' },
        { site: 'Plant B', notes: 'ok' },
      ]);
      expect(out.history[0]!.detail).toEqual({ keep: 1 });
      expect(out.history[0]!.at).toBeInstanceOf(Date);
      // non-commercial data survives
      expect(out).toMatchObject({ id: 'q1', priority_score: 82, est_annual_volume: 5_000_000 });
    },
  );

  it.each(['Pricing', 'Leadership', 'EngLead', 'Approver', 'Admin'] as const)(
    'keeps everything for %s',
    (role) => {
      expect(redact(quote(), makeActor(role))).toEqual(quote());
    },
  );

  it('matches the permission, not a hard-coded role list', () => {
    const roles = ROLES.filter((role) =>
      Object.keys(redact(quote(), makeActor(role)) as object).includes('pricing_record'),
    );
    expect(roles.sort()).toEqual([
      'Admin',
      'Approver',
      'EngLead',
      'Leadership',
      'Pricing',
      'PricingLead',
    ]);
  });

  it('never mutates its input', () => {
    const input = quote();
    redact(input, makeActor('KAM'));
    expect(input).toEqual(quote());
  });

  it('handles primitives, null and arrays at the top level', () => {
    const kam = makeActor('KAM');
    expect(redact(null, kam)).toBeNull();
    expect(redact('text', kam)).toBe('text');
    expect(redact([{ price: 1, keep: 2 }, 3], kam)).toEqual([{ keep: 2 }, 3]);
  });

  it('catches camelCase DTO keys', () => {
    const out = redact(
      {
        prelimCapitalUsd: 1,
        capacityEvidence: [{ utilizationPct: 5, site: 'A' }],
        pricingRecord: {},
      },
      makeActor('KAM'),
    );
    // capacityEvidence snake-cases to capacity_evidence, so its scoped numbers go
    expect(out).toEqual({ capacityEvidence: [{ site: 'A' }] });
  });

  it('leaves class instances alone', () => {
    const map = new Map([['price', 1]]);
    expect(redact({ map }, makeActor('KAM')).map).toBe(map);
  });

  it('does not strip look-alike keys such as priority_score', () => {
    expect(isCommercialKey('priority_score', [])).toBe(false);
    expect(isCommercialKey('cycle_time_s', [])).toBe(false);
    expect(isCommercialKey('cycle_time_s', ['capacity_evidence'])).toBe(true);
    expect(toSnakeCase('prelimCapitalUsd')).toBe('prelim_capital_usd');
  });

  it('B-15: strips every pricing-app record (ERF, BPR, SPR) and its figures', () => {
    const erf = {
      erfNumber: '26367',
      estRevenueUsd: 1,
      estVolume: 2,
      estNetCapitalUsd: 3,
      plant: 'CHI',
    };
    const context = {
      refs: { quoteErfNumber: '26367', erfRefs: ['26367'] },
      linkage: { status: 'match' },
      erfRecords: [erf],
      bprRecords: [{ bprNumber: 'BPR-1' }],
      sprHistory: [{ sprNumber: 'SPR-1' }],
      erfRecord: erf,
      bprRecord: { bprNumber: 'BPR-1' },
      nested: { erf },
    };
    for (const role of ['KAM', 'Engineer', 'SalesLeader', 'PostAward'] as const) {
      expect(redact(context, makeActor(role))).toEqual({
        refs: { quoteErfNumber: '26367', erfRefs: ['26367'] },
        linkage: { status: 'match' },
        nested: { erf: { erfNumber: '26367', plant: 'CHI' } },
      });
    }
    for (const role of ['Pricing', 'EngLead', 'Approver', 'Leadership', 'Admin'] as const) {
      expect(redact(context, makeActor(role))).toEqual(context);
    }
    expect(redact({ pricingContext: { x: 1 }, keep: 1 }, makeActor('KAM'))).toEqual({ keep: 1 });
  });
});
