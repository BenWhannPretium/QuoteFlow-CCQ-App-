import { DomainError } from '../errors';
import { workflowConfigSchema } from '../types/workflow-config';
import type { WorkflowConfig } from '../types/workflow-config';

function duplicates(values: string[]): string[] {
  return values.filter((v, i) => values.indexOf(v) !== i);
}

/** Referential and consistency checks the schema can't express. Empty array = valid. */
export function validateWorkflowConfig(config: WorkflowConfig): DomainError[] {
  const errors: DomainError[] = [];
  const bad = (message: string): number => errors.push(new DomainError('INVALID_CONFIG', message));

  const stages = new Map(config.stages.map((s) => [s.key, s]));
  const gates = new Map(config.gates.map((g) => [g.key, g]));

  for (const key of duplicates(config.stages.map((s) => s.key))) bad(`Duplicate stage key: ${key}`);
  for (const key of duplicates(config.gates.map((g) => g.key))) bad(`Duplicate gate key: ${key}`);

  for (const gate of config.gates) {
    const stage = stages.get(gate.stageKey);
    if (!stage) bad(`Gate ${gate.key} is on unknown stage ${gate.stageKey}`);
    else if (stage.terminal) bad(`Gate ${gate.key} is on terminal stage ${gate.stageKey}`);
  }

  const outcomeIds = config.outcomes.map((o) => `${o.gateKey}/${o.key}`);
  for (const id of duplicates(outcomeIds)) bad(`Duplicate outcome: ${id}`);
  const transitionIds = config.transitions.map((t) => `${t.gateKey}/${t.outcomeKey}`);
  for (const id of duplicates(transitionIds)) bad(`Duplicate transition: ${id}`);

  for (const outcome of config.outcomes) {
    const id = `${outcome.gateKey}/${outcome.key}`;
    if (!gates.has(outcome.gateKey)) bad(`Outcome ${id} is on unknown gate ${outcome.gateKey}`);
    if (!transitionIds.includes(id)) bad(`Outcome ${id} has no transition rule`);
    if (outcome.requiresReasonCode) {
      if (!outcome.reasonContext)
        bad(`Outcome ${id} requires a reason code but has no reasonContext`);
      else if (!config.reasonCodes.some((r) => r.context === outcome.reasonContext && r.active)) {
        bad(
          `Outcome ${id} requires a reason code but context "${outcome.reasonContext}" has no active codes`,
        );
      }
    }
  }

  for (const rule of config.transitions) {
    const id = `${rule.gateKey}/${rule.outcomeKey}`;
    if (!outcomeIds.includes(id)) bad(`Transition ${id} has no matching outcome`);
    const targets = rule.targetStageKeys.map((key) => stages.get(key));
    rule.targetStageKeys.forEach((key, i) => {
      if (!targets[i]) bad(`Transition ${id} targets unknown stage ${key}`);
    });
    const known = targets.filter((s) => s !== undefined);
    const terminalCount = known.filter((s) => s.terminal).length;
    if (rule.nextStatus === 'closed') {
      if (known.length === 0 || terminalCount !== known.length)
        bad(`Transition ${id} closes the quote, so every target must be a terminal stage`);
      if (!rule.closeAs) bad(`Transition ${id} closes the quote but has no closeAs`);
    } else {
      if (terminalCount > 0)
        bad(`Transition ${id} targets a terminal stage but nextStatus is ${rule.nextStatus}`);
      if (rule.closeAs) bad(`Transition ${id} sets closeAs but does not close the quote`);
    }
  }

  for (const rule of config.segregation) {
    for (const gateKey of rule.gateKeys) {
      if (!gates.has(gateKey)) bad(`Segregation rule ${rule.id} refers to unknown gate ${gateKey}`);
      for (const outcomeKey of rule.outcomeKeys ?? []) {
        if (!outcomeIds.includes(`${gateKey}/${outcomeKey}`)) {
          bad(`Segregation rule ${rule.id} refers to unknown outcome ${gateKey}/${outcomeKey}`);
        }
      }
    }
  }

  return errors;
}

/** Parses untrusted config (seed file, DB rows), applies defaults and validates it. Throws INVALID_CONFIG. */
export function parseWorkflowConfig(input: unknown): WorkflowConfig {
  const parsed = workflowConfigSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new DomainError('INVALID_CONFIG', `Workflow config failed schema validation: ${detail}`);
  }
  const problems = validateWorkflowConfig(parsed.data);
  if (problems.length > 0) {
    throw new DomainError(
      'INVALID_CONFIG',
      `Workflow config is inconsistent: ${problems.map((p) => p.message).join('; ')}`,
    );
  }
  return parsed.data;
}
