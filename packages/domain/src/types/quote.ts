import type { QuoteId, UserId } from './ids';

export type QuoteStatus = 'active' | 'on_hold' | 'closed';

/** A period the quote spent on hold. `endedAt: null` means the hold is still open. */
export interface HoldInterval {
  startedAt: Date;
  endedAt: Date | null;
}

/** One row of `stage_history`. `exitedAt: null` means the quote is still in the stage. */
export interface StageHistoryEntry {
  stageKey: string;
  enteredAt: Date;
  exitedAt: Date | null;
}

/** The slice of a quote the engine needs. The service layer builds this from the DB row. */
export interface QuoteState {
  id: QuoteId;
  stageKey: string;
  status: QuoteStatus;
  version: number;
  kamUserId: UserId;
  assignedEngineerId?: UserId | null;
  region?: string;
  accountId?: string;
  /**
   * Field values for required-field checks, keyed by snake_case column name.
   * Related records are nested, e.g. `capacity_evidence` (array) or `pricing_record` (object).
   */
  fields: Readonly<Record<string, unknown>>;
  holds: readonly HoldInterval[];
  /**
   * B-11: users who acted as Pricing on the current version: the recorded price approver and whoever
   * decided G3. Read by the `actor_is_price_approver` segregation rule.
   */
  priceApproverIds?: readonly UserId[];
}
