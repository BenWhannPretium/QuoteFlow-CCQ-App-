import { describe, expect, it } from 'vitest';

import { OPPORTUNITY_OBJECT, PRODUCT_SPEC_OBJECT } from './fieldMap';
import { searchTerms } from './reader';
import {
  assertSfId,
  changedOpportunitiesSoql,
  dateTimeLiteral,
  likeContains,
  literal,
  opportunitySelect,
  productSpecsSoql,
  searchSoql,
} from './soql';

describe('escaping', () => {
  it('quotes and backslashes are escaped in literals', () => {
    expect(literal("O'Brien")).toBe("'O\\'Brien'");
    expect(literal('a\\b')).toBe("'a\\\\b'");
  });

  it('LIKE wildcards in a term are escaped', () => {
    expect(likeContains('50%_off')).toBe("'%50\\%\\_off%'");
    expect(likeContains("x' OR Name != '")).toBe("'%x\\' OR Name != \\'%'");
  });

  it('ids are validated before being inlined', () => {
    expect(assertSfId('006000000000001AAA')).toBe('006000000000001AAA');
    expect(() => assertSfId("006' OR Id != '")).toThrow('Not a Salesforce id');
  });

  it('datetime literals are UTC with second precision', () => {
    expect(dateTimeLiteral(new Date('2026-10-15T15:00:00.123Z'))).toBe('2026-10-15T15:00:00Z');
  });
});

describe('searchTerms', () => {
  it('splits the free-text names the way people type them', () => {
    expect(searchTerms('Berlin CHI / Puckered Pickle / 1 gallon HDPE 110-400')).toEqual([
      'berlin',
      'chi',
      'puckered',
      'pickle',
      'gallon',
      'hdpe',
    ]);
    expect(searchTerms('  110-400, 1.5L ')).toEqual(['110-400', '1.5l']);
    expect(searchTerms('a')).toEqual([]);
  });
});

describe('SOQL', () => {
  it('selects explicit fields, including the account ship-to through the relationship', () => {
    const select = opportunitySelect();
    expect(select).toContain('Owner.Email');
    expect(select).toContain('Account.ShippingPostalCode');
    expect(select).toContain('ERF_Number__c');
    expect(select).not.toMatch(/FIELDS\(/);
  });

  it('drops custom fields the org does not have', () => {
    const available = { [OPPORTUNITY_OBJECT]: new Set(['Id', 'Name']) };
    const select = opportunitySelect(available);
    expect(select).not.toContain('ERF_Number__c');
    expect(select).not.toContain('Quote_Source__c');
    expect(select).toContain('StageName'); // standard fields are always selected
  });

  it('search: every term must match the name or the account; owner and open filters', () => {
    const soql = searchSoql({
      terms: ['pickle', 'hdpe'],
      ownerEmail: 'kam@example.com',
      openOnly: true,
      limit: 500,
    });
    expect(soql).toContain("(Name LIKE '%pickle%' OR Account.Name LIKE '%pickle%')");
    expect(soql).toContain(" AND (Name LIKE '%hdpe%' OR Account.Name LIKE '%hdpe%')");
    expect(soql).toContain("Owner.Email = 'kam@example.com'");
    expect(soql).toContain('IsClosed = false');
    expect(soql).toMatch(/LIMIT 200$/);
  });

  it('delta: SystemModstamp window, ordered for queryMore', () => {
    expect(changedOpportunitiesSoql(new Date('2026-10-15T15:00:00Z'))).toMatch(
      /WHERE SystemModstamp > 2026-10-15T15:00:00Z ORDER BY SystemModstamp ASC, Id ASC$/,
    );
    expect(changedOpportunitiesSoql(null)).not.toContain('WHERE');
  });

  it('product specs need the lookup to Opportunity to exist', () => {
    expect(productSpecsSoql('006000000000001AAA')).toContain(
      "WHERE Opportunity__c = '006000000000001AAA'",
    );
    expect(
      productSpecsSoql('006000000000001AAA', { [PRODUCT_SPEC_OBJECT]: new Set(['Id', 'Name']) }),
    ).toBeNull();
  });
});
