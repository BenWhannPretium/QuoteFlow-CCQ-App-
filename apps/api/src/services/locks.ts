import {
  SECTION_LOCKED_CODE,
  SECTION_LOCKED_PROBLEM_TYPE,
  type SectionLockView,
} from '@ccq/contracts';
import type { DbOrTx } from '@ccq/db';
import { listUsersByIds, loadWorkflowConfigInput } from '@ccq/db/repos';
import {
  parseWorkflowConfig,
  sectionLock,
  sectionLockedError,
  type LockConfig,
  type WorkflowConfig,
  type LockSection,
  type QuoteState,
  type SectionLock,
} from '@ccq/domain';

import { ServiceProblem } from './problem';

/**
 * FB-01 (F-001): the section locks, as the API shows and enforces them. The rule is the domain's
 * (`packages/domain/src/locks`); this resolves names for the UI and turns a write to a locked section
 * into `409 SECTION_LOCKED` problem+json. Refused writes are not audited: no other refusal is.
 */

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function deciderName(db: DbOrTx, lock: SectionLock): Promise<string | null> {
  if (!lock.decidedBy) return null;
  const [user] = await listUsersByIds(db, [lock.decidedBy]);
  return user?.displayName ?? null;
}

/** `SectionLockView` for a detail DTO. */
export async function lockView(
  db: DbOrTx,
  config: LockConfig,
  lock: SectionLock,
): Promise<SectionLockView> {
  return {
    locked: lock.locked,
    gate: lock.gate,
    gateLabel: lock.gate ? (config.gates.find((g) => g.key === lock.gate)?.label ?? null) : null,
    outcomeKey: lock.outcomeKey,
    decidedById: lock.decidedBy,
    decidedByName: await deciderName(db, lock),
    decidedAt: iso(lock.decidedAt),
  };
}

/** The section's lock, as a view. */
export async function sectionLockView(
  db: DbOrTx,
  config: LockConfig,
  section: LockSection,
  state: Pick<QuoteState, 'decisions'>,
): Promise<SectionLockView> {
  return lockView(db, config, sectionLock(section, config, state));
}

/** The workflow config the locks read (stage order, gates). */
export async function lockConfig(db: DbOrTx): Promise<WorkflowConfig> {
  return parseWorkflowConfig(await loadWorkflowConfigInput(db));
}

/**
 * Refuse a write to a locked section: 409, `type` …/section-locked, `code` SECTION_LOCKED, naming the
 * gate and the decider. Called before any other check of the write, so every role that reaches the
 * service (the route already checked its permission) gets the same answer.
 */
export async function assertSectionUnlocked(
  db: DbOrTx,
  section: LockSection,
  state: Pick<QuoteState, 'decisions'>,
  config?: LockConfig,
): Promise<void> {
  const cfg = config ?? (await lockConfig(db));
  const lock = sectionLock(section, cfg, state);
  if (!lock.locked) return;
  const view = await lockView(db, cfg, lock);
  const error = sectionLockedError(section, lock, view.decidedByName);
  throw new ServiceProblem(409, SECTION_LOCKED_CODE, error.message, {
    type: SECTION_LOCKED_PROBLEM_TYPE,
    title: 'Section locked',
    section,
    lock: view,
  });
}
