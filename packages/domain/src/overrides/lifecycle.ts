import { DomainError } from '../errors';
import {
  findOverridableField,
  holdsAnyRole,
  type OverridableField,
  type OverrideApprovalMode,
  type OverrideSettings,
} from './config';
import { OVERRIDE_VALUE_KINDS, overrideValuesEqual, type OverrideValueContext } from './values';
import { can, hasPermission, inScope, type ResourceFromQuote } from '../policy/can';
import type { Actor } from '../types/actor';
import type { UserId } from '../types/ids';
import type { QuoteStatus } from '../types/quote';
import type { Role } from '../types/roles';
import type { PlannedNotification } from '../workflow/evaluate';

/**
 * The override lifecycle (F-06):
 *
 *   requested → approved → applied        (approval: approver; approve applies at once)
 *   requested → rejected
 *   applied   → reverted                  (one click: an approver, or the requester of a self-applied one)
 *   (self)    → applied                   (approval: self; requested and applied in one step, logged)
 *
 * `original_value` is captured at request time and never changes; a revert restores it exactly.
 * Concurrency: approving fails (STALE_VALUE → 409) when the field no longer holds `original_value`;
 * reverting fails when it no longer holds `requested_value` (a later change must be undone first).
 *
 * Pure planning: the API service loads the rows, calls these, then persists the plan in one transaction.
 */
export const OVERRIDE_STATUSES = [
  'requested',
  'approved',
  'rejected',
  'applied',
  'reverted',
] as const;
export type OverrideStatus = (typeof OVERRIDE_STATUSES)[number];

/** Open statuses: a field has at most one open request per quote. */
export const isOpenOverride = (status: OverrideStatus) => status === 'requested';

export type OverrideAuditAction =
  | 'override_requested'
  | 'override_approved'
  | 'override_rejected'
  | 'override_applied'
  | 'override_reverted';

export interface OverrideQuote extends ResourceFromQuote {
  status: QuoteStatus;
}

export interface OverrideRecord {
  id: string;
  field: string;
  requestedBy: UserId;
  status: OverrideStatus;
  approvalMode: OverrideApprovalMode;
  originalValue: unknown;
  requestedValue: unknown;
}

export interface OverrideRequestInput {
  field: string;
  requestedValue: unknown;
  justification: string;
}

export type PlanResult<T> = { ok: true; plan: T } | { ok: false; errors: DomainError[] };

export interface OverrideRequestPlan {
  field: string;
  approvalMode: OverrideApprovalMode;
  originalValue: unknown;
  requestedValue: unknown;
  justification: string;
  /** `applied` for a self-applied field: the service writes the value now. */
  status: 'requested' | 'applied';
  apply: boolean;
  audits: OverrideAuditAction[];
  activityType: 'override_requested' | 'override_applied';
  notifications: PlannedNotification[];
}

export interface OverrideDecisionPlan {
  status: 'applied' | 'rejected';
  apply: boolean;
  note: string | null;
  audits: OverrideAuditAction[];
  activityType: 'override_applied' | 'override_rejected';
  notifications: PlannedNotification[];
}

export interface OverrideRevertPlan {
  status: 'reverted';
  /** The exact `original_value` to write back. */
  restoreValue: unknown;
  audits: OverrideAuditAction[];
  activityType: 'override_reverted';
  notifications: PlannedNotification[];
}

const fail = <T>(...errors: DomainError[]): PlanResult<T> => ({ ok: false, errors });

const resource = (quote: OverrideQuote, field: string) => ({ ...quote, overrideField: field });

const notifyRoles = (type: string, roles: readonly Role[]): PlannedNotification[] =>
  roles.map((role) => ({ type, recipient: { kind: 'role', role } }));

const notifyUser = (type: string, userId: UserId): PlannedNotification => ({
  type,
  recipient: { kind: 'user', userId },
});

/** May the actor raise an override on this field of this quote? (role, matrix, scope, own-only). */
export function canRequestOverride(
  config: OverridableField,
  actor: Actor,
  quote: OverrideQuote,
): boolean {
  if (!can(actor, 'override.request', resource(quote, config.field))) return false;
  return actor.roles.some(
    (r) =>
      config.requestRoles.includes(r) &&
      (!config.ownQuoteOnlyRoles.includes(r) || quote.kamUserId === actor.userId),
  );
}

/** May the actor approve or reject requests on this field? (config approver roles + `override.approve`). */
export function canDecideOverride(
  config: OverridableField,
  actor: Actor,
  quote: OverrideQuote,
): boolean {
  return (
    config.approval === 'approver' &&
    holdsAnyRole(actor.roles, config.approverRoles) &&
    can(actor, 'override.approve', resource(quote, config.field))
  );
}

/** May the actor revert an applied override? The requester of a self-applied one always may. */
export function canRevertOverride(
  config: OverridableField | undefined,
  actor: Actor,
  quote: OverrideQuote,
  record: Pick<OverrideRecord, 'approvalMode' | 'requestedBy' | 'field'>,
): boolean {
  if (record.approvalMode === 'self' && record.requestedBy === actor.userId) {
    return inScope(actor, quote);
  }
  return (
    config !== undefined &&
    holdsAnyRole(actor.roles, config.revertRoles) &&
    hasPermission(actor, 'override.revert', resource(quote, record.field)) &&
    inScope(actor, quote)
  );
}

export interface OverrideRequestOptions {
  /** True when the quote already has an open (requested) override on this field. */
  openRequestExists: boolean;
}

export function planOverrideRequest(
  settings: OverrideSettings,
  actor: Actor,
  quote: OverrideQuote,
  input: OverrideRequestInput,
  currentValue: unknown,
  ctx: OverrideValueContext,
  { openRequestExists }: OverrideRequestOptions,
): PlanResult<OverrideRequestPlan> {
  const config = findOverridableField(settings, input.field);
  if (!config) {
    return fail(new DomainError('NOT_OVERRIDABLE', `${input.field} cannot be overridden`, 'field'));
  }
  if (!canRequestOverride(config, actor, quote)) {
    return fail(
      new DomainError(
        'NOT_PERMITTED',
        `You may not request a ${config.label.toLowerCase()} override`,
      ),
    );
  }
  if (quote.status === 'closed') {
    return fail(new DomainError('QUOTE_CLOSED', 'The quote is closed'));
  }
  if (openRequestExists) {
    return fail(
      new DomainError(
        'OVERRIDE_PENDING',
        `A ${config.label.toLowerCase()} override is already waiting for a decision`,
        'field',
      ),
    );
  }

  const errors: DomainError[] = [];
  const justification = input.justification.trim();
  if (justification.length < settings.justificationMinLength) {
    errors.push(
      new DomainError(
        'JUSTIFICATION_REQUIRED',
        `Explain why in at least ${settings.justificationMinLength} characters`,
        'justification',
      ),
    );
  }
  const normalized = OVERRIDE_VALUE_KINDS[config.field]!.normalize(input.requestedValue, ctx);
  if (!normalized.ok) {
    errors.push(new DomainError('INVALID_VALUE', normalized.message, 'requestedValue'));
  } else if (overrideValuesEqual(normalized.value, currentValue)) {
    errors.push(
      new DomainError('NO_CHANGE', 'The requested value is the current value', 'requestedValue'),
    );
  }
  if (errors.length > 0 || !normalized.ok) return { ok: false, errors };

  const self = config.approval === 'self';
  return {
    ok: true,
    plan: {
      field: config.field,
      approvalMode: config.approval,
      originalValue: currentValue ?? null,
      requestedValue: normalized.value,
      justification,
      status: self ? 'applied' : 'requested',
      apply: self,
      audits: self ? ['override_requested', 'override_applied'] : ['override_requested'],
      activityType: self ? 'override_applied' : 'override_requested',
      notifications: self ? [] : notifyRoles('override.requested', config.approverRoles),
    },
  };
}

export function planOverrideDecision(
  settings: OverrideSettings,
  actor: Actor,
  quote: OverrideQuote,
  record: OverrideRecord,
  decision: 'approve' | 'reject',
  currentValue: unknown,
  note?: string | null,
): PlanResult<OverrideDecisionPlan> {
  const config = findOverridableField(settings, record.field);
  if (!config) {
    return fail(new DomainError('NOT_OVERRIDABLE', `${record.field} is no longer overridable`));
  }
  if (record.status !== 'requested') {
    return fail(new DomainError('INVALID_STATE', `The override is already ${record.status}`));
  }
  if (!canDecideOverride(config, actor, quote)) {
    return fail(
      new DomainError(
        'NOT_PERMITTED',
        `You may not decide ${config.label.toLowerCase()} overrides`,
      ),
    );
  }
  if (record.requestedBy === actor.userId) {
    return fail(new DomainError('SEGREGATION', 'You cannot decide your own override request'));
  }
  const trimmed = note?.trim() || null;
  if (decision === 'reject') {
    if (!trimmed) return fail(new DomainError('NOTE_REQUIRED', 'Say why it is rejected', 'note'));
    return {
      ok: true,
      plan: {
        status: 'rejected',
        apply: false,
        note: trimmed,
        audits: ['override_rejected'],
        activityType: 'override_rejected',
        notifications: [notifyUser('override.rejected', record.requestedBy)],
      },
    };
  }
  if (quote.status === 'closed')
    return fail(new DomainError('QUOTE_CLOSED', 'The quote is closed'));
  if (!overrideValuesEqual(currentValue, record.originalValue)) {
    return fail(
      new DomainError(
        'STALE_VALUE',
        `The ${config.label.toLowerCase()} has changed since this was requested; ask for a new override`,
      ),
    );
  }
  return {
    ok: true,
    plan: {
      status: 'applied',
      apply: true,
      note: trimmed,
      audits: ['override_approved', 'override_applied'],
      activityType: 'override_applied',
      notifications: [notifyUser('override.approved', record.requestedBy)],
    },
  };
}

export function planOverrideRevert(
  settings: OverrideSettings,
  actor: Actor,
  quote: OverrideQuote,
  record: OverrideRecord,
  currentValue: unknown,
): PlanResult<OverrideRevertPlan> {
  const config = findOverridableField(settings, record.field);
  if (record.status !== 'applied') {
    return fail(new DomainError('INVALID_STATE', `Only an applied override can be reverted`));
  }
  if (!canRevertOverride(config, actor, quote, record)) {
    return fail(new DomainError('NOT_PERMITTED', 'You may not revert this override'));
  }
  if (!overrideValuesEqual(currentValue, record.requestedValue)) {
    return fail(
      new DomainError(
        'STALE_VALUE',
        'The value has changed since this override was applied; revert the later change first',
      ),
    );
  }
  return {
    ok: true,
    plan: {
      status: 'reverted',
      restoreValue: record.originalValue ?? null,
      audits: ['override_reverted'],
      activityType: 'override_reverted',
      notifications:
        record.requestedBy === actor.userId
          ? []
          : [notifyUser('override.reverted', record.requestedBy)],
    },
  };
}

/** What the caller may do with one override (UI hints; the API re-checks on every action). */
export function overrideActions(
  settings: OverrideSettings,
  actor: Actor,
  quote: OverrideQuote,
  record: OverrideRecord,
): { canDecide: boolean; canRevert: boolean } {
  const config = findOverridableField(settings, record.field);
  return {
    canDecide:
      record.status === 'requested' &&
      config !== undefined &&
      record.requestedBy !== actor.userId &&
      canDecideOverride(config, actor, quote),
    canRevert: record.status === 'applied' && canRevertOverride(config, actor, quote, record),
  };
}
