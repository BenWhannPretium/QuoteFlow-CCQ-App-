import type { Actor, Scope } from './types/actor';
import { asQuoteId, asUserId } from './types/ids';
import type { QuoteState } from './types/quote';
import type { Role } from './types/roles';
import type { RequiredRule, WorkflowConfig } from './types/workflow-config';
import type { TransitionRequest } from './workflow/evaluate';

export const NOW = new Date('2026-10-20T15:00:00Z');
export const KAM_ID = asUserId('user-kam');
export const OTHER_ID = asUserId('user-other');

export function makeActor(roles: Role | Role[], overrides: Partial<Actor> = {}): Actor {
  return {
    userId: OTHER_ID,
    roles: Array.isArray(roles) ? roles : [roles],
    scope: { type: 'all' } satisfies Scope,
    ...overrides,
  };
}

export function makeQuote(stageKey: string, overrides: Partial<QuoteState> = {}): QuoteState {
  return {
    id: asQuoteId('quote-1'),
    stageKey,
    status: 'active',
    version: 1,
    kamUserId: KAM_ID,
    assignedEngineerId: null,
    fields: {},
    holds: [],
    ...overrides,
  };
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let node = target;
  for (const part of parts.slice(0, -1)) {
    node[part] ??= {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1] as string] = value;
}

/** Builds field values that satisfy every rule (anyOf: the first alternative). */
export function satisfy(
  rules: readonly RequiredRule[],
  into: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const rule of rules) {
    if ('allOf' in rule) satisfy(rule.allOf, into);
    else if ('anyOf' in rule) satisfy([rule.anyOf[0] as RequiredRule], into);
    else if (rule.op === 'present') setPath(into, rule.field, 'x');
    else if (rule.op === 'minItems')
      setPath(
        into,
        rule.field,
        Array.from({ length: rule.value }, () => ({})),
      );
    else if (rule.op === 'oneOf') setPath(into, rule.field, rule.value[0]);
    else setPath(into, rule.field, rule.value);
  }
  return into;
}

/** A request, plus quote fields, that satisfy every constraint of one gate/outcome. */
export function validCase(config: WorkflowConfig, gateKey: string, outcomeKey: string) {
  const gate = config.gates.find((g) => g.key === gateKey)!;
  const outcome = config.outcomes.find((o) => o.gateKey === gateKey && o.key === outcomeKey)!;
  const transition = config.transitions.find(
    (t) => t.gateKey === gateKey && t.outcomeKey === outcomeKey,
  )!;
  const reason = config.reasonCodes.find((r) => r.context === outcome.reasonContext && r.active);
  const request: TransitionRequest = {
    gateKey,
    outcomeKey,
    ...(outcome.requiresNote ? { note: 'because' } : {}),
    ...(outcome.requiresReasonCode && reason ? { reasonCode: reason.code } : {}),
    ...(transition.targetStageKeys.length > 1
      ? { targetStageKey: transition.targetStageKeys[0] as string }
      : {}),
  };
  const fields = satisfy([...gate.requiredFields, ...outcome.requiredFields]);
  return { gate, outcome, transition, request, fields };
}
