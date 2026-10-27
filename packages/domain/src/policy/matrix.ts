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
 * Architecture §3.4 as data. Seeded into `role_permission` (B-03), but route checks read this file, so
 * changing who approves is a one-line change here plus a re-seed (B-19 note: the table becomes the
 * control only after a security decision).
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
    PricingLead: true,
    Approver: true,
    Leadership: true,
    Admin: true,
    PostAward: { kind: 'stages', stageKeys: ['AWARDED'] },
  },
  'quote.read.commercialFields': {
    EngLead: true,
    Pricing: true,
    PricingLead: true,
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
  'pricingQueue.read': { Pricing: true, PricingLead: true, Leadership: true, Admin: true },
  // B-26: the pricing lead assigns Quoting work to a pricer, like `queue.assign` for engineering.
  'pricingQueue.assign': { PricingLead: true, Admin: true },
  'quoting.edit': { Pricing: true, PricingLead: true },
  'gate.G3.submit': { Pricing: true, PricingLead: true },
  // B-12: the Final Review queue (Approvals → Final Review). The Approver works it, Leadership reads
  // it, Admin reads it like the other queues. Everyone on it holds quote.read.commercialFields.
  'finalReview.read': { Approver: true, Leadership: true, Admin: true },
  'gate.G4.decide': { Approver: true },
  'outcome.record': { KAM: own, SalesLeader: true },
  // B-13 (CR-39, D-15): the closure owner defaults to the quote's KAM; a sales leader, who is
  // accountable for closure, may name someone else (themselves, or another KAM).
  'outcome.assignOwner': { SalesLeader: true },
  // B-13: the minimal Awarded hand-off record (Stage 6). KAM on their own quotes, SalesLeader, Admin.
  'handoff.edit': { KAM: own, SalesLeader: true, Admin: true },
  // B-26: G6 Commit & Hand Off (Stage 6). The KAM records it on their own quotes, a sales leader on any
  // (CER approvers and the receiving team are outside CCQ; their decisions are recorded as references).
  'gate.G6.decide': { KAM: own, SalesLeader: true },
  // B-26: the commercial terms (tooling funding model, MOQ, payment terms) and the Legal review record.
  'terms.edit': { KAM: own, SalesLeader: true, Pricing: true, PricingLead: true },
  // B-26: the early "capital likely" flag (slide 9 "Aware"): Sales or upfront Engineering sets it.
  'capitalFlag.edit': {
    KAM: own,
    SalesLeader: true,
    EngLead: true,
    Engineer: assigned,
    Pricing: true,
    PricingLead: true,
  },
  // B-26: the capacity owner's G2 sign-off (owner TBD, D-07; seeded to the EngLead, provisional).
  'capacity.signoff': { EngLead: true },
  // B-26: raise an escalation on a quote (routed by app_setting `escalation_routes`).
  'quote.escalate': {
    KAM: own,
    SalesLeader: true,
    EngLead: true,
    Engineer: assigned,
    Pricing: true,
    PricingLead: true,
    Approver: true,
    Admin: true,
  },
  'override.request': {
    KAM: true,
    SalesLeader: true,
    EngLead: true,
    Pricing: true,
    PricingLead: true,
  },
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
    PricingLead: true,
  },
  // B-16: soft-delete any file. An uploader may remove their own within attachment_settings'
  // uploaderRemoveHours (domain attachmentRemoval); this grant is for everyone else's.
  'attachment.removeAny': { Admin: true },
  'export.csv': {
    KAM: true,
    SalesLeader: true,
    EngLead: true,
    Pricing: true,
    PricingLead: true,
    Approver: true,
    Leadership: true,
    Admin: true,
  },
  'analytics.read': {
    SalesLeader: true,
    EngLead: true,
    Pricing: true,
    PricingLead: true,
    Approver: true,
    Leadership: true,
    Admin: true,
  },
  // B-19: the admin configuration console. Leadership reads every screen; only Admin changes config.
  'config.read': { Leadership: true, Admin: true },
  'config.manage': { Admin: true },
  // B-23: the in-app "Report an issue" button (every MVP role; PostAward is P2) and the
  // Admin → Feedback triage page. Reports can hold screenshots of commercial figures, so triage is
  // Admin only.
  'feedback.submit': {
    KAM: true,
    SalesLeader: true,
    EngLead: true,
    Engineer: true,
    Pricing: true,
    PricingLead: true,
    Approver: true,
    Leadership: true,
    Admin: true,
  },
  'feedback.triage': { Admin: true },
};

/** The roles that hold a permission, ignoring qualifiers. */
export function rolesWithPermission(permission: Permission): Role[] {
  return Object.keys(PERMISSION_MATRIX[permission]) as Role[];
}
