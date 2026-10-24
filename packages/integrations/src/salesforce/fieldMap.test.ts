import { describe, expect, it } from 'vitest';

import { MAPPED_OBJECTS, type FieldRef } from './fieldMap';

/**
 * The integration user can read the org's commercial fields (Gross Margin, Piece Part Price, Cost,
 * Capital Estimate, Line Unit Price, …). CCQ reads Salesforce as one user for everyone and controls
 * visibility itself, so none of them may be mapped: a sensitive figure would reach the snapshot and
 * every role. Mapping one needs CCQ's field-sensitivity rules first (CLAUDE.md rule 2).
 */
const SENSITIVE = /price|cost|margin|revenue|discount|capital|subtotal|amount/i;
/** The opportunity amount is visible to everyone in CCQ, as in Salesforce (04-decisions). */
const ALLOWED = new Set(['Amount']);

const mappedPaths = Object.entries(MAPPED_OBJECTS).flatMap(([object, map]) =>
  Object.values<FieldRef>(map).map((ref) => `${object}.${ref.path}`),
);

describe('fieldMap', () => {
  it('maps no price, cost, margin, revenue or capital field', () => {
    const sensitive = mappedPaths.filter((p) => {
      const field = p.slice(p.indexOf('.') + 1);
      return SENSITIVE.test(field) && !ALLOWED.has(field);
    });
    expect(sensitive).toEqual([]);
  });

  it('the guard catches the org fields it exists for', () => {
    for (const field of [
      'Estimated_Firm_Gross_Margin__c',
      'Piece_Part_Price_EACH_PRICE__c',
      'CapitalEstimate__c',
      'Cost_Total_Dollar_Per_M__c',
      'Line_Unit_Price__c',
      'Expected_Revenue__c',
      'Amount_Gross_Margin__c',
    ]) {
      expect(SENSITIVE.test(field), field).toBe(true);
    }
  });
});
