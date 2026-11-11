import { RELEASE_GATE_KEY } from './release';
import type { Actor } from '../types/actor';
import type { QuoteState } from '../types/quote';
import type { SegregationRule, WorkflowConfig } from '../types/workflow-config';
import { violatedSegregationRules } from '../workflow/evaluate';

/**
 * DR-approver-leadership-admin-01 (Sev-2): confirming the capital terms is the approver's second check on
 * the KAM's pre-fill, and it gates the release (G4). So whoever may not release the offer on this quote
 * (the segregation rules on G4 Advance, e.g. the quote's KAM or its price approver) may not edit or
 * confirm its capital terms either. The rules stay config (`segregation_rule`): a rule added to or removed
 * from G4 applies here too, with no code change.
 */
export function capitalTermsSegregation(
  config: WorkflowConfig,
  quote: QuoteState,
  actor: Actor,
): SegregationRule[] {
  return violatedSegregationRules(config, quote, actor, RELEASE_GATE_KEY, 'approve');
}

/** The refusal shown to the person barred from the capital terms (the rule's own wording, adapted). */
export function capitalTermsSegregationMessage(rules: readonly SegregationRule[]): string | null {
  if (rules.length === 0) return null;
  return `Another approver edits and confirms the capital terms: ${rules
    .map((r) => r.message.charAt(0).toLowerCase() + r.message.slice(1))
    .join('; ')}.`;
}
