import { describe, expect, it } from 'vitest';

import {
  parseSalesforceInstanceUrl,
  parseSfOutcomeStageNames,
  SF_OUTCOME_STAGE_NAMES_SEED,
  salesforceOpportunityUrl,
  sfStageForOutcome,
} from './sf-stage';

describe('Salesforce link (F-076)', () => {
  it('builds the Lightning record link, or null while the instance URL is not set', () => {
    expect(
      salesforceOpportunityUrl('https://pretium.lightning.force.com', '006SYN000000000001'),
    ).toBe('https://pretium.lightning.force.com/lightning/r/Opportunity/006SYN000000000001/view');
    expect(
      salesforceOpportunityUrl('https://pretium.lightning.force.com/', '006SYN000000000001'),
    ).toBe('https://pretium.lightning.force.com/lightning/r/Opportunity/006SYN000000000001/view');
    expect(salesforceOpportunityUrl('', '006SYN000000000001')).toBeNull();
    expect(salesforceOpportunityUrl(null, '006SYN000000000001')).toBeNull();
    expect(salesforceOpportunityUrl('https://x.example', '')).toBeNull();
  });

  it('the instance URL is empty or an https origin', () => {
    expect(parseSalesforceInstanceUrl('')).toBe('');
    expect(parseSalesforceInstanceUrl(null)).toBe('');
    expect(parseSalesforceInstanceUrl(' https://pretium.lightning.force.com/some/path ')).toBe(
      'https://pretium.lightning.force.com',
    );
    expect(() => parseSalesforceInstanceUrl('http://pretium.lightning.force.com')).toThrow(/https/);
    expect(() => parseSalesforceInstanceUrl('not a url')).toThrow(/valid URL/);
    expect(() => parseSalesforceInstanceUrl(5)).toThrow(/text/);
  });

  it('maps each G5 outcome to the Salesforce stage named in the reminder', () => {
    expect(sfStageForOutcome('awarded', SF_OUTCOME_STAGE_NAMES_SEED)).toBe('Verbal Award');
    expect(sfStageForOutcome('lost', SF_OUTCOME_STAGE_NAMES_SEED)).toBe('Closed Lost');
    expect(sfStageForOutcome('expired', SF_OUTCOME_STAGE_NAMES_SEED)).toBe('Closed Lost');
    expect(sfStageForOutcome('negotiating', SF_OUTCOME_STAGE_NAMES_SEED)).toBe('Negotiating');
    expect(sfStageForOutcome('requote', SF_OUTCOME_STAGE_NAMES_SEED)).toBe('Quoting');
    expect(sfStageForOutcome('on_hold', SF_OUTCOME_STAGE_NAMES_SEED)).toBeNull();
  });

  it('validates the outcome → stage map', () => {
    expect(parseSfOutcomeStageNames({ awarded: ' Verbal Award ' })).toEqual({
      awarded: 'Verbal Award',
    });
    expect(() => parseSfOutcomeStageNames([])).toThrow(/object/);
    expect(() => parseSfOutcomeStageNames({ awarded: '' })).toThrow(/needs a stage name/);
  });
});
