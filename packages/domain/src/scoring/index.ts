/**
 * Scoring engine interface only. The implementation (weights, tiers, advisory score) lands in B-08.
 * Keeping the contract here lets B-07/B-08 code against it now.
 */
export interface ScoringInput {
  /** Intake attribute values keyed by attribute key (snake_case). */
  attributes: Readonly<Record<string, unknown>>;
}

export interface ScoringResult {
  score: number;
  tier: string;
  modelVersion: number;
  /** Per-attribute contribution, for the "why this score" explanation. */
  breakdown: readonly { key: string; points: number }[];
}

export interface ScoringEngine {
  score(input: ScoringInput): ScoringResult;
}
