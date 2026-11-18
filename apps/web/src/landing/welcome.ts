import type { Role } from '@ccq/domain';

/**
 * The first-run card at the top of the Command Center: "Welcome to QuoteFlow", the role's three main
 * jobs and where each is done, and the link to the role's one-page quick-start. It shows until the
 * person dismisses it.
 *
 * The jobs come from the role quick-starts (docs/uat/quickstart) and the navigation each role has. Like
 * the landings, the copy names pages, tabs and buttons, never a stage or gate label: those are
 * configuration. `welcome.test.ts` checks every role has an entry.
 */
export interface WelcomeJob {
  /** What the person does, as the start of a sentence ("Start a quote from your Salesforce opportunity"). */
  job: string;
  /** Where it is done: a menu item, a block on this page, or a tab or button on the quote. */
  where: string;
}

export type WelcomeJobs = readonly [WelcomeJob, WelcomeJob, WelcomeJob];

export const WELCOME_TITLE = 'Welcome to QuoteFlow';
export const WELCOME_INTRO = 'Your main jobs here, and where each one is done.';

export const WELCOME_JOBS: Record<Role, WelcomeJobs> = {
  KAM: [
    { job: 'Start a quote from your Salesforce opportunity', where: 'New intake' },
    {
      job: 'Fix and resubmit a quote that was sent back',
      where: 'Returned to me, on this page',
    },
    { job: 'Record the customer’s answer', where: 'My proposals' },
  ],
  SalesLeader: [
    { job: 'Decide which new intakes go to Engineering', where: 'To qualify' },
    { job: 'Change a quote’s priority tier, with a reason', where: 'Override, on the quote' },
    { job: 'Follow your team’s quotes and missing outcomes', where: 'Pipeline, and this page' },
  ],
  EngLead: [
    { job: 'Assign each quote to an engineer', where: 'Engineering queue' },
    { job: 'Review what your engineers submit', where: 'Ready for my review, in the queue' },
    { job: 'Decide feasibility, or send the quote back', where: 'the quote’s Engineering tab' },
  ],
  Engineer: [
    { job: 'See the reviews assigned to you', where: 'My assignments' },
    {
      job: 'Record the solution and the capacity evidence',
      where: 'the quote’s Engineering tab',
    },
    { job: 'Submit your work to your lead', where: 'the bottom of the Engineering tab' },
  ],
  ProductionScheduler: [
    { job: 'See the quotes whose capacity you own', where: 'Capacity requests' },
    { job: 'Add the capacity evidence rows', where: 'the quote’s Engineering tab' },
    {
      job: 'Approve capacity, or block it with a note',
      where: 'Capacity sign-off, on the same tab',
    },
  ],
  Pricing: [
    { job: 'See the quotes ready to price', where: 'Pricing queue' },
    {
      job: 'Upload the costing model and record the price approval',
      where: 'the quote’s Quoting tab',
    },
    {
      job: 'Submit your work to the pricing lead, who approves the price',
      where: 'the bottom of the Quoting tab',
    },
  ],
  PricingLead: [
    { job: 'Assign each quote to a pricer', where: 'Pricing queue' },
    { job: 'Review what your pricers submit', where: 'Ready for my review, in the queue' },
    { job: 'Approve the price, or send the quote back', where: 'the quote’s Quoting tab' },
  ],
  Finance: [
    {
      job: 'Find out that a quote needs a payback model',
      where: 'your notifications and email',
    },
    { job: 'Download the current costing model', where: 'the quote’s Quoting tab, step 1' },
    { job: 'Upload the payback model', where: 'the quote’s Quoting tab, step 2' },
  ],
  Approver: [
    { job: 'See the quotes waiting for your decision', where: 'Approvals' },
    { job: 'Read the one-page review of a quote', where: 'Review & decide, in the queue' },
    {
      job: 'Release the offer, hold it, send it back or stop it',
      where: 'the bar at the bottom of the review',
    },
  ],
  Leadership: [
    { job: 'See where every open quote stands', where: 'Pipeline' },
    {
      job: 'Read cycle time, win rate and outcome capture',
      where: 'Analytics, the second view of this page',
    },
    { job: 'Check overrides and the audit trail', where: 'Admin' },
  ],
  Admin: [
    { job: 'Change value lists, reason codes, labels, settings and scoring', where: 'Admin' },
    { job: 'Set what each user can see', where: 'Users and scope, in Admin' },
    {
      job: 'Watch the Salesforce sync and triage reported issues',
      where: 'Integrations and Feedback, in Admin',
    },
  ],
  PostAward: [
    { job: 'See the quotes handed over after award', where: 'Pipeline' },
    { job: 'Read what was agreed on a quote', where: 'the quote’s Overview tab' },
    { job: 'Find its drawings and files', where: 'the quote’s Attachments tab' },
  ],
};

/** The role's three jobs; null for a role this build does not know (the card is then left out). */
export const welcomeJobsFor = (role: string): WelcomeJobs | null =>
  (WELCOME_JOBS as Record<string, WelcomeJobs | undefined>)[role] ?? null;

// Whether a person has dismissed the card, per user, in `localStorage`. The preferences API holds email
// switches only (one per notification type, an unknown key is refused), so this cannot live there
// without changing what the server accepts. A convenience only: every read and write is wrapped, so a
// private window or blocked storage means the dismissal lasts for this visit (it is kept in memory).
const key = (userId: string) => `ccq.welcomeDismissed.${userId}`;
const thisVisit = new Set<string>();

export function readWelcomeDismissed(userId: string): boolean {
  try {
    if (window.localStorage.getItem(key(userId)) === '1') return true;
  } catch {
    // Fall through to this visit's answer.
  }
  return thisVisit.has(userId);
}

export function rememberWelcomeDismissed(userId: string): void {
  thisVisit.add(userId);
  try {
    window.localStorage.setItem(key(userId), '1');
  } catch {
    // Storage unavailable: `thisVisit` holds it.
  }
}
