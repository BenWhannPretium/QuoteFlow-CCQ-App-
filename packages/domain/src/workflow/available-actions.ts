import { findTransition, violatedSegregationRules, type EvaluateOptions } from './evaluate';
import { releasesProposal } from '../final-review/release';
import { approverTierErrors } from '../final-review/tiers';
import { can } from '../policy/can';
import type { Actor } from '../types/actor';
import type { QuoteState } from '../types/quote';
import type { OutcomeGroup, RequiredRule, WorkflowConfig } from '../types/workflow-config';

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
  /** B-12: the outcome releases the proposition (Final Review → Customer Decision), so it sets the issue and validity dates. */
  releasesProposal: boolean;
  /** B-26: the outcome's definition (help text), so nobody guesses what Hold or Stop does. */
  helpText: string | null;
  /** FB-17 (W13-23): the choice the dialog shows it under; null in a config without groups. */
  outcomeGroup: OutcomeGroup | null;
}

/**
 * The gate/outcome options `actor` may take on `quote` right now: the right gate for the stage, enabled,
 * decider permission held, no segregation conflict, and no second hold on a quote already on hold
 * (UX-004). The UI renders its buttons from this list.
 * Required fields are NOT evaluated here (the form fills them in); `evaluateTransition` is the authority.
 */
export function availableActions(
  config: WorkflowConfig,
  quote: QuoteState,
  actor: Actor,
  options: EvaluateOptions = {},
): AvailableAction[] {
  if (quote.status === 'closed') return [];
  const actions: AvailableAction[] = [];

  for (const gate of config.gates) {
    if (!gate.enabled || gate.stageKey !== quote.stageKey) continue;
    if (!can(actor, gate.deciderPermission, quote)) continue;

    for (const outcome of config.outcomes.filter((o) => o.gateKey === gate.key)) {
      // FB-17 (W13-22): a switched-off outcome is never offered (it still labels old decisions).
      if (!outcome.active) continue;
      const transition = findTransition(config, gate.key, outcome.key);
      if (!transition) continue;
      // UX-004: a quote already on hold is not offered another hold. `evaluateTransition` refuses it
      // (ALREADY_ON_HOLD), and stays the authority when two tabs race. A hold ends when another
      // decision is recorded, so every other outcome is still offered.
      if (quote.status === 'on_hold' && transition.nextStatus === 'on_hold') continue;
      if (violatedSegregationRules(config, quote, actor, gate.key, outcome.key).length > 0)
        continue;
      if (
        approverTierErrors(
          options.approverTiers ?? null,
          quote.fields,
          actor,
          gate.key,
          outcome.key,
        ).length > 0
      )
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
        releasesProposal: releasesProposal(config, gate.key, outcome.key),
        helpText: outcome.helpText,
        outcomeGroup: outcome.outcomeGroup ?? null,
      });
    }
  }
  return actions;
}
