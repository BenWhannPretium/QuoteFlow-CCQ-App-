/**
 * The notification catalogue (B-18). Every notification `type` the app writes is listed here with how
 * it reaches people. In-app is always on and cannot be switched off; email is per type and a user can
 * opt out of it (`user_preference`). Types not listed are in-app only.
 *
 * - `immediate`: one email per notification, sent by the dispatcher within about a minute.
 * - `daily_digest`: no email per item; one email at 7:00 US Central listing everything still waiting.
 * - `none`: in-app only.
 */
export type EmailDelivery = 'immediate' | 'daily_digest' | 'none';

export interface NotificationEventDef {
  type: string;
  /** Preferences page: what the user is opting in or out of. */
  label: string;
  description: string;
  email: EmailDelivery;
}

export const NOTIFICATION_EVENTS: readonly NotificationEventDef[] = [
  {
    type: 'quote.ready_for_eng_review',
    label: 'A quote is ready for engineering review',
    description:
      'Engineering leads, backup assigners and the assigned engineer: a quote is waiting to be assigned, or came back from Pricing, Final Review or the customer.',
    email: 'immediate',
  },
  {
    type: 'quote.assigned',
    label: 'A quote is assigned or reassigned to you',
    description: 'Engineers: you have a new engineering review.',
    email: 'immediate',
  },
  {
    type: 'quote.reworked',
    label: 'A quote is returned to you for rework',
    description:
      'KAMs: qualification, engineering or pricing sent your intake back with the reason and what to fix.',
    email: 'immediate',
  },
  {
    type: 'quote.to_qualify',
    label: 'Quotes waiting to qualify (daily at 7:00 AM Central)',
    description: 'Sales leaders: one email each morning listing every quote waiting at G1.',
    email: 'daily_digest',
  },
  {
    type: 'quote.ready_for_final_review',
    label: 'A quote is awaiting Final Review',
    description:
      'Approvers: the pricing lead approved the price (G3 Price approved) and the proposition needs a decision.',
    email: 'immediate',
  },
  {
    type: 'quote.approved_for_customer',
    label: 'Final Review approved a quote',
    description: 'KAMs and the pricing approver: the proposal can be issued to the customer.',
    email: 'immediate',
  },
  {
    type: 'quote.declined',
    label: 'Final Review declined a quote',
    description: 'KAMs and Pricing: the proposition was declined with a reason.',
    email: 'immediate',
  },
  {
    type: 'comment.posted',
    label: 'Someone comments on a quote you follow',
    description:
      'The quote’s KAM, the assigned engineer or pricer, the stage lead and earlier commenters. The email says how many new comments and links to them; it never repeats the text. Several comments within a few minutes arrive as one email.',
    email: 'immediate',
  },
  {
    type: 'comment.mention',
    label: 'Someone @mentions you in a comment',
    description: 'The email says who and where; it never repeats the comment.',
    email: 'immediate',
  },
  {
    type: 'quote.validity_expiring',
    label: 'A proposal validity date is within the warning window',
    description: 'KAMs: revalidate the proposal or record the outcome before it lapses.',
    email: 'immediate',
  },
  {
    type: 'quote.validity_expired',
    label: 'A proposal validity date has passed',
    description: 'KAMs: revalidate the proposal or record the outcome.',
    email: 'immediate',
  },
  // Lead review (2026-10-30)
  {
    type: 'quote.submitted_to_lead',
    label: 'An engineer or pricer submits their part for your review',
    description:
      'Engineering and pricing leads: the assignee finished their part; review it and move the quote on or send it back.',
    email: 'immediate',
  },
  {
    type: 'quote.returned_by_lead',
    label: 'Your lead sends your part back',
    description: 'Engineers and pricers: your lead asked for changes before moving the quote on.',
    email: 'immediate',
  },
  // B-26
  {
    type: 'quote.pricing_assigned',
    label: 'Quoting work is assigned or reassigned to you',
    description: 'Pricers: the pricing lead assigned you a quote to price.',
    email: 'immediate',
  },
  {
    type: 'quote.escalated',
    label: 'A quote is escalated to you',
    description:
      'Escalation recipients (by type) and the CCQ Process Owner: someone raised a concern on a quote.',
    email: 'immediate',
  },
  {
    type: 'quote.capital_likely',
    label: 'A quote is flagged "capital likely"',
    description:
      'Capital Management: early notice (awareness, not approval) of significant capital.',
    email: 'immediate',
  },
  {
    type: 'quote.market_dev',
    label: 'A qualified quote is above the Market Development threshold',
    description: 'Market Development: a large opportunity has entered engineering.',
    email: 'immediate',
  },
  // FB-07 (D-001, F-032): costing, then ROI, then price confirmation inside Quoting.
  {
    type: 'quote.ready_for_roi',
    label: 'A quote is ready for its ROI',
    description:
      'Finance: Pricing uploaded the costing model (or a new version of it) on a quote that needs an ROI (capital is required, $0 CER included). Build the ROI from it and upload the ROI model.',
    email: 'immediate',
  },
  {
    type: 'quote.roi_uploaded',
    label: 'An ROI model is uploaded',
    description:
      'Pricing leads: Finance uploaded the ROI model (or a new version), so the price can be confirmed.',
    email: 'immediate',
  },
  // FB-05 (F-079): hand-offs, holds and closures reach the next owner and the KAM.
  {
    type: 'quote.ready_for_quoting',
    label: 'A quote is ready for pricing',
    description:
      'Pricing leads, pricers and the assigned pricer: engineering cleared the quote, or it came back to Quoting (from Final Review, the customer, or the KAM with no scope change).',
    email: 'immediate',
  },
  {
    type: 'quote.progress',
    label: 'Your quote moves or a decision is recorded',
    description:
      'KAMs: the quote advanced to the next stage, was sent back to Engineering or Pricing, or a gate recorded a decision that keeps it where it is.',
    email: 'immediate',
  },
  {
    type: 'quote.on_hold',
    label: 'A quote is put on hold',
    description: 'The hold owner and the KAM: who owns the hold and the review date.',
    email: 'immediate',
  },
  {
    type: 'quote.closed',
    label: 'Your quote is closed',
    description:
      'KAMs: stopped, redirected, declined, lost, expired, commitment not authorized, or won.',
    email: 'immediate',
  },
  {
    type: 'quote.lead_review_update',
    label: 'Your quote is in lead review',
    description:
      'KAMs, in-app only: engineering or pricing was submitted to the lead, or the lead sent it back.',
    email: 'none',
  },
  {
    type: 'override.requested',
    label: 'An override is requested',
    description: 'Approvers: a field override needs a decision.',
    email: 'none',
  },
  {
    type: 'override.approved',
    label: 'An override is approved',
    description: 'The requester.',
    email: 'none',
  },
  {
    type: 'override.rejected',
    label: 'An override is rejected',
    description: 'The requester.',
    email: 'none',
  },
  {
    type: 'override.reverted',
    label: 'An override is reverted',
    description: 'The requester.',
    email: 'none',
  },
  {
    type: 'integration.failed',
    label: 'An integration failed',
    description: 'Admins: a scheduled sync did not complete.',
    email: 'none',
  },
  {
    type: 'notification.delivery_failed',
    label: 'Email delivery failed',
    description: 'Admins (owners) only: an email could not be sent after every retry.',
    email: 'none',
  },
];

const BY_TYPE = new Map(NOTIFICATION_EVENTS.map((e) => [e.type, e]));

export const notificationEvent = (type: string): NotificationEventDef | undefined =>
  BY_TYPE.get(type);

/** How a type reaches people by email. Unknown types are in-app only. */
export const emailDeliveryFor = (type: string): EmailDelivery => BY_TYPE.get(type)?.email ?? 'none';

/** The types a user can opt out of email for (everything that has an email at all). */
export const emailPreferenceEvents = (): NotificationEventDef[] =>
  NOTIFICATION_EVENTS.filter((e) => e.email !== 'none');

export const isEmailPreferenceType = (type: string): boolean =>
  (BY_TYPE.get(type)?.email ?? 'none') !== 'none';

/** `user_preference.key` holding whether a user wants email for a type; a missing row means yes. */
export const emailPreferenceKey = (type: string): string => `email.${type}`;

/** The dispatcher's retry schedule: 3 tries, so two waits (1 min, then 5 min). */
export const EMAIL_MAX_ATTEMPTS = 3;
const BACKOFF_MS = [60_000, 300_000] as const;

/** Wait before the next try after `attempts` failed ones, or null when the tries are used up. */
export function emailRetryDelayMs(attempts: number): number | null {
  if (attempts >= EMAIL_MAX_ATTEMPTS) return null;
  return BACKOFF_MS[Math.max(0, attempts - 1)] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!;
}

/**
 * FB-05 (F-034): comment emails wait this many minutes so a burst of comments goes out as one email
 * ("3 new comments on CCQ-…"). `app_setting.comment_email_collapse_minutes`, provisional; 0 = send each
 * one as it is posted. The in-app notification is never delayed.
 */
export const COMMENT_EMAIL_COLLAPSE_MINUTES_SEED = 10;
export const COMMENT_EMAIL_COLLAPSE_MINUTES_MAX = 120;

/** The configured window in minutes; anything that is not a whole number from 0 to 120 falls back to the seed. */
export function parseCommentCollapseMinutes(value: unknown): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= COMMENT_EMAIL_COLLAPSE_MINUTES_MAX
    ? value
    : COMMENT_EMAIL_COLLAPSE_MINUTES_SEED;
}
