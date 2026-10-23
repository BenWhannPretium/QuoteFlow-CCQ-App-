import { z } from 'zod';

// ── Governed overrides (F-06, B-09) ──────────────────────────────────────────────────────────────

export const OVERRIDE_STATUS_VALUES = [
  'requested',
  'approved',
  'rejected',
  'applied',
  'reverted',
] as const;
export const OverrideStatus = z.enum(OVERRIDE_STATUS_VALUES);
export type OverrideStatus = z.infer<typeof OverrideStatus>;

/** `approver`: waits for a configured approver. `self`: "none (self, logged)", applied by the requester. */
export const OverrideApprovalMode = z.enum(['approver', 'self']);
export type OverrideApprovalMode = z.infer<typeof OverrideApprovalMode>;

/**
 * One override. Values are JSON: a tier key, an address object, or a queue position. `*Display` is a
 * one-line rendering. `canDecide` / `canRevert` are UI hints; the API re-checks every action.
 */
export const OverrideDto = z.object({
  id: z.uuid(),
  quoteId: z.uuid(),
  quoteNumber: z.string(),
  customerName: z.string().nullable(),
  field: z.string(),
  fieldLabel: z.string(),
  originalValue: z.unknown(),
  requestedValue: z.unknown(),
  originalDisplay: z.string(),
  requestedDisplay: z.string(),
  justification: z.string(),
  status: OverrideStatus,
  approvalMode: OverrideApprovalMode,
  requestedBy: z.uuid(),
  requestedByName: z.string().nullable(),
  requestedAt: z.string(),
  decidedBy: z.uuid().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  appliedAt: z.string().nullable(),
  revertedBy: z.uuid().nullable(),
  revertedByName: z.string().nullable(),
  revertedAt: z.string().nullable(),
  canDecide: z.boolean(),
  canRevert: z.boolean(),
});
export type OverrideDto = z.infer<typeof OverrideDto>;

/** A field the quote page offers an override affordance for (from `overridable_fields`). */
export const QuoteOverridableField = z.object({
  field: z.string(),
  label: z.string(),
  approval: OverrideApprovalMode,
  /** The caller may raise an override on this field of this quote now. */
  canRequest: z.boolean(),
  currentValue: z.unknown(),
  /** An open (requested) override on this field, if any: the "pending" badge. */
  pending: OverrideDto.nullable(),
  /** The applied override that set the current value, if any: the copper "Overridden" marker. */
  applied: OverrideDto.nullable(),
});
export type QuoteOverridableField = z.infer<typeof QuoteOverridableField>;

export const OVERRIDE_JUSTIFICATION_MAX = 2000;

/** POST /api/v1/quotes/:quoteNumber/overrides */
export const CreateOverrideBody = z.object({
  field: z.string().min(1).max(60),
  requestedValue: z.unknown(),
  justification: z.string().max(OVERRIDE_JUSTIFICATION_MAX),
});
export type CreateOverrideBody = z.infer<typeof CreateOverrideBody>;

/** POST /api/v1/overrides/:id/approve and /reject: a note is required for both (the domain; B-26). */
export const OverrideDecisionBody = z.object({
  note: z.string().max(OVERRIDE_JUSTIFICATION_MAX).optional(),
});
export type OverrideDecisionBody = z.infer<typeof OverrideDecisionBody>;

export const OverrideIdParams = z.object({ id: z.uuid() });

export const OverrideResponse = z.object({ override: OverrideDto });
export type OverrideResponse = z.infer<typeof OverrideResponse>;

/** GET /api/v1/overrides?status=requested: the approver inbox (only what the caller may decide). */
export const OverrideInboxQuery = z.object({
  status: OverrideStatus.default('requested'),
});
export const OverrideListResponse = z.object({ items: z.array(OverrideDto) });
export type OverrideListResponse = z.infer<typeof OverrideListResponse>;

/** GET /api/v1/admin/override-log (overrideLog.read: Leadership + Admin). */
export const OverrideLogQuery = z.object({
  status: OverrideStatus.optional(),
  field: z.string().max(60).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type OverrideLogQuery = z.infer<typeof OverrideLogQuery>;
export const OverrideLogResponse = z.object({
  items: z.array(OverrideDto),
  nextCursor: z.string().nullable(),
});
export type OverrideLogResponse = z.infer<typeof OverrideLogResponse>;

/** Problem `code`s for override routes. 409 = stale value / pending request / already decided. */
export const OVERRIDE_PROBLEM_CODES = {
  notFound: 'not_found',
  rejected: 'override_rejected',
  notPermitted: 'not_permitted',
  conflict: 'override_conflict',
} as const;
