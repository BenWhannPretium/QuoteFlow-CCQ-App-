import type { Permission } from '@ccq/domain';
import { useState } from 'react';

/**
 * The quote page's tabs, in the order they are shown. FB-25 (N18-18): Commercial terms has its own tab
 * beside Engineering and Quoting; the Overview is the read-only summary. FB-30 (N19-28): Capacity has
 * its own tab beside Engineering, so the engineering recommendation and the capacity recommendation are
 * shown apart (one G2 decision still covers both).
 */
export const QUOTE_TABS = [
  'overview',
  'engineering',
  'capacity',
  'quoting',
  'commercial',
  'attachments',
] as const;
export type QuoteTab = (typeof QUOTE_TABS)[number];

export const isQuoteTab = (value: unknown): value is QuoteTab =>
  (QUOTE_TABS as readonly unknown[]).includes(value);

// ── The tab a quote opens on (UX-012) ────────────────────────────────────────────────────────────

/**
 * The permissions that mean "this reader works the engineering stage": editing the solution or the
 * capacity rows, signing capacity off, or deciding the stage's gate. They are read from `/me` (the
 * server's list for the signed-in user), never from a role name.
 */
export const ENGINEERING_WORK_PERMISSIONS = [
  'engReview.edit',
  'capacity.edit',
  'capacity.signoff',
  'gate.G2.decide',
] as const satisfies readonly Permission[];

/**
 * FB-30: the permission that means "this reader works the solution" (the engineer, the engineering lead).
 * A reader who works capacity without it is the production scheduler: their work is on the Capacity tab.
 */
export const SOLUTION_WORK_PERMISSION = 'engReview.edit' satisfies Permission;

/** FB-30: the permission that makes a reader the engineering lead who decides G2. */
export const LEAD_DECIDE_PERMISSION = 'gate.G2.decide' satisfies Permission;

/** FB-30: the permissions that mean "this reader works capacity" (the rows, or the sign-off). */
export const CAPACITY_WORK_PERMISSIONS = [
  'capacity.edit',
  'capacity.signoff',
] as const satisfies readonly Permission[];

/** The same for the quoting stage: the pricing record, the stage's gate, or the payback (ROI) model. */
export const QUOTING_WORK_PERMISSIONS = [
  'quoting.edit',
  'gate.G3.submit',
  'roi.upload',
] as const satisfies readonly Permission[];

/** FB-25: the permission that qualifies a quote at Intake (the sales leader's G1). */
export const QUALIFY_PERMISSION = 'gate.G1.decide' satisfies Permission;

/** FB-25: the permission that edits the commercial terms (KAM own, SalesLeader, Pricing, PricingLead). */
export const TERMS_EDIT_PERMISSION = 'terms.edit' satisfies Permission;

/**
 * UX-012: the tab a quote opens on when the address names none. The tab of the quote's current stage
 * when the reader works that stage, otherwise Overview. This only chooses what is shown first: every
 * tab stays one click away, and the server decides what the reader may do on it.
 *
 * FB-25 (N18-18): Commercial terms for a sales leader while the quote is at Intake (waiting to be
 * qualified), and for a reader with `terms.edit` whose work on the quote is the terms (`termsWork`).
 */
export function defaultQuoteTab(input: {
  /** The quote is in the engineering stage and not closed (the server's `engineering.inQueue`). */
  inEngineering: boolean;
  /** The quote is in the quoting stage and not closed (the server's `quoting.inQuoting`). */
  inQuoting: boolean;
  /** FB-25: the quote is at Intake and not closed. */
  inIntake?: boolean;
  /** FB-25: the terms wait on the reader (`termsWorkWaiting`). */
  termsWork?: boolean;
  /**
   * FB-30: the part of the engineering review that waits for the reader: `capacity` when the server's
   * next step says the capacity part is the reader's move (the production scheduler), or, for a lead, the
   * part that waits on their review (`leadWaitingPart`).
   */
  part?: EngineeringPart | null | undefined;
  /** The reader's permissions, as `/me` returns them. */
  permissions: readonly string[];
}): QuoteTab {
  const holdsOneOf = (wanted: readonly string[]) =>
    wanted.some((permission) => input.permissions.includes(permission));
  if (input.inEngineering && holdsOneOf(ENGINEERING_WORK_PERMISSIONS)) {
    return engineeringTabFor(input.permissions, input.part);
  }
  if (input.inQuoting && holdsOneOf(QUOTING_WORK_PERMISSIONS)) return 'quoting';
  if (input.inIntake && holdsOneOf([QUALIFY_PERMISSION])) return 'commercial';
  if (input.termsWork && holdsOneOf([TERMS_EDIT_PERMISSION])) return 'commercial';
  return 'overview';
}

/** FB-30: the two parts of an engineering review, named by the tab each is worked on. */
export type EngineeringPart = 'engineering' | 'capacity';

/**
 * FB-30 (N19-28): which of the two engineering tabs is the reader's own. The production scheduler (works
 * capacity, not the solution) has Capacity; the engineer has Engineering; a lead, who holds both, has the
 * part waiting for them (`part`), and Engineering when nothing in particular waits.
 */
export function engineeringTabFor(
  permissions: readonly string[],
  part?: EngineeringPart | null,
): 'engineering' | 'capacity' {
  if (part === 'capacity') return 'capacity';
  if (part === 'engineering') return 'engineering';
  const solution = permissions.includes(SOLUTION_WORK_PERMISSION);
  const capacity = CAPACITY_WORK_PERMISSIONS.some((p) => permissions.includes(p));
  return capacity && !solution ? 'capacity' : 'engineering';
}

/**
 * FB-30: the part of an engineering review that waits on the lead: a submitted part first, and the
 * engineer's when both are in (the decision is on the Engineering tab). Null when no part is in.
 */
export function leadWaitingPart(
  parts: { engineer: { in: boolean }; scheduler: { in: boolean } | null } | null | undefined,
): EngineeringPart | null {
  if (!parts) return null;
  if (parts.engineer.in) return 'engineering';
  return parts.scheduler?.in ? 'capacity' : null;
}

/**
 * FB-30 (N19-28): the part of the engineering review waiting for the reader, for the tab a quote opens
 * on. The server's next step names the production scheduler's capacity part; for a lead (who may decide
 * G2) it is the part submitted to them (`leadWaitingPart`). Null for everyone else.
 */
export function engineeringPartFor(input: {
  nextStep?: { yourMove: boolean; part?: string | undefined } | null | undefined;
  parts: Parameters<typeof leadWaitingPart>[0];
  permissions: readonly string[];
}): EngineeringPart | null {
  if (input.nextStep?.yourMove && input.nextStep.part === 'capacity') return 'capacity';
  return input.permissions.includes(LEAD_DECIDE_PERMISSION) ? leadWaitingPart(input.parts) : null;
}

/**
 * FB-25: the terms wait on the reader. A payment-terms exception they may decide, or a quote in Final
 * Review whose terms they may edit and that still lacks something Final Review needs from them (the
 * customer tooling commitment, or the terms check when it is required).
 */
export function termsWorkWaiting(input: {
  stageKey: string;
  closed: boolean;
  canEditTerms: boolean;
  exceptionCanDecide: boolean;
  toolingCommitmentAnswered: boolean;
  termsCheckRequiredAndOpen?: boolean;
}): boolean {
  if (input.closed) return false;
  if (input.exceptionCanDecide) return true;
  return (
    input.stageKey === 'FINAL_REVIEW' &&
    input.canEditTerms &&
    (!input.toolingCommitmentAnswered || input.termsCheckRequiredAndOpen === true)
  );
}

/**
 * FB-25: the tab a link to a place on the page opens. `#commercial` (and its fields, `#terms-…`) is the
 * Commercial terms tab, so links made before the tab existed keep working; `#offer-letter` and the other
 * Overview cards are the Overview. FB-30: `#capacity` is the Capacity tab. A hash no tab claims (e.g.
 * FB-22's `#decision` on the Engineering tab) opens the tab the address names, or the reader's own.
 */
export function tabForHash(hash: string): QuoteTab | null {
  const h = hash.replace(/^#/, '');
  if (h === '') return null;
  if (h === 'commercial' || h.startsWith('terms-') || h === 'capital-terms') return 'commercial';
  if (h === 'capacity') return 'capacity';
  if (h === 'offer-letter' || h === 'handoff' || h === 'closure' || h === 'at-a-glance') {
    return 'overview';
  }
  return null;
}

/**
 * FB-25 (N18-18): the tabs with work waiting on the reader, for the small dot on the tab bar. From the
 * server's next step (UX-002: `yourMove` at a work tab) and the terms.
 *
 * FB-30: in the engineering stage the dot is on Capacity when the reader's move is the capacity part
 * (the next step's `part`), or when their capacity part is open for them to submit (`capacityWork`: after
 * a send-back to them, or a sign-off not yet submitted); otherwise on Engineering (the engineer's part,
 * or the lead's decision).
 */
export function tabsWithWork(input: {
  nextStep?: { yourMove: boolean; place: string | null; part?: string | undefined } | undefined;
  termsWork: boolean;
  /** FB-30: the reader may submit the capacity part now (`leadReview.canSubmitCapacity`). */
  capacityWork?: boolean | undefined;
}): QuoteTab[] {
  const out: QuoteTab[] = [];
  const step = input.nextStep;
  const engineeringMove = step?.yourMove === true && step.place === 'engineering';
  const capacityMove = engineeringMove && step.part === 'capacity';
  if (engineeringMove && !capacityMove) out.push('engineering');
  if (capacityMove || input.capacityWork === true) out.push('capacity');
  if (step?.yourMove && step.place === 'quoting') out.push('quoting');
  if (input.termsWork) out.push('commercial');
  return out;
}

// ── Tabs that stay on the page (UX-001) ──────────────────────────────────────────────────────────

/** The tabs opened so far on one quote. */
export interface OpenedTabs {
  quoteNumber: string;
  tabs: readonly QuoteTab[];
}

/** `opened` with `tab` added. Another quote starts again; nothing new returns the same object. */
export function withOpenedTab(opened: OpenedTabs, quoteNumber: string, tab: QuoteTab): OpenedTabs {
  if (opened.quoteNumber !== quoteNumber) return { quoteNumber, tabs: [tab] };
  return opened.tabs.includes(tab) ? opened : { quoteNumber, tabs: [...opened.tabs, tab] };
}

/**
 * UX-001: the tabs opened so far on this quote, the one on screen included. The Engineering,
 * Capacity and Quoting tabs stay on the page (hidden) once opened, so values typed and not yet saved are still
 * there after a look at another tab. A tab that was never opened is not loaded.
 */
export function useOpenedTabs(quoteNumber: string, tab: QuoteTab): readonly QuoteTab[] {
  const [opened, setOpened] = useState<OpenedTabs>({ quoteNumber, tabs: [tab] });
  const next = withOpenedTab(opened, quoteNumber, tab);
  if (next !== opened) setOpened(next);
  return next.tabs;
}
