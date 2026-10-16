/**
 * Salesforce stage, side by side with the CCQ stage (B-13, architecture §4.2). CCQ owns the operational
 * stage; the SF stage is read only. `sf_stage_map` (config) gives each SF stage the CCQ stage it usually
 * lines up with. The two only have to agree once either side records an outcome: mid-pipeline SF
 * stages are used loosely ("Qualifying" while engineering works), so flagging those would be noise. The
 * mismatch that matters is "CCQ still waits for the customer, SF says Closed Won" or the reverse.
 */

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
  if (!hint || hint === input.ccqStageKey) {
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
    reason: `CCQ shows ${label(input.ccqStageKey)} but Salesforce shows "${sfStage}" (${label(hint)})`,
  };
}
