import { describe, expect, it } from 'vitest';

import {
  dateOnly,
  mapAccount,
  mapAll,
  mapOpportunity,
  mapOpportunityRecord,
  mapProductSpec,
  num,
  opportunityQualityFlags,
  str,
  timestamp,
} from './mapper';

/**
 * Fixture SOQL responses, shaped like jsforce returns them (with `attributes` envelopes), covering
 * what discovery found in the backfilled data: blanks, nulls, placeholder amounts, no account.
 */
const SOQL_OPPORTUNITIES = {
  totalSize: 4,
  done: true,
  records: [
    {
      attributes: { type: 'Opportunity', url: '/services/data/v62.0/sobjects/Opportunity/006A' },
      Id: '006000000000001AAA',
      Name: 'Northwind CHI / Briny Gherkin / 1 gallon HDPE Natural 110-400',
      AccountId: '001000000000001AAA',
      Account: {
        attributes: { type: 'Account' },
        Name: 'Northwind Foods (synthetic)',
        ShippingStreet: '1 Test Way\nDock 4',
        ShippingCity: 'Chicago',
        ShippingState: 'IL',
        ShippingPostalCode: '60601',
        ShippingCountry: 'US',
      },
      OwnerId: '005000000000001AAA',
      Owner: {
        attributes: { type: 'User' },
        Name: 'Test Kam',
        Alias: 'tkam',
        Email: 'Test.Kam@Example.com',
      },
      Amount: 125000,
      CloseDate: '2026-12-31',
      StageName: 'Quoting',
      IsClosed: false,
      IsWon: false,
      ERF_Number__c: ' ERF-2026-00042 ',
      Quote_Source__c: 'CCQ',
      SystemModstamp: '2026-10-15T15:00:00.000+0000',
    },
    {
      // Placeholder amount, blank text fields, no account (a not-yet-established customer).
      attributes: { type: 'Opportunity' },
      Id: '006000000000002AAA',
      Name: '  ',
      AccountId: null,
      Account: null,
      OwnerId: '005000000000001AAA',
      Owner: { Name: 'Test Kam', Alias: 'tkam', Email: null },
      Amount: 0.31,
      CloseDate: null,
      StageName: 'Closed Won – Product Shipping',
      IsClosed: true,
      IsWon: true,
      ERF_Number__c: '',
      Quote_Source__c: null,
      SystemModstamp: '2026-10-14T09:30:00.000Z',
    },
    {
      // Blank amount; the custom fields absent (not in the org yet), owner missing.
      Id: '006000000000003AAA',
      Name: 'Amount blank',
      AccountId: '001000000000003AAA',
      Account: { Name: 'Third (synthetic)' },
      Owner: null,
      Amount: null,
      CloseDate: '2027-01-15T00:00:00.000Z',
      StageName: 'Negotiating',
      IsClosed: false,
      IsWon: false,
    },
    { attributes: { type: 'Opportunity' }, Name: 'No Id: dropped' },
  ],
};

describe('scalar coercion', () => {
  it('str trims, blanks become null, numbers become text', () => {
    expect(str('  x ')).toBe('x');
    expect(str('   ')).toBeNull();
    expect(str(null)).toBeNull();
    expect(str(42)).toBe('42');
    expect(str({})).toBeNull();
  });

  it('num accepts numbers and numeric strings only', () => {
    expect(num(12.5)).toBe(12.5);
    expect(num('$1,250.00')).toBe(1250);
    expect(num('n/a')).toBeNull();
    expect(num(Number.NaN)).toBeNull();
    expect(num(null)).toBeNull();
  });

  it('dates and timestamps', () => {
    expect(dateOnly('2026-12-31')).toBe('2026-12-31');
    expect(dateOnly('2027-01-15T00:00:00.000Z')).toBe('2027-01-15');
    expect(dateOnly('31/12/2026')).toBeNull();
    expect(timestamp('2026-10-15T15:00:00.000+0000')).toBe('2026-10-15T15:00:00.000Z');
    expect(timestamp('2026-10-15T10:00:00.000-0500')).toBe('2026-10-15T15:00:00.000Z');
    expect(timestamp('garbage')).toBeNull();
  });
});

describe('mapOpportunity', () => {
  const [full, placeholder, blank, noId] = SOQL_OPPORTUNITIES.records;

  it('maps a complete record, trimming and lower-casing where it matters', () => {
    expect(mapOpportunity(full!)).toEqual({
      id: '006000000000001AAA',
      name: 'Northwind CHI / Briny Gherkin / 1 gallon HDPE Natural 110-400',
      accountId: '001000000000001AAA',
      accountName: 'Northwind Foods (synthetic)',
      ownerId: '005000000000001AAA',
      ownerName: 'Test Kam',
      ownerAlias: 'tkam',
      ownerEmail: 'test.kam@example.com',
      amount: 125000,
      closeDate: '2026-12-31',
      stage: 'Quoting',
      isClosed: false,
      isWon: false,
      erfNumber: 'ERF-2026-00042',
      quoteSource: 'CCQ',
      systemModstamp: '2026-10-15T15:00:00.000Z',
      dataQuality: [],
    });
  });

  it('keeps a placeholder amount but flags it, and handles a missing account', () => {
    const o = mapOpportunity(placeholder!)!;
    expect(o.name).toBe('(unnamed opportunity)');
    expect(o.amount).toBe(0.31);
    expect(o.accountId).toBeNull();
    expect(o.accountName).toBeNull();
    expect(o.erfNumber).toBeNull();
    expect(o.isClosed && o.isWon).toBe(true);
    expect(o.dataQuality).toEqual(['amount_suspect', 'account_missing', 'close_date_missing']);
  });

  it('blank amount, absent custom fields and a null owner map to null', () => {
    const o = mapOpportunity(blank!)!;
    expect(o.amount).toBeNull();
    expect(o.erfNumber).toBeNull();
    expect(o.quoteSource).toBeNull();
    expect(o.ownerEmail).toBeNull();
    expect(o.closeDate).toBe('2027-01-15');
    expect(o.dataQuality).toEqual(['amount_missing', 'owner_missing']);
  });

  it('drops a record without an Id', () => {
    expect(mapOpportunity(noId!)).toBeNull();
    const { items, dropped } = mapAll(SOQL_OPPORTUNITIES.records, (r) => mapOpportunity(r));
    expect(items).toHaveLength(3);
    expect(dropped).toBe(1);
  });

  it('suspect threshold is configurable (the sf_amount_suspect_below_usd setting)', () => {
    const o = { amount: 250, accountId: 'x', ownerEmail: 'a', ownerAlias: null, closeDate: 'd' };
    expect(opportunityQualityFlags(o)).toEqual([]);
    expect(opportunityQualityFlags(o, { suspectAmountBelow: 500 })).toEqual(['amount_suspect']);
    expect(opportunityQualityFlags({ ...o, amount: 99.99 })).toEqual(['amount_suspect']);
    expect(opportunityQualityFlags({ ...o, amount: 100 })).toEqual([]);
  });
});

describe('mapOpportunityRecord', () => {
  it('builds the account and structured ship-to from the Account relationship', () => {
    const rec = mapOpportunityRecord(SOQL_OPPORTUNITIES.records[0]!)!;
    expect(rec.account).toEqual({
      id: '001000000000001AAA',
      name: 'Northwind Foods (synthetic)',
      shipTo: { line1: '1 Test Way', city: 'Chicago', state: 'IL', postal: '60601', country: 'US' },
    });
    // raw keeps the payload minus SF's attributes envelopes.
    expect(rec.raw).not.toHaveProperty('attributes');
    expect(rec.raw.Account).not.toHaveProperty('attributes');
    expect((rec.raw.Owner as Record<string, unknown>).Alias).toBe('tkam');
  });

  it('no account when AccountId is null; account without address has shipTo null', () => {
    expect(mapOpportunityRecord(SOQL_OPPORTUNITIES.records[1]!)!.account).toBeNull();
    expect(mapOpportunityRecord(SOQL_OPPORTUNITIES.records[2]!)!.account).toEqual({
      id: '001000000000003AAA',
      name: 'Third (synthetic)',
      shipTo: null,
    });
  });
});

describe('mapAccount / mapProductSpec', () => {
  it('maps an Account query row with a partial address', () => {
    expect(
      mapAccount({
        Id: '001000000000009AAA',
        Name: null,
        ShippingCity: 'Toledo',
        ShippingState: '',
      }),
    ).toEqual({
      id: '001000000000009AAA',
      name: '(unnamed account)',
      shipTo: { line1: null, city: 'Toledo', state: null, postal: null, country: null },
    });
    expect(mapAccount({ Name: 'no id' })).toBeNull();
  });

  it('maps a product spec row; numeric text volume is parsed', () => {
    expect(
      mapProductSpec({
        Id: 'a0P000000000001AAA',
        Name: 'PS-1',
        Opportunity__c: '006000000000001AAA',
        Product_Type__c: 'BOTTLE',
        Resin__c: 'HDPE',
        Capacity__c: '128 oz',
        Neck_Finish__c: '110-400',
        Color__c: null,
        Annual_Volume__c: '250000',
      }),
    ).toEqual({
      id: 'a0P000000000001AAA',
      opportunityId: '006000000000001AAA',
      name: 'PS-1',
      productType: 'BOTTLE',
      resin: 'HDPE',
      capacity: '128 oz',
      neckFinish: '110-400',
      color: null,
      annualVolume: 250000,
    });
    expect(mapProductSpec({ Id: 'a0P000000000001AAA' })).toBeNull(); // no opportunity link
  });
});
