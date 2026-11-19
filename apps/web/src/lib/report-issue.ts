import type { FeedbackType } from '@ccq/domain';

/**
 * FB-27 (N17-35): the "Report an issue" form's blank state and its Send rule. Cancel, Esc, clicking
 * outside and a successful send all return the form to `BLANK_REPORT`, so a half-written report is not
 * waiting the next time the dialog opens.
 */
export const BLANK_REPORT = { type: 'bug' as FeedbackType, severity: 3, description: '' };

/** The fewest characters a description needs before Send is enabled (the API's rule). */
export const MIN_DESCRIPTION_CHARS = 5;

export const isDescriptionTooShort = (description: string): boolean =>
  description.trim().length < MIN_DESCRIPTION_CHARS;

/** Why Send is disabled, in words; null once the description is long enough. */
export const sendDisabledReason = (description: string): string | null =>
  isDescriptionTooShort(description)
    ? `Describe the issue in at least ${MIN_DESCRIPTION_CHARS} characters.`
    : null;

export const REPORT_SENT_TITLE = 'Thanks: your report was sent';
