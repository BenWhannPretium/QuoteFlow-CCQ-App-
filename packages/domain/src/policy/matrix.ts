import type { Permission } from '../types/permissions';
import type { Role } from '../types/roles';

/**
 * Narrows a grant to a subset of resources.
 * - own: the resource's kamUserId must be the actor
 * - assigned: the resource's assignedEngineerId must be the actor
 * - fields: the resource's overrideField must be one of the listed fields
 * - stages: the resource's stageKey must be one of the listed stages
 */
export type Qualifier =
  | { kind: 'own' }
  | { kind: 'assigned' }
  | { kind: 'fields'; fields: readonly string[] }
  | { kind: 'stages'; stageKeys: readonly string[] };

export type Grant = true | Qualifier;

const own: Qualifier = { kind: 'own' };
const assigned: Qualifier = { kind: 'assigned' };

/**
 * Architecture §3.4 as data. Seeded into `role_permission` (B-03), so who approves can change without code.
 * The G1 decider (D-06), override approver and G4 approver (D-10) are open decisions: all provisional.
 *
 * Reading notes:
 * - `engReview.edit (assigned)`: the EngLead owns the queue and is unrestricted; the Engineer is limited to assigned quotes.
 * - `override.approve ✔ (priority, queue)` for EngLead: limited to the priority_tier and queue_position fields.
 * - PostAward (P2) reads Awarded quotes only.
 */
export const PERMISSION_MATRIX: Readonly<
  Record<Permission, Readonly<Partial<Record<Role, Grant>>>>
> = {
  'quote.create': { KAM: true, SalesLeader: true, Admin: true },
  'quote.read': {
    KAM: true,
    SalesLeader: true,
    EngLead: true,
    Engineer: true,
    Pricing: true,
    Approver: true,
    Leadership: true,
    Admin: true,
    PostAward: { kind: 'stages', stageKeys: ['AWARDED'] },
  },
  'quote.read.commercialFields': {
    EngLead: true,
    Pricing: true,
    Approver: true,
    Leadership: true,
    Admin: true,
  },
  'gate.G1.decide': { SalesLeader: true },
  // B-10: the engineering queue page. EngLead owns it, an Engineer sees it read-only next to their
  // assignments, Leadership reads it, Admin holds queue.assign.
  'engQueue.read': { EngLead: true, Engineer: true, Leadership: true, Admin: true },
  'queue.assign': { EngLead: true, Admin: true },
  'engReview.edit': { EngLead: true, Engineer: assigned },
  'gate.G2.decide': { EngLead: true },
  // B-11: the pricing queue page. Pricing works it, Leadership reads it, Admin reads it like the
  // engineering queue. Everyone on it holds quote.read.commercialFields.
  'pricingQueue.read': { Pricing: true, Leadership: true, Admin: true },
  'quoting.edit': { Pricing: true },
  'gate.G3.submit': { Pricing: true },
  'gate.G4.decide': { Approver: true },
  'outcome.record': { KAM: own, SalesLeader: true },
  'override.request': { KAM: true, SalesLeader: true, EngLead: true, Pricing: true },
  'override.approve': {
    SalesLeader: true,
    EngLead: { kind: 'fields', fields: ['priority_tier', 'queue_position'] },
    Admin: true,
  },
  'override.revert': { SalesLeader: true, EngLead: true, Admin: true },
  'overrideLog.read': { Leadership: true, Admin: true },
  // B-09: the usage audit viewer and adoption report ("config.manage + Leadership read").
  'audit.read': { Leadership: true, Admin: true },
  'attachment.upload': {
    KAM: true,
    SalesLeader: true,
    EngLead: true,
    Engineer: true,
    Pricing: true,
  },
  'export.csv': {
    KAM: true,
    SalesLeader: true,
    EngLead: true,
    Pricing: true,
    Approver: true,
    Leadership: true,
    Admin: true,
  },
  'analytics.read': {
    SalesLeader: true,
    EngLead: true,
    Pricing: true,
    Approver: true,
    Leadership: true,
    Admin: true,
  },
  'config.manage': { Admin: true },
};

/** The roles that hold a permission, ignoring qualifiers. */
export function rolesWithPermission(permission: Permission): Role[] {
  return Object.keys(PERMISSION_MATRIX[permission]) as Role[];
}
