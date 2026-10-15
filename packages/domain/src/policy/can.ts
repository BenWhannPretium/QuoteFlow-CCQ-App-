import { ForbiddenError } from '../errors';
import { PERMISSION_MATRIX } from './matrix';
import type { Grant } from './matrix';
import type { Actor } from '../types/actor';
import type { UserId } from '../types/ids';
import type { Permission } from '../types/permissions';
import type { QuoteState } from '../types/quote';

/** What a permission check needs to know about the thing being touched. A `QuoteState` fits. */
export interface PolicyResource {
  kamUserId?: UserId;
  assignedEngineerId?: UserId | null;
  region?: string;
  accountId?: string;
  stageKey?: string;
  /** For override permissions: the field the override targets. */
  overrideField?: string;
}

export type ResourceFromQuote = Pick<
  QuoteState,
  'kamUserId' | 'assignedEngineerId' | 'region' | 'accountId' | 'stageKey'
>;

function grantApplies(grant: Grant, actor: Actor, resource: PolicyResource | undefined): boolean {
  if (grant === true) return true;
  // A qualified grant is about specific resources: without one, there is nothing to qualify against.
  if (!resource) return false;
  switch (grant.kind) {
    case 'own':
      return resource.kamUserId === actor.userId;
    case 'assigned':
      return resource.assignedEngineerId === actor.userId;
    case 'fields':
      return resource.overrideField !== undefined && grant.fields.includes(resource.overrideField);
    case 'stages':
      return resource.stageKey !== undefined && grant.stageKeys.includes(resource.stageKey);
  }
}

/** Data scope: all | owner (KAM of the quote) | region | account_list. */
export function inScope(actor: Actor, resource: PolicyResource): boolean {
  const scope = actor.scope;
  switch (scope.type) {
    case 'all':
      return true;
    case 'owner':
      return resource.kamUserId !== undefined && resource.kamUserId === actor.userId;
    case 'region':
      return resource.region !== undefined && scope.values.includes(resource.region);
    case 'account_list':
      return resource.accountId !== undefined && scope.values.includes(resource.accountId);
  }
}

/** True if any of the actor's roles grants the permission (union of roles), ignoring data scope. */
export function hasPermission(
  actor: Actor,
  permission: Permission,
  resource?: PolicyResource,
): boolean {
  const grants = PERMISSION_MATRIX[permission];
  return actor.roles.some((role) => {
    const grant = grants[role];
    return grant !== undefined && grantApplies(grant, actor, resource);
  });
}

/**
 * Role permission AND data scope. With no `resource`, only the role is checked (scope can't be evaluated),
 * and qualified grants (own/assigned/…) don't apply. Routes should always pass the resource.
 */
export function can(actor: Actor, permission: Permission, resource?: PolicyResource): boolean {
  if (!hasPermission(actor, permission, resource)) return false;
  return resource === undefined || inScope(actor, resource);
}

export function assertCan(actor: Actor, permission: Permission, resource?: PolicyResource): void {
  if (!can(actor, permission, resource)) throw new ForbiddenError(permission);
}

export function canSeeOverrideLog(actor: Actor): boolean {
  return hasPermission(actor, 'overrideLog.read');
}

export function canSeeCommercialFields(actor: Actor): boolean {
  return hasPermission(actor, 'quote.read.commercialFields');
}
