import { DomainError } from '../errors';
import type { OutcomeDefinition, ResumeAt, WorkflowConfig } from '../types/workflow-config';

/**
 * FB-01 (F-029 / F-030, Kyle Arnold, Pricing walkthrough Oct 30): where a KAM's fix goes.
 *
 * A gate outcome that sends the quote back to Intake records where it came from (`originStageKey`) and
 * where a resubmission resumes (`resumeAt`, outcome config). G1 / G2 rework resume at `intake`: the
 * resubmission is a new submission (G1 if enabled, then Engineering), as before. G3 "Rework (back to
 * KAM)" resumes at its `origin`: the KAM answers "Did the scope change?" and, if not, the quote goes
 * straight back to Quoting with the same pricer and pricing lead.
 */

/** The stage a KAM's intake lives in, and the one a rework returns to. */
export const INTAKE_STAGE_KEY = 'INTAKE';

/** What a back-to-KAM decision records on the quote (`quote.rework_origin_stage_key`, `rework_resume_at`). */
export interface ReworkReturn {
  originStageKey: string;
  resumeAt: ResumeAt;
}

/** The rework record as stored on the quote (both null when the quote is not back from a rework). */
export interface ReworkRecord {
  originStageKey?: string | null | undefined;
  resumeAt?: ResumeAt | null | undefined;
}

/**
 * The rework record a decision leaves on the quote, or null when the decision does not send it back to
 * the KAM (it does not enter Intake).
 */
export function planReworkReturn(
  outcome: Pick<OutcomeDefinition, 'resumeAt'>,
  fromStageKey: string,
  nextStageKey: string | null,
): ReworkReturn | null {
  if (nextStageKey !== INTAKE_STAGE_KEY) return null;
  // A rework from Intake itself (G1) has no other stage to resume at.
  const resumeAt = fromStageKey === INTAKE_STAGE_KEY ? 'intake' : outcome.resumeAt;
  return { originStageKey: fromStageKey, resumeAt };
}

/** Whether the KAM must answer "Did the scope change?" before resubmitting. */
export function asksScopeChange(rework: ReworkRecord | null | undefined): boolean {
  return (
    rework?.resumeAt === 'origin' &&
    !!rework.originStageKey &&
    rework.originStageKey !== INTAKE_STAGE_KEY
  );
}

export type ResubmitRoute =
  /** Back to the stage the rework came from (no scope change). */
  | { ok: true; route: 'origin'; stageKey: string }
  /** A new submission: G1 (if enabled) or the KAM's own submit gate, as today. */
  | { ok: true; route: 'intake' }
  | { ok: false; errors: DomainError[] };

/**
 * Where a KAM's resubmission goes. `scopeChanged` is required (true / false) when the rework resumes at
 * its origin and ignored otherwise. The origin must still be a live, non-terminal stage of the config,
 * or the resubmission falls back to a new submission rather than guessing.
 */
export function planResubmitRoute(
  config: Pick<WorkflowConfig, 'stages'>,
  rework: ReworkRecord | null | undefined,
  scopeChanged: boolean | null | undefined,
): ResubmitRoute {
  if (!asksScopeChange(rework)) return { ok: true, route: 'intake' };
  if (scopeChanged === undefined || scopeChanged === null) {
    return {
      ok: false,
      errors: [
        new DomainError(
          'SCOPE_CHANGE_REQUIRED',
          'Say whether the scope changed (product, volume, resin, drawing or plant)',
          'scopeChanged',
        ),
      ],
    };
  }
  if (scopeChanged) return { ok: true, route: 'intake' };
  const origin = config.stages.find((s) => s.key === rework!.originStageKey);
  if (!origin || origin.terminal) return { ok: true, route: 'intake' };
  return { ok: true, route: 'origin', stageKey: origin.key };
}
