import { describe, expect, it } from 'vitest';

import { quoteEmailPath } from './emailContent';

const QN = 'CCQ-2026-00042';

/** FB-30 (N19-28): where the engineering and capacity emails open the quote. */
describe('quoteEmailPath: the engineering and capacity notices', () => {
  it('opens the Capacity tab for the production scheduler’s notices', () => {
    expect(quoteEmailPath('quote.capacity_assigned', QN)).toBe(`/quotes/${QN}?tab=capacity`);
    expect(quoteEmailPath('quote.capacity_ready', QN, { plant: 'Aurora', machine: 'EBM' })).toBe(
      `/quotes/${QN}?tab=capacity`,
    );
  });

  it('keeps a capacity block (to the engineer) and the engineer’s notices on Engineering', () => {
    expect(quoteEmailPath('quote.capacity_blocked', QN)).toBe(`/quotes/${QN}?tab=engineering`);
    expect(quoteEmailPath('quote.assigned', QN)).toBe(`/quotes/${QN}?tab=engineering`);
    expect(quoteEmailPath('quote.ready_for_eng_review', QN)).toBe(`/quotes/${QN}?tab=engineering`);
  });

  it('opens the tab of the part that was submitted, Engineering when the notice does not say', () => {
    expect(
      quoteEmailPath('quote.part_submitted', QN, { kind: 'engineering', part: 'scheduler' }),
    ).toBe(`/quotes/${QN}?tab=capacity`);
    expect(
      quoteEmailPath('quote.part_submitted', QN, { kind: 'engineering', part: 'engineer' }),
    ).toBe(`/quotes/${QN}?tab=engineering`);
    expect(quoteEmailPath('quote.part_submitted', QN)).toBe(`/quotes/${QN}?tab=engineering`);
  });

  it('leaves the lead’s and the other notices as they were', () => {
    expect(quoteEmailPath('quote.submitted_to_lead', QN, { kind: 'engineering' })).toBe(
      `/quotes/${QN}?tab=engineering`,
    );
    expect(quoteEmailPath('quote.submitted_to_lead', QN, { kind: 'pricing' })).toBe(
      `/quotes/${QN}?tab=quoting`,
    );
    expect(quoteEmailPath('quote.ready_for_final_review', QN)).toBe(`/quotes/${QN}/review`);
    expect(quoteEmailPath('quote.progress', QN)).toBe(`/quotes/${QN}`);
  });
});
