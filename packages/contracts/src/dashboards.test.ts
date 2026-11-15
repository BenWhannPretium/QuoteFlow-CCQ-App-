import { describe, expect, it } from 'vitest';

import { DashHold, DashQuote, ExpiringProposal, QuoteDetail, QuoteSummary } from './index';

/** FB-18: the dashboard rows carry the hold, and every quote summary carries the Salesforce link. */
const row = {
  quoteNumber: 'CCQ-2026-00042',
  account: 'Synthetic Bottling Co',
  stageKey: 'ENG_REVIEW',
  stageLabel: 'Engineering & Capacity',
  tier: 'HIGH',
  status: 'on_hold',
  kamName: 'Kim Kam',
  daysInStage: 4,
};
const hold = {
  reasonLabel: 'Awaiting customer information',
  ownerName: 'Erin Engineer',
  reviewDate: '2026-12-12',
};

describe('dashboard rows (W13-26)', () => {
  it('a quote row carries its hold, or null when it is not on hold', () => {
    expect(DashQuote.parse({ ...row, hold }).hold).toEqual(hold);
    expect(DashQuote.parse({ ...row, status: 'active', hold: null }).hold).toBeNull();
    // The field is part of the contract: a row without it is not a dashboard row.
    expect(DashQuote.safeParse(row).success).toBe(false);
  });

  it('each part of a hold may be unknown', () => {
    expect(DashHold.parse({ reasonLabel: null, ownerName: null, reviewDate: null })).toEqual({
      reasonLabel: null,
      ownerName: null,
      reviewDate: null,
    });
    expect(DashHold.safeParse({ ownerName: 'Erin Engineer' }).success).toBe(false);
  });

  it('an expiring proposal carries its hold too', () => {
    const proposal = {
      quoteNumber: 'CCQ-2026-00043',
      account: 'Synthetic Bottling Co',
      validityUntil: '2026-11-20',
      daysLeft: 5,
      lapsed: false,
      kamName: 'Kim Kam',
    };
    expect(ExpiringProposal.parse({ ...proposal, hold }).hold).toEqual(hold);
    expect(ExpiringProposal.parse({ ...proposal, hold: null }).hold).toBeNull();
  });
});

describe('the Salesforce link (W13-31)', () => {
  it('is on the quote summary, so the lists and the quote page share one field', () => {
    expect(Object.keys(QuoteSummary.shape)).toContain('sfOpportunityUrl');
    expect(Object.keys(QuoteDetail.shape)).toContain('sfOpportunityUrl');
    const field = QuoteSummary.shape.sfOpportunityUrl;
    const url = 'https://example.test/lightning/r/Opportunity/006SYN000000000001/view';
    expect(field.safeParse(null).success).toBe(true);
    expect(field.safeParse(url).success).toBe(true);
    expect(field.safeParse(undefined).success).toBe(false);
  });
});
