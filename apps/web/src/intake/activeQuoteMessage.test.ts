import { describe, expect, it } from 'vitest';

import { oneQuotePerOpportunityMessage } from './activeQuoteMessage';

describe('oneQuotePerOpportunityMessage (FB-33, N19-20)', () => {
  it('spells out Commercial Capital Quote and lists the open quote numbers', () => {
    expect(oneQuotePerOpportunityMessage(['CCQ-2026-00012'])).toBe(
      'This opportunity already has an active Commercial Capital Quote (CCQ-2026-00012). There is one quote per opportunity.',
    );
    expect(oneQuotePerOpportunityMessage(['CCQ-2026-00012', 'CCQ-2026-00013'])).toContain(
      '(CCQ-2026-00012, CCQ-2026-00013)',
    );
  });
});
