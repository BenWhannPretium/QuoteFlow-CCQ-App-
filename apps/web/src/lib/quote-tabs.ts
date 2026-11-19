import type { Permission } from '@ccq/domain';
import { useState } from 'react';

/**
 * The quote page's tabs, in the order they are shown. FB-25 (N18-18): Commercial terms has its own tab
 * beside Engineering and Quoting; the Overview is the read-only summary.
 */
export const QUOTE_TABS = [
  'overview',
  'engineering',
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
  /** The reader's permissions, as `/me` returns them. */
  permissions: readonly string[];
}): QuoteTab {
  const holdsOneOf = (wanted: readonly string[]) =>
    wanted.some((permission) => input.permissions.includes(permission));
  if (input.inEngineering && holdsOneOf(ENGINEERING_WORK_PERMISSIONS)) return 'engineering';
  if (input.inQuoting && holdsOneOf(QUOTING_WORK_PERMISSIONS)) return 'quoting';
  if (input.inIntake && holdsOneOf([QUALIFY_PERMISSION])) return 'commercial';
  if (input.termsWork && holdsOneOf([TERMS_EDIT_PERMISSION])) return 'commercial';
  return 'overview';
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
 * Overview cards are the Overview. A hash no tab claims (e.g. FB-22's `#decision` on the Engineering tab)
 * opens the reader's own tab, as a link without one does.
 */
export function tabForHash(hash: string): QuoteTab | null {
  const h = hash.replace(/^#/, '');
  if (h === '') return null;
  if (h === 'commercial' || h.startsWith('terms-') || h === 'capital-terms') return 'commercial';
  if (h === 'offer-letter' || h === 'handoff' || h === 'closure' || h === 'at-a-glance') {
    return 'overview';
  }
  return null;
}

/**
 * FB-25 (N18-18): the tabs with work waiting on the reader, for the small dot on the tab bar. From the
 * server's next step (UX-002: `yourMove` at a work tab) and the terms.
 */
export function tabsWithWork(input: {
  nextStep?: { yourMove: boolean; place: string | null } | undefined;
  termsWork: boolean;
}): QuoteTab[] {
  const out: QuoteTab[] = [];
  const step = input.nextStep;
  if (step?.yourMove && step.place === 'engineering') out.push('engineering');
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
 * UX-001: the tabs opened so far on this quote, the one on screen included. The Engineering and
 * Quoting tabs stay on the page (hidden) once opened, so values typed and not yet saved are still
 * there after a look at another tab. A tab that was never opened is not loaded.
 */
export function useOpenedTabs(quoteNumber: string, tab: QuoteTab): readonly QuoteTab[] {
  const [opened, setOpened] = useState<OpenedTabs>({ quoteNumber, tabs: [tab] });
  const next = withOpenedTab(opened, quoteNumber, tab);
  if (next !== opened) setOpened(next);
  return next.tabs;
}
