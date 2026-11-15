import { describe, expect, it } from 'vitest';

import { holdEndedSummary, holdSummary } from './hold-text';

describe('holdSummary', () => {
  it('names the reason, the owner and the review date', () => {
    expect(
      holdSummary({
        reasonLabel: 'Awaiting internal input',
        ownerName: 'Avery Stone',
        reviewDate: '2026-12-01',
      }),
    ).toBe('On hold: Awaiting internal input. Owner: Avery Stone. Review by Dec 1, 2026.');
  });

  it('leaves out what is not known', () => {
    expect(holdSummary({ reasonLabel: 'Awaiting customer information' })).toBe(
      'On hold: Awaiting customer information.',
    );
    expect(holdSummary({ ownerName: 'Avery Stone', reviewDate: '2026-12-01' })).toBe(
      'On hold. Owner: Avery Stone. Review by Dec 1, 2026.',
    );
    expect(holdSummary({ reviewDate: '2026-12-01' })).toBe('On hold. Review by Dec 1, 2026.');
    // A hold recorded before FB-17 carries none of it on its timeline entry.
    expect(holdSummary({})).toBe('On hold');
    expect(holdSummary({ reasonLabel: null, ownerName: null, reviewDate: null })).toBe('On hold');
  });
});

describe('holdEndedSummary', () => {
  it('says who ended it and with which decision', () => {
    expect(holdEndedSummary({ actorName: 'Jordan Reyes', outcomeLabel: 'Advance' })).toBe(
      'Hold ended: Jordan Reyes recorded “Advance”',
    );
    expect(holdEndedSummary({ actorName: null, outcomeLabel: 'Stop' })).toBe(
      'Hold ended: someone recorded “Stop”',
    );
  });

  it('reads as before for an entry without the decision', () => {
    expect(holdEndedSummary({ actorName: 'Jordan Reyes' })).toBe('Hold ended');
    expect(holdEndedSummary({})).toBe('Hold ended');
  });
});
