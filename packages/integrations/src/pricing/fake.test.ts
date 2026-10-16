import { PricingBpr, PricingErf, PricingSpr } from '@ccq/contracts';
import { describe, expect, it } from 'vitest';

import { PRICING_COLUMNS } from './columnMap';
import { createPricingReader } from './create';
import { FakePricingReader } from './fake';
import { syntheticPricingFixture } from './fixtures';
import { mapErf } from './mapper';
import { clampLimit, refKey } from './reader';
import { loadSyntheticFixture } from '../salesforce/fixtures/index';

const C = PRICING_COLUMNS;
const strict = () => new FakePricingReader(syntheticPricingFixture());

describe('synthetic pricing fixture', () => {
  const fixture = syntheticPricingFixture();

  it('is deterministic and synthetic only', () => {
    expect(syntheticPricingFixture()).toEqual(fixture);
    for (const row of fixture.erf) {
      const customer = row[C.erf.customerName.column];
      if (typeof customer === 'string') expect(customer).toMatch(/synthetic/i);
    }
  });

  it('has an ERF for every SF opportunity that carries an ERF number', async () => {
    const reader = strict();
    const sf = loadSyntheticFixture().opportunities.filter((o) => o.ERF_Number__c);
    expect(sf.length).toBeGreaterThan(10);
    for (const o of sf) {
      const erf = await reader.getErf(String(o.ERF_Number__c));
      expect(erf?.sfOpportunityId).toBe(o.Id);
    }
  });

  it('mimics the legacy quirks: blank FY26 figures, varied BPR cardinality, SPRs before Nov 2025', async () => {
    const reader = strict();
    const erfs = fixture.erf.map((r) => PricingErf.parse(mapErf(r)));
    const recent = erfs.filter((e) => (e.submittedOn ?? '') >= '2025-10-01');
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.every((e) => e.estRevenueUsd === null && e.estNetCapitalUsd === null)).toBe(true);
    expect(erfs.some((e) => e.estRevenueUsd !== null)).toBe(true);

    const counts = await Promise.all(
      erfs.map(async (e) => (await reader.findBprsForErf(e.erfNumber)).length),
    );
    expect(counts).toContain(0);
    expect(Math.max(...counts)).toBeGreaterThan(1);
    expect(fixture.bpr.some((r) => r[C.bpr.erfNumber.column] === null)).toBe(true);

    expect(fixture.spr.length).toBeGreaterThan(0);
    for (const r of fixture.spr)
      expect(String(r[C.spr.requestedOn.column]) < '2025-11-01').toBe(true);
  });
});

describe('FakePricingReader', () => {
  it('looks ERFs up by number, tolerating an ERF prefix; unknown → null', async () => {
    const reader = strict();
    const number = String(syntheticPricingFixture().erf[0]![C.erf.erfNumber.column]);
    expect((await reader.getErf(`ERF-${number}`))?.erfNumber).toBe(number);
    expect((await reader.getErf(` erf ${number} `))?.erfNumber).toBe(number);
    expect(await reader.getErf('99999990')).toBeNull();
  });

  it('finds ERFs by customer, opportunity and text, newest first, capped', async () => {
    const reader = strict();
    const fixture = syntheticPricingFixture();
    const customer = String(fixture.erf[0]![C.erf.customerName.column]);
    const byCustomer = await reader.findErfs({
      customerName: customer.slice(0, 6).toUpperCase(),
      limit: 50,
    });
    expect(byCustomer.length).toBeGreaterThan(0);
    expect(
      byCustomer.every((e) =>
        e.customerName?.toLowerCase().includes(customer.slice(0, 6).toLowerCase()),
      ),
    ).toBe(true);
    const dates = byCustomer.map((e) => e.submittedOn ?? '');
    expect([...dates].sort().reverse()).toEqual(dates);

    const opp = String(fixture.erf[0]![C.erf.sfOpportunityId.column]);
    expect(
      (await reader.findErfs({ sfOpportunityId: opp, limit: 5 })).map((e) => e.sfOpportunityId),
    ).toEqual([opp]);

    expect(await reader.findErfs({ text: 'synthetic', limit: 500 })).toHaveLength(50);
    expect(await reader.findErfs({ text: 'synthetic', limit: 3 })).toHaveLength(3);
    expect(await reader.findErfs({ limit: 10 })).toEqual([]);
  });

  it('returns every BPR that follows an ERF (many) and BPRs by number', async () => {
    const reader = strict();
    reader.put('erf', {
      [C.erf.erfNumber.column]: '70001',
      [C.erf.customerName.column]: 'X (synthetic)',
    });
    for (const n of ['BPR-1', 'BPR-2', 'BPR-3']) {
      reader.put('bpr', {
        [C.bpr.bprNumber.column]: n,
        [C.bpr.erfNumber.column]: 70001,
        [C.bpr.requestedOn.column]: `2026-0${n.slice(-1)}-01`,
      });
    }
    const bprs = await reader.findBprsForErf('ERF-70001');
    expect(bprs.map((b) => b.bprNumber)).toEqual(['BPR-3', 'BPR-2', 'BPR-1']);
    for (const b of bprs) PricingBpr.parse(b);
    expect((await reader.getBpr('bpr-2'))?.bprNumber).toBe('BPR-2');
    expect(await reader.getBpr('BPR-404')).toBeNull();
  });

  it('serves SPR history by customer or item text only', async () => {
    const reader = strict();
    const spr = syntheticPricingFixture().spr[0]!;
    const history = await reader.getSprHistory({
      customerName: String(spr[C.spr.customerName.column]),
    });
    expect(history.length).toBeGreaterThan(0);
    for (const s of history) PricingSpr.parse(s);
    expect(await reader.getSprHistory({})).toEqual([]);
  });

  it('dev mode makes up a plausible ERF for an unknown number (ending in 0 stays unknown)', async () => {
    const reader = createPricingReader({ mode: 'fake' }) as FakePricingReader;
    const a = await reader.getErf('ERF-12345');
    expect(a?.erfNumber).toBe('12345');
    expect(await reader.getErf('12345')).toEqual(a);
    expect(await reader.getErf('12340')).toBeNull();
    expect(await reader.getErf('abc')).toBeNull();
    expect(Array.isArray(await reader.findBprsForErf('54321'))).toBe(true);
  });

  it('fails every call with failWith (outage) and counts calls', async () => {
    const reader = strict();
    reader.failWith = Object.assign(new Error('down'), { code: 'ESOCKET' });
    await expect(reader.getErf('1')).rejects.toThrow('down');
    await expect(reader.findErfs({ text: 'x', limit: 1 })).rejects.toThrow('down');
    expect(reader.calls).toEqual({ getErf: 1, findErfs: 1 });
  });
});

describe('reader helpers', () => {
  it('clamps limits to 1..50', () => {
    expect([clampLimit(0), clampLimit(7.9), clampLimit(500), clampLimit(undefined)]).toEqual([
      1, 7, 50, 50,
    ]);
  });

  it('normalises typed references', () => {
    expect(refKey(' ERF-26367 ', 'erf')).toBe('26367');
    expect(refKey('erf 26367', 'erf')).toBe('26367');
    expect(refKey('BPR_0042', 'bpr')).toBe('0042');
    expect(refKey('ERF-1', 'bpr')).toBe('ERF-1');
  });
});
