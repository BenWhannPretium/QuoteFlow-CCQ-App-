import { findTransition, violatedSegregationRules } from './evaluate';
import { can } from '../policy/can';
import type { Actor } from '../types/actor';
import type { QuoteState } from '../types/quote';
import type { RequiredRule, WorkflowConfig } from '../types/workflow-config';

export interface AvailableAction {
  gateKey: string;
  gateLabel: string;
  outcomeKey: string;
  outcomeLabel: string;
  requiresNote: boolean;
  requiresReasonCode: boolean;
  /** Active reason codes the UI may offer for this outcome. */
  reasonCodes: { code: string; label: string }[];
  /** More than one entry means the decider must pick (`targetStageKey`). */
  targetStageKeys: string[];
  /** Rules the decision will be checked against, so the form can mark fields required up front. */
  requiredFields: RequiredRule[];
  nextStatus: 'active' | 'on_hold' | 'closed';
}

/**
 * The gate/outcome options `actor` may take on `quote` right now: the right gate for the stage, enabled,
 * decider permission held, no segregation conflict. The UI renders its buttons from this list.
 * Required fields are NOT evaluated here (the form fills them in); `evaluateTransition` is the authority.
 */
export function availableActions(
  config: WorkflowConfig,
  quote: QuoteState,
  actor: Actor,
): AvailableAction[] {
  if (quote.status === 'closed') return [];
  const actions: AvailableAction[] = [];

  for (const gate of config.gates) {
    if (!gate.enabled || gate.stageKey !== quote.stageKey) continue;
    if (!can(actor, gate.deciderPermission, quote)) continue;

    for (const outcome of config.outcomes.filter((o) => o.gateKey === gate.key)) {
      const transition = findTransition(config, gate.key, outcome.key);
      if (!transition) continue;
      if (violatedSegregationRules(config, quote, actor, gate.key, outcome.key).length > 0)
        continue;

      actions.push({
        gateKey: gate.key,
        gateLabel: gate.label,
        outcomeKey: outcome.key,
        outcomeLabel: outcome.label,
        requiresNote: outcome.requiresNote,
        requiresReasonCode: outcome.requiresReasonCode,
        reasonCodes: config.reasonCodes
          .filter((r) => r.active && r.context === outcome.reasonContext)
          .map((r) => ({ code: r.code, label: r.label })),
        targetStageKeys: transition.targetStageKeys,
        requiredFields: [...gate.requiredFields, ...outcome.requiredFields],
        nextStatus: transition.nextStatus,
      });
    }
  }
  return actions;
}
