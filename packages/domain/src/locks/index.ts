import { DomainError } from '../errors';
import type { GateDecisionRef, QuoteState } from '../types/quote';
import type { WorkflowConfig } from '../types/workflow-config';

/**
 * FB-01 (F-001, Kyle Arnold and Gemma Cebolla, Pricing walkthrough Oct 30): "After a gate is approved,
 * its sections are read-only for all roles except via send-back."
 *
 * A section locks when its gate is decided with an **advancing** outcome: one that moves the quote to a
 * later, non-terminal stage (G2 Advance / Advance with risk / Capital required, G3 Advance to Final
 * Review, G4 Advance). It reopens when a later decision sends the quote back to the section's stage or
 * an earlier one (G3 Rework → Engineering or → KAM, G4 Return, G5 / G6 Re-quote): a send-back unlocks
 * the sections of the target stage and of every later stage. Stage order is the config's.
 *
 * The rule reads only the gate-decision history and the workflow config, so it is the same for every
 * role: nobody, the lead included, edits a locked section. The server refuses the write
 * (`409 SECTION_LOCKED`); the UI shows who decided it and when. The `canEdit*` checks of each section
 * call these functions, so this is the one source of truth.
 */
export const LOCK_SECTIONS = ['engineering', 'pricing', 'commercialTerms', 'capitalFlag'] as const;
export type LockSection = (typeof LOCK_SECTIONS)[number];

/** The gate whose advancing decision locks each section (gate keys of the hybrid seed). */
export const SECTION_LOCK_GATE: Record<LockSection, string> = {
  engineering: 'G2',
  pricing: 'G3',
  commercialTerms: 'G4',
  capitalFlag: 'G4',
};

export interface SectionLock {
  locked: boolean;
  /** The gate whose decision locked the section (null when unlocked). */
  gate: string | null;
  /** That decision's outcome. */
  outcomeKey: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
}

export const UNLOCKED: SectionLock = {
  locked: false,
  gate: null,
  outcomeKey: null,
  decidedBy: null,
  decidedAt: null,
};

export type LockQuote = Pick<QuoteState, 'decisions'>;
export type LockConfig = Pick<WorkflowConfig, 'stages' | 'gates'>;

/** Position of a live (non-terminal) stage in the config's order; null for terminal or unknown stages. */
function stageIndex(config: LockConfig, stageKey: string | null | undefined): number | null {
  if (!stageKey) return null;
  const live = config.stages.filter((s) => !s.terminal);
  const i = live.findIndex((s) => s.key === stageKey);
  return i < 0 ? null : i;
}

/**
 * The lock state of `section` on `quote`. Pure: walks the quote's gate decisions oldest first; an
 * advancing decision at the section's gate locks it, a later decision that targets the section's stage
 * (or an earlier one) unlocks it again.
 */
export function sectionLock(
  section: LockSection,
  config: LockConfig,
  quote: LockQuote,
): SectionLock {
  const gate = config.gates.find((g) => g.key === SECTION_LOCK_GATE[section]);
  if (!gate) return UNLOCKED;
  const sectionStage = stageIndex(config, gate.stageKey);
  if (sectionStage === null) return UNLOCKED;

  const ordered = [...(quote.decisions ?? [])].sort(
    (a, b) =>
      a.decidedAt.getTime() - b.decidedAt.getTime() ||
      (a.recordedAt?.getTime() ?? 0) - (b.recordedAt?.getTime() ?? 0),
  );
  let locking: GateDecisionRef | null = null;
  for (const d of ordered) {
    const target = stageIndex(config, d.targetStageKey);
    if (target === null) continue;
    if (d.gateKey === gate.key && target > sectionStage) locking = d;
    else if (target <= sectionStage) locking = null;
  }
  if (!locking) return UNLOCKED;
  return {
    locked: true,
    gate: locking.gateKey,
    outcomeKey: locking.outcomeKey,
    decidedBy: locking.decidedBy,
    decidedAt: locking.decidedAt,
  };
}

/** Every section's lock, for a detail view. */
export function sectionLocks(
  config: LockConfig,
  quote: LockQuote,
): Record<LockSection, SectionLock> {
  return Object.fromEntries(LOCK_SECTIONS.map((s) => [s, sectionLock(s, config, quote)])) as Record<
    LockSection,
    SectionLock
  >;
}

const SECTION_NAMES: Record<LockSection, string> = {
  engineering: 'The engineering review is',
  pricing: 'The pricing record is',
  commercialTerms: 'The commercial terms are',
  capitalFlag: 'The capital flag is',
};

/**
 * The refusal for a write to a locked section (the API maps `SECTION_LOCKED` to 409). `deciderName` is
 * the display name the service looked up; the message names the gate, the decider and the date.
 */
export function sectionLockedError(
  section: LockSection,
  lock: SectionLock,
  deciderName?: string | null,
): DomainError {
  const by = deciderName ?? 'the decider';
  const on = lock.decidedAt ? ` on ${lock.decidedAt.toISOString().slice(0, 10)}` : '';
  return new DomainError(
    'SECTION_LOCKED',
    `${SECTION_NAMES[section]} locked after ${lock.gate} (decided by ${by}${on}). It reopens only if the quote is sent back.`,
  );
}
