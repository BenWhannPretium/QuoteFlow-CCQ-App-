import { describe, expect, it } from 'vitest';

import { capitalTermsSegregation, capitalTermsSegregationMessage } from './capital-terms';
import { KAM_ID, OTHER_ID, makeActor, makeQuote } from '../test-utils';
import { asUserId } from '../types/ids';
import { hybridConfig } from '../workflow/seeds';

/** DR-approver-leadership-admin-01: the G4 segregation rules also bar the capital terms. */
describe('capitalTermsSegregation', () => {
  const quote = makeQuote('FINAL_REVIEW');

  it("bars the quote's KAM, even when they also hold the Approver role", () => {
    const actor = makeActor(['SalesLeader', 'Approver'], { userId: KAM_ID });
    const rules = capitalTermsSegregation(hybridConfig, quote, actor);
    expect(rules.map((r) => r.id)).toEqual(['g4-kam-cannot-approve-own']);
    expect(capitalTermsSegregationMessage(rules)).toBe(
      'Another approver edits and confirms the capital terms: you cannot decide Final Review on a quote where you are the KAM.',
    );
  });

  it('bars the price approver', () => {
    const priced = makeQuote('FINAL_REVIEW', { priceApproverIds: [OTHER_ID] });
    const rules = capitalTermsSegregation(hybridConfig, priced, makeActor('Approver'));
    expect(rules.map((r) => r.id)).toEqual(['g4-price-approver-cannot-release']);
  });

  it('allows any other approver', () => {
    const actor = makeActor('Approver', { userId: asUserId('user-approver') });
    expect(capitalTermsSegregation(hybridConfig, quote, actor)).toEqual([]);
    expect(capitalTermsSegregationMessage([])).toBeNull();
  });

  it('follows the config: no G4 rule, no bar', () => {
    const config = { ...hybridConfig, segregation: [] };
    const actor = makeActor('Approver', { userId: KAM_ID });
    expect(capitalTermsSegregation(config, quote, actor)).toEqual([]);
  });
});
