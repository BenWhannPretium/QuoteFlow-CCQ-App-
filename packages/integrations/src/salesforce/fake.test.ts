import { describe, expect, it } from 'vitest';

import { FakeSalesforceReader, termScore } from './fake';
import { loadSyntheticFixture } from './fixtures/index';

const reader = () => new FakeSalesforceReader(loadSyntheticFixture());

describe('FakeSalesforceReader over the synthetic fixture', () => {
  it('serves the 102 synthetic opportunities', () => {
    expect(reader().size).toBe(102);
  });

  it('search matches every term against name or account, case-insensitive', async () => {
    const r = reader();
    const results = await r.searchOpportunities({ q: 'HDPE Oval', openOnly: false, limit: 50 });
    expect(results.length).toBeGreaterThan(0);
    for (const o of results) expect(`${o.name}`.toLowerCase()).toMatch(/hdpe.*oval|oval.*hdpe/);
  });

  it('search tolerates a typo (fuzzy)', async () => {
    const exact = await reader().searchOpportunities({ q: 'packaging', openOnly: false, limit: 5 });
    const typo = await reader().searchOpportunities({ q: 'pakaging', openOnly: false, limit: 5 });
    expect(typo.length).toBe(exact.length);
    expect(termScore('pickel', 'Puckered Pickle 1 gallon')).toBeGreaterThan(0);
    expect(termScore('zzzz', 'Puckered Pickle')).toBe(0);
  });

  it('openOnly hides closed opportunities; ownerEmail filters by SF owner', async () => {
    const all = await reader().searchOpportunities({ q: '', openOnly: false, limit: 500 });
    const open = await reader().searchOpportunities({ q: '', openOnly: true, limit: 500 });
    expect(all.some((o) => o.isClosed)).toBe(true);
    expect(open.every((o) => !o.isClosed)).toBe(true);
    const email = all[0]!.ownerEmail!;
    const mine = await reader().searchOpportunities({
      q: '',
      ownerEmail: email.toUpperCase(),
      openOnly: false,
      limit: 500,
    });
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((o) => o.ownerEmail === email)).toBe(true);
  });

  it('carries the messy cases: placeholder and blank amounts, no account', async () => {
    const all = await reader().searchOpportunities({ q: '', openOnly: false, limit: 500 });
    expect(all.find((o) => o.amount === 0.31)?.dataQuality).toContain('amount_suspect');
    expect(all.some((o) => o.dataQuality.includes('amount_missing'))).toBe(true);
    expect(all.some((o) => o.dataQuality.includes('account_missing'))).toBe(true);
    expect(all.some((o) => o.erfNumber !== null)).toBe(true);
  });

  it('getOpportunity returns the account with a structured ship-to; unknown id → null', async () => {
    const r = reader();
    const [first] = await r.searchOpportunities({ q: '', openOnly: true, limit: 50 });
    const withAccount = (await r.searchOpportunities({ q: '', openOnly: false, limit: 500 })).find(
      (o) => o.accountId,
    )!;
    const rec = (await r.getOpportunity(withAccount.id))!;
    expect(rec.account?.id).toBe(withAccount.accountId);
    expect(rec.account?.shipTo).toMatchObject({ state: expect.any(String) as string });
    expect(await r.getAccount(withAccount.accountId!)).toEqual(rec.account);
    expect(await r.getOpportunity('006000000000000AAA')).toBeNull();
    expect(first).toBeDefined();
  });

  it('delta: only records modified after `since`, oldest first, paged', async () => {
    const r = reader();
    const pages = [];
    for await (const page of r.listChangedOpportunities(null)) pages.push(page);
    const all = pages.flat();
    expect(all).toHaveLength(102);
    const stamps = all.map((x) => x.opportunity.systemModstamp!);
    expect([...stamps].sort()).toEqual(stamps);

    const since = new Date(stamps[90]!);
    const later = [];
    for await (const page of r.listChangedOpportunities(since)) later.push(...page);
    expect(later.every((x) => x.opportunity.systemModstamp! > since.toISOString())).toBe(true);
    expect(later.length).toBeLessThan(12);
  });

  it('put / remove simulate edits and deletes in SF', async () => {
    const r = reader();
    const [rec] = await r.searchOpportunities({ q: '', openOnly: false, limit: 1 });
    const raw = r.raw(rec!.id)!;
    r.put({
      ...raw,
      StageName: 'Closed Lost',
      IsClosed: true,
      SystemModstamp: '2030-01-01T00:00:00.000+0000',
    });
    const changed = [];
    for await (const page of r.listChangedOpportunities(new Date('2029-12-31T00:00:00Z'))) {
      changed.push(...page);
    }
    expect(changed.map((c) => c.opportunity.stage)).toEqual(['Closed Lost']);

    r.remove(rec!.id, new Date('2030-01-02T00:00:00Z'));
    expect(await r.getOpportunity(rec!.id)).toBeNull();
    expect(
      await r.listDeletedOpportunityIds(
        new Date('2030-01-01T00:00:00Z'),
        new Date('2030-01-03T00:00:00Z'),
      ),
    ).toEqual([rec!.id]);
  });

  it('product specs for an opportunity', async () => {
    const fixture = loadSyntheticFixture();
    const oppId = fixture.productSpecs[0]!.Opportunity__c as string;
    const specs = await new FakeSalesforceReader(fixture).getProductSpecs(oppId);
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.every((s) => s.opportunityId === oppId)).toBe(true);
  });

  it('failWith makes every call reject (to test failure handling)', async () => {
    const r = reader();
    r.failWith = Object.assign(new Error('limit'), { errorCode: 'REQUEST_LIMIT_EXCEEDED' });
    await expect(r.getOpportunity('006000000000000AAA')).rejects.toThrow('limit');
  });
});
