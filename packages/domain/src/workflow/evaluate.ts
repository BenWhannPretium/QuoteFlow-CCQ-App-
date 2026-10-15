import { DomainError } from '../errors';
import { evaluateRules, fieldsReferenced, getPath } from './rules';
import type { FieldValues } from './rules';
import { can } from '../policy/can';
import type { Actor } from '../types/actor';
import type { UserId, QuoteId } from '../types/ids';
import type { QuoteState, QuoteStatus } from '../types/quote';
import type { Role } from '../types/roles';
import type {
  GateDefinition,
  OutcomeDefinition,
  RequiredRule,
  SegregationRule,
  TransitionRule,
  WorkflowConfig,
} from '../types/workflow-config';

export interface TransitionRequest {
  gateKey: string;
  outcomeKey: string;
  note?: string;
  reasonCode?: string;
  /** Required when the transition offers more than one target stage (return / re-quote). */
  targetStageKey?: string;
  /** Values supplied with the decision itself (e.g. `review_date`). They overlay the quote's fields for rule checks. */
  payload?: Readonly<Record<string, unknown>>;
}

export type NotificationRecipient = { kind: 'role'; role: Role } | { kind: 'user'; userId: UserId };

export interface PlannedNotification {
  type: string;
  recipient: NotificationRecipient;
}

export interface PlannedActivityEvent {
  type:
    | 'gate_decided'
    | 'stage_changed'
    | 'hold_started'
    | 'hold_ended'
    | 'version_bumped'
    | 'quote_closed';
  actorId: UserId;
  at: Date;
  payload: Readonly<Record<string, unknown>>;
}

export interface GateDecisionRecord {
  quoteId: QuoteId;
  gateKey: string;
  outcomeKey: string;
  decidedBy: UserId;
  decidedAt: Date;
  note: string | null;
  reasonCode: string | null;
  targetStageKey: string | null;
  /** Quote version the decision was taken against (never rewritten when the version bumps). */
  quoteVersion: number;
  /** Snapshot of the fields the rules looked at. */
  evidence: { stageKey: string; fields: Readonly<Record<string, unknown>> };
  payload: Readonly<Record<string, unknown>> | null;
}

export interface TransitionEffects {
  fromStageKey: string;
  nextStageKey: string;
  nextStatus: QuoteStatus;
  closeAs?: string;
  versionBump: boolean;
  nextVersion: number;
  /** Both null when the transition has no target stage (e.g. Hold). Otherwise the service closes one `stage_history` row and opens the next. */
  stageHistory: {
    exit: { stageKey: string; exitedAt: Date } | null;
    enter: { stageKey: string; enteredAt: Date } | null;
  };
  /** `start` opens a hold interval, `end` closes the open one, `none` leaves holds untouched. */
  hold: { action: 'start' | 'end' | 'none'; at: Date };
  gateDecisionRecord: GateDecisionRecord;
  activityEvents: PlannedActivityEvent[];
  notifications: PlannedNotification[];
}

export type EvaluationResult =
  { ok: true; effects: TransitionEffects } | { ok: false; errors: DomainError[] };

/** Segregation rules that bar this actor from this gate/outcome on this quote. */
export function violatedSegregationRules(
  config: WorkflowConfig,
  quote: QuoteState,
  actor: Actor,
  gateKey: string,
  outcomeKey: string,
): SegregationRule[] {
  return config.segregation.filter((rule) => {
    if (!rule.gateKeys.includes(gateKey)) return false;
    if (rule.outcomeKeys && !rule.outcomeKeys.includes(outcomeKey)) return false;
    if (rule.deny === 'actor_is_kam') return quote.kamUserId === actor.userId;
    return quote.assignedEngineerId === actor.userId;
  });
}

export function findTransition(
  config: WorkflowConfig,
  gateKey: string,
  outcomeKey: string,
): TransitionRule | undefined {
  return config.transitions.find((t) => t.gateKey === gateKey && t.outcomeKey === outcomeKey);
}

function holdAction(from: QuoteStatus, to: QuoteStatus): 'start' | 'end' | 'none' {
  if (from !== 'on_hold' && to === 'on_hold') return 'start';
  if (from === 'on_hold' && to !== 'on_hold') return 'end';
  return 'none';
}

function resolveNotifications(
  config: WorkflowConfig,
  outcome: OutcomeDefinition,
  quote: QuoteState,
  nextStageKey: string,
): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  for (const { type, to } of outcome.notify) {
    if ('role' in to) {
      out.push({ type, recipient: { kind: 'role', role: to.role } });
    } else if ('relation' in to) {
      const userId = to.relation === 'kam' ? quote.kamUserId : quote.assignedEngineerId;
      if (userId) out.push({ type, recipient: { kind: 'user', userId } });
    } else {
      const owner = config.stages.find((s) => s.key === nextStageKey)?.ownerRole;
      if (owner === 'KAM') out.push({ type, recipient: { kind: 'user', userId: quote.kamUserId } });
      else if (owner) out.push({ type, recipient: { kind: 'role', role: owner } });
    }
  }
  return out;
}

function validateConstraints(
  config: WorkflowConfig,
  outcome: OutcomeDefinition,
  transition: TransitionRule,
  request: TransitionRequest,
  rules: readonly RequiredRule[],
  values: FieldValues,
): DomainError[] {
  const errors: DomainError[] = evaluateRules(rules, values);

  if (outcome.requiresNote && !request.note?.trim()) {
    errors.push(
      new DomainError('NOTE_REQUIRED', `A note is required for "${outcome.label}"`, 'note'),
    );
  }

  const reasonCode = request.reasonCode?.trim();
  if (!reasonCode) {
    if (outcome.requiresReasonCode) {
      errors.push(
        new DomainError(
          'REASON_REQUIRED',
          `A reason code is required for "${outcome.label}"`,
          'reasonCode',
        ),
      );
    }
  } else {
    const match = config.reasonCodes.find(
      (r) => r.code === reasonCode && r.active && r.context === outcome.reasonContext,
    );
    if (match?.requiresNote && !outcome.requiresNote && !request.note?.trim()) {
      errors.push(
        new DomainError('NOTE_REQUIRED', `A note is required for reason "${match.label}"`, 'note'),
      );
    }
    if (!match) {
      const context = outcome.reasonContext ?? 'none';
      errors.push(
        new DomainError(
          'INVALID_REASON',
          `"${reasonCode}" is not a valid reason code for context "${context}"`,
          'reasonCode',
        ),
      );
    }
  }

  const targets = transition.targetStageKeys;
  const chosen = request.targetStageKey;
  if (targets.length > 1) {
    if (!chosen)
      errors.push(
        new DomainError(
          'TARGET_REQUIRED',
          `Choose a target stage: ${targets.join(' or ')}`,
          'targetStageKey',
        ),
      );
    else if (!targets.includes(chosen))
      errors.push(
        new DomainError(
          'INVALID_TARGET',
          `${chosen} is not an allowed target (${targets.join(', ')})`,
          'targetStageKey',
        ),
      );
  } else if (chosen && chosen !== targets[0]) {
    errors.push(
      new DomainError(
        'INVALID_TARGET',
        `"${outcome.label}" does not take a target stage choice`,
        'targetStageKey',
      ),
    );
  }

  return errors;
}

/**
 * Decides whether `actor` may take `request` on `quote` at time `now`, and what must be persisted if so.
 * Returns every failure, not just the first. Checks, in order:
 *   1 stage  2 decider permission  3 segregation  4 required fields  5 note / reason code / target.
 * Pure: the caller persists `effects` atomically and supplies the clock.
 */
export function evaluateTransition(
  config: WorkflowConfig,
  quote: QuoteState,
  actor: Actor,
  request: TransitionRequest,
  now: Date,
): EvaluationResult {
  const gate: GateDefinition | undefined = config.gates.find((g) => g.key === request.gateKey);
  if (!gate)
    return {
      ok: false,
      errors: [new DomainError('UNKNOWN_GATE', `Unknown gate: ${request.gateKey}`, 'gateKey')],
    };

  const outcome = config.outcomes.find(
    (o) => o.gateKey === gate.key && o.key === request.outcomeKey,
  );
  const transition = findTransition(config, gate.key, request.outcomeKey);
  if (!outcome || !transition) {
    return {
      ok: false,
      errors: [
        new DomainError(
          'UNKNOWN_OUTCOME',
          `Gate ${gate.key} has no outcome ${request.outcomeKey}`,
          'outcomeKey',
        ),
      ],
    };
  }

  const errors: DomainError[] = [];

  // 1. Stage (and quote state)
  if (quote.status === 'closed')
    errors.push(new DomainError('QUOTE_CLOSED', 'The quote is closed'));
  if (quote.stageKey !== gate.stageKey) {
    errors.push(
      new DomainError(
        'WRONG_STAGE',
        `Gate ${gate.key} applies to stage ${gate.stageKey}, but the quote is in ${quote.stageKey}`,
      ),
    );
  }
  if (!gate.enabled) errors.push(new DomainError('GATE_DISABLED', `Gate ${gate.key} is disabled`));

  // 2. Decider permission (role + data scope)
  if (!can(actor, gate.deciderPermission, quote)) {
    errors.push(
      new DomainError('NOT_PERMITTED', `Requires ${gate.deciderPermission} on this quote`),
    );
  }

  // 3. Segregation of duties
  for (const rule of violatedSegregationRules(config, quote, actor, gate.key, outcome.key)) {
    errors.push(new DomainError('SEGREGATION', rule.message));
  }

  // 4 + 5. Required fields, note, reason code, target
  const values: FieldValues = { ...quote.fields, ...request.payload };
  const rules = [...gate.requiredFields, ...outcome.requiredFields];
  errors.push(...validateConstraints(config, outcome, transition, request, rules, values));

  if (errors.length > 0) return { ok: false, errors };

  // ── Effects ──
  const nextStageKey =
    transition.targetStageKeys.length > 0
      ? (request.targetStageKey ?? transition.targetStageKeys[0] ?? quote.stageKey)
      : quote.stageKey;
  const entersStage = transition.targetStageKeys.length > 0;
  const nextVersion = quote.version + (transition.versionBump ? 1 : 0);
  const hold = { action: holdAction(quote.status, transition.nextStatus), at: now };

  const evidenceFields: Record<string, unknown> = {};
  for (const name of rules.flatMap(fieldsReferenced)) {
    const value = getPath(values, name);
    if (value !== undefined) evidenceFields[name] = value;
  }

  const note = request.note?.trim() || null;
  const reasonCode = request.reasonCode?.trim() || null;

  const gateDecisionRecord: GateDecisionRecord = {
    quoteId: quote.id,
    gateKey: gate.key,
    outcomeKey: outcome.key,
    decidedBy: actor.userId,
    decidedAt: now,
    note,
    reasonCode,
    targetStageKey: entersStage ? nextStageKey : null,
    quoteVersion: quote.version,
    evidence: { stageKey: quote.stageKey, fields: evidenceFields },
    payload: request.payload ?? null,
  };

  const event = (
    type: PlannedActivityEvent['type'],
    payload: Record<string, unknown>,
  ): PlannedActivityEvent => ({
    type,
    actorId: actor.userId,
    at: now,
    payload,
  });
  const activityEvents: PlannedActivityEvent[] = [
    event('gate_decided', { gateKey: gate.key, outcomeKey: outcome.key, note, reasonCode }),
  ];
  if (entersStage)
    activityEvents.push(event('stage_changed', { from: quote.stageKey, to: nextStageKey }));
  if (hold.action === 'start')
    activityEvents.push(event('hold_started', { stageKey: nextStageKey, reasonCode }));
  if (hold.action === 'end') activityEvents.push(event('hold_ended', { stageKey: quote.stageKey }));
  if (transition.versionBump)
    activityEvents.push(event('version_bumped', { from: quote.version, to: nextVersion }));
  if (transition.nextStatus === 'closed') {
    activityEvents.push(event('quote_closed', { closeAs: transition.closeAs ?? null, reasonCode }));
  }

  const effects: TransitionEffects = {
    fromStageKey: quote.stageKey,
    nextStageKey,
    nextStatus: transition.nextStatus,
    versionBump: transition.versionBump,
    nextVersion,
    stageHistory: entersStage
      ? {
          exit: { stageKey: quote.stageKey, exitedAt: now },
          enter: { stageKey: nextStageKey, enteredAt: now },
        }
      : { exit: null, enter: null },
    hold,
    gateDecisionRecord,
    activityEvents,
    notifications: resolveNotifications(config, outcome, quote, nextStageKey),
    ...(transition.closeAs ? { closeAs: transition.closeAs } : {}),
  };
  return { ok: true, effects };
}
