import { describe, expect, it } from 'vitest';

import { reworkHeadline, stageEntriesText } from './quote-header-text';

describe('reworkHeadline', () => {
  it('names who returned the quote and the gate by its configured label, never "G1"', () => {
    expect(reworkHeadline('Sam Reyes', 'Qualify & prioritize')).toBe(
      'Returned by Sam Reyes at Qualify & prioritize',
    );
    expect(reworkHeadline('Jim Zweifel', 'Feasible solution?')).toBe(
      'Returned by Jim Zweifel at Feasible solution?',
    );
  });

  it('still reads as a sentence when the decider is not known', () => {
    expect(reworkHeadline(null, 'Price approved')).toBe('Returned for rework at Price approved');
  });
});

describe('stageEntriesText', () => {
  it('says nothing for a single stay', () => {
    expect(stageEntriesText(0)).toBeNull();
    expect(stageEntriesText(1)).toBeNull();
  });

  it('counts the entries in words a reader does not have to decode', () => {
    expect(stageEntriesText(2)).toBe('entered this stage twice');
    expect(stageEntriesText(3)).toBe('entered this stage 3 times');
    expect(stageEntriesText(11)).toBe('entered this stage 11 times');
  });
});
