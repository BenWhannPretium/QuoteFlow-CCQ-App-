import { RELEASE_GATE_KEY } from './release';
import { approverTierErrors } from './tiers';
import { can } from '../policy/can';
import type { Actor } from '../types/actor';
import type { QuoteState } from '../types/quote';
import type { WorkflowConfig } from '../types/workflow-config';
import { availableActions } from '../workflow/available-actions';
import { violatedSegregationRules, type EvaluateOptions } from '../workflow/evaluate';

export interface FinalReviewAvailability {
  /** The actor may record at least one G4 decision on this quote now. */
  canDecide: boolean;
  /**
   * Why not, when the actor holds the Approver permission and the quote is in Final Review but a rule
   * bars them: segregation (they are the KAM, or the Pricing approver on this quote) or the approver tier.
   * Empty for a read-only viewer (Leadership), who is not barred, just not an approver.
   */
  blockedBy: string[];
}

/**
 * Whether `actor` can decide G4 on `quote`, and if not because of a rule, which one. Same checks as
 * `evaluateTransition` (stage, decider permission, segregation, approver tier), minus the field rules
 * the dialog collects. The queue and the review screen use it to show or hide the decision bar.
 */
export function finalReviewAvailability(
  config: WorkflowConfig,
  quote: QuoteState,
  actor: Actor,
  options: EvaluateOptions = {},
): FinalReviewAvailability {
  const actions = availableActions(config, quote, actor, options).filter(
    (a) => a.gateKey === RELEASE_GATE_KEY,
  );
  if (actions.length > 0) return { canDecide: true, blockedBy: [] };

  const gate = config.gates.find((g) => g.key === RELEASE_GATE_KEY);
  if (
    !gate ||
    !gate.enabled ||
    quote.status === 'closed' ||
    quote.stageKey !== gate.stageKey ||
    !can(actor, gate.deciderPermission, quote)
  ) {
    return { canDecide: false, blockedBy: [] };
  }
  const messages = config.outcomes
    .filter((o) => o.gateKey === gate.key)
    .flatMap((o) => [
      ...violatedSegregationRules(config, quote, actor, gate.key, o.key).map((r) => r.message),
      ...approverTierErrors(
        options.approverTiers ?? null,
        quote.fields,
        actor,
        gate.key,
        o.key,
      ).map((e) => e.message),
    ]);
  return { canDecide: false, blockedBy: [...new Set(messages)] };
}
