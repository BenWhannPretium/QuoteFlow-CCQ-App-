import { DomainError } from '../errors';
import { AWARDED_STAGE_KEY, COMMIT_STAGE_KEY } from './report';

/**
 * Salesforce stage, side by side with the CCQ stage (B-13, architecture §4.2). CCQ owns the operational
 * stage; the SF stage is read only. `sf_stage_map` (config) gives each SF stage the CCQ stage it usually
 * lines up with. The two only have to agree once either side records an outcome: mid-pipeline SF
 * stages are used loosely ("Qualifying" while engineering works), so flagging those would be noise. The
 * mismatch that matters is "CCQ still waits for the customer, SF says Closed Won" or the reverse.
 * B-26: Commit & Hand Off and Closed – Won are both "the customer awarded it", so SF's award stages
 * (verbal award, PO in hand, closed won) agree with either.
 */
const AWARD_SIDE = new Set([COMMIT_STAGE_KEY, AWARDED_STAGE_KEY]);

export interface SfStageMapEntry {
  sfStage: string;
  ccqStageHint: string | null;
}

export interface SfStageComparison {
  sfStage: string | null;
  /** The CCQ stage `sf_stage_map` lines the SF stage up with; null when the SF stage is unmapped. */
  ccqStageHint: string | null;
  mismatch: boolean;
  /** Why it is flagged, in words; null when there is no mismatch. */
  reason: string | null;
}

export function compareSfStage(input: {
  ccqStageKey: string;
  sfStage: string | null | undefined;
  map: readonly SfStageMapEntry[];
  /** Terminal (outcome) stage keys from the workflow config. */
  terminalStageKeys: readonly string[];
  /** Display labels for the reason text. */
  stageLabel?: (key: string) => string;
}): SfStageComparison {
  const sfStage = input.sfStage?.trim() || null;
  if (!sfStage) return { sfStage: null, ccqStageHint: null, mismatch: false, reason: null };
  const hint = input.map.find((m) => m.sfStage === sfStage)?.ccqStageHint ?? null;
  if (
    !hint ||
    hint === input.ccqStageKey ||
    (AWARD_SIDE.has(hint) && AWARD_SIDE.has(input.ccqStageKey))
  ) {
    return { sfStage, ccqStageHint: hint, mismatch: false, reason: null };
  }
  const terminal = new Set(input.terminalStageKeys);
  const outcomeSide = terminal.has(hint) || terminal.has(input.ccqStageKey);
  if (!outcomeSide) return { sfStage, ccqStageHint: hint, mismatch: false, reason: null };
  const label = input.stageLabel ?? ((k: string) => k);
  return {
    sfStage,
    ccqStageHint: hint,
    mismatch: true,
    // DR-kam-sales-leader-15: the CCQ stage in brackets only when it says something new
    // ('Salesforce shows "Quoting" (Quoting)' read as a stutter).
    reason:
      label(hint).toLowerCase() === sfStage.toLowerCase()
        ? `CCQ shows ${label(input.ccqStageKey)} but Salesforce shows "${sfStage}"`
        : `CCQ shows ${label(input.ccqStageKey)} but Salesforce shows "${sfStage}" (${label(hint)})`,
  };
}

// ── FB-04 (F-076): the Salesforce link and the "update the opportunity" reminder ──────────────────

/**
 * Provisional seed for `sf_outcome_stage_names`: the Salesforce stage a G5 outcome should leave the
 * opportunity in (names from `sf_stage_map`). Awarded waits in Commit & Hand Off, so it is the verbal
 * award stage; Expired and Lost are both Closed Lost. Confirm with the KAMs before pilot.
 */
export const SF_OUTCOME_STAGE_NAMES_SEED: Readonly<Record<string, string>> = {
  awarded: 'Verbal Award',
  negotiating: 'Negotiating',
  lost: 'Closed Lost',
  expired: 'Closed Lost',
  requote: 'Quoting',
};

/** Validates `sf_outcome_stage_names`: outcome key → Salesforce stage name. Throws INVALID_CONFIG. */
export function parseSfOutcomeStageNames(value: unknown): Record<string, string> {
  const bad = (m: string) => new DomainError('INVALID_CONFIG', `sf_outcome_stage_names: ${m}`);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw bad('expected an object of outcome key → Salesforce stage name');
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string' || v.trim() === '') throw bad(`"${k}" needs a stage name`);
    out[k] = v.trim();
  }
  return out;
}

/** The Salesforce stage to name in the reminder after `outcomeKey` is recorded; null when none is configured. */
export function sfStageForOutcome(
  outcomeKey: string,
  names: Readonly<Record<string, string>>,
): string | null {
  return names[outcomeKey] ?? null;
}

/**
 * Validates `salesforce_instance_url`: empty (not set) or an https origin. A trailing slash and any
 * path are dropped, so the link is always `${origin}/lightning/r/Opportunity/<id>/view`.
 */
export function parseSalesforceInstanceUrl(value: unknown): string {
  const bad = (m: string) => new DomainError('INVALID_CONFIG', `salesforce_instance_url: ${m}`);
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') throw bad('expected text');
  const trimmed = value.trim();
  if (trimmed === '') return '';
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw bad('not a valid URL');
  }
  if (url.protocol !== 'https:') throw bad('must start with https://');
  return url.origin;
}

/** The Lightning record link for an opportunity, or null when the instance URL is not set. */
export function salesforceOpportunityUrl(
  instanceUrl: string | null | undefined,
  sfOpportunityId: string | null | undefined,
): string | null {
  if (!instanceUrl || !sfOpportunityId) return null;
  return `${instanceUrl.replace(/\/+$/, '')}/lightning/r/Opportunity/${encodeURIComponent(sfOpportunityId)}/view`;
}
