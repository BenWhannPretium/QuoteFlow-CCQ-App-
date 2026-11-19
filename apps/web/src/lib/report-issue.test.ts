import { describe, expect, it } from 'vitest';

import {
  BLANK_REPORT,
  MIN_DESCRIPTION_CHARS,
  REPORT_SENT_TITLE,
  isDescriptionTooShort,
  sendDisabledReason,
} from './report-issue';

// FB-27 (N17-35): Send waits for five characters, and the form says so; Cancel returns to the blank form.
describe('Report an issue', () => {
  it('says why Send is disabled, until the description is long enough', () => {
    expect(MIN_DESCRIPTION_CHARS).toBe(5);
    expect(sendDisabledReason('')).toBe('Describe the issue in at least 5 characters.');
    expect(sendDisabledReason('abcd')).toBe('Describe the issue in at least 5 characters.');
    // Spaces do not count.
    expect(sendDisabledReason('  ab  ')).toBe('Describe the issue in at least 5 characters.');
    expect(sendDisabledReason('abcde')).toBeNull();
    expect(isDescriptionTooShort('abcde')).toBe(false);
    expect(isDescriptionTooShort('abcd')).toBe(true);
  });

  it('the blank form is a bug of middling severity with no text', () => {
    expect(BLANK_REPORT).toEqual({ type: 'bug', severity: 3, description: '' });
  });

  it('says the report was sent in the agreed words', () => {
    expect(REPORT_SENT_TITLE).toBe('Thanks: your report was sent');
  });
});
