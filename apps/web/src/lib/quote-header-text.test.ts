import { describe, expect, it } from 'vitest';

import {
  quoteNotFoundText,
  requestReference,
  reworkHeadline,
  stageEntriesText,
} from './quote-header-text';

describe('quoteNotFoundText (UX-014)', () => {
  it('names the number, says it may be out of scope, and points to the Pipeline', () => {
    expect(quoteNotFoundText('CCQ-2026-99999')).toEqual({
      title: 'We could not find CCQ-2026-99999, or it is outside what your role can see.',
      message: 'Check the number, or search from the Pipeline.',
    });
  });

  it('does not say whether the quote exists', () => {
    const { title, message } = quoteNotFoundText('CCQ-2026-00001');
    expect(`${title} ${message}`).not.toMatch(/does not exist|no such|no quote|not found|exists/i);
  });
});

describe('requestReference (UX-014)', () => {
  it('is the request id the server put on the problem, never the API path', () => {
    expect(
      requestReference({
        status: 404,
        instance: '/api/v1/quotes/CCQ-2026-99999',
        traceId: 'req-1f',
      }),
    ).toBe('req-1f');
  });

  it('is null when there is none', () => {
    expect(requestReference({ status: 404, instance: '/api/v1/quotes/CCQ-2026-99999' })).toBeNull();
    expect(requestReference({ traceId: '  ' })).toBeNull();
    expect(requestReference({ traceId: 42 })).toBeNull();
    expect(requestReference(undefined)).toBeNull();
  });
});

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
