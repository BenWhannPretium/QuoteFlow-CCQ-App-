/**
 * Closed value sets enforced by CHECK constraints. Anything the business may still change
 * (stage keys, reason codes, value-list codes) is config data instead, never a CHECK.
 */
export { OVERRIDE_APPROVAL_MODES, OVERRIDE_STATUSES, PERMISSIONS, ROLES } from '@ccq/domain';

export const QUOTE_STATUSES = ['active', 'on_hold', 'closed'] as const;
export const CUSTOMER_STATUSES = ['existing', 'not_yet_established'] as const;
export const SCOPE_TYPES = ['all', 'region', 'owner', 'account_list'] as const;
export const CAPITAL_READINESS = [
  'not_required',
  'pending',
  'pre_approved',
  'not_approved',
] as const;
export { ATTACHMENT_KINDS, VERSIONED_ATTACHMENT_KINDS } from '@ccq/domain';
/** FB-07 (F-032): whether costing needs the costing model (grandfathered: in Quoting before FB-07). */
export { COST_MODEL_REQUIREMENTS } from '@ccq/domain';
/** B-16: where an attachment's bytes are (FILESTORE_MODE). */
export const ATTACHMENT_STORAGES = ['sharepoint', 'blob', 'local'] as const;
export const ACCEPTANCE_EVIDENCE = ['verbal', 'po', 'loi', 'contract'] as const;
/** B-26: the CER status on the hand-off (G6a) and the capacity owner's G2 sign-off. */
export { CAPACITY_SIGNOFF_STATUSES, CER_STATUSES } from '@ccq/domain';
export const NOTIFICATION_CHANNELS = ['in_app', 'email'] as const;
/** B-27: `fabric` is the hourly Fabric mirroring status check. */
export const INTEGRATION_SOURCES = ['salesforce', 'pricing', 'sharepoint', 'fabric'] as const;
export const INTEGRATION_STATUSES = ['running', 'succeeded', 'failed', 'partial'] as const;
/** B-15 (revised): the legacy pricing-app export's record kinds and derived statuses. */
export const PRICING_HISTORY_KINDS = ['erf', 'bpr', 'spr'] as const;
export const PRICING_HISTORY_STATUSES = [
  'open',
  'on_hold',
  'accepted',
  'rejected',
  'abandoned',
  'completed',
] as const;
/** Why a CCQ-linked opportunity needs attention: it was closed or deleted in Salesforce. */
export const SF_STATUS_FLAGS = ['closed_won', 'closed_lost', 'deleted'] as const;
export { CLOSURE_OWNER_DEFAULTS, SEGREGATION_DENY } from '@ccq/domain';

export const AUDIT_ACTIONS = [
  'view',
  'create',
  'update',
  'stage_change',
  'gate_decision',
  'override_requested',
  'override_approved',
  'override_rejected',
  'override_applied',
  'override_reverted',
  'upload',
  'download',
  'export',
  'config_change',
  'sign_in',
] as const;

export const VALUE_LIST_KEYS = [
  'product_family',
  'market',
  // FB-12 (F-020, F-073): the sub-market under a market (Melanie Rasche, 2026-11-09); scores strategic fit.
  'sub_market',
  'resin',
  'component',
  'process_type',
  'machine_type',
  'plant',
  'request_class',
  'drawing_status',
  'neck_finish',
  'packaging_type',
  // B-26: the Stage 3 tooling funding model (deck slide 12).
  'tooling_funding_model',
  // FB-02 (F-010): the neck as three lists (Jim Zweifel, A-001); `neck_finish` above is retired.
  'neck_diameter',
  'neck_finish_type',
  'neck_special_feature',
  // FB-02 (F-055, F-023): PCR level and color.
  'pcr_level',
  'color_type',
  // FB-02 (F-013): component follow-ups.
  'labels_purchased_by',
  'decoration_type',
  // FB-11 (F-080): the intake commercial inputs.
  'requested_payment_terms',
  'price_basis',
  'freight_type',
] as const;

/** FB-01 (F-030): where a KAM's resubmission resumes after a rework (`gate_outcome_definition.resume_at`). */
export const RESUME_AT = ['origin', 'intake'] as const;

export const REASON_CONTEXTS = [
  'rework',
  'redirect',
  'stop',
  'decline',
  'lost',
  'expired',
  'hold',
  'requote',
  'override',
  // B-13: G5 Awarded's acceptance evidence.
  'awarded',
  // B-26: G6 Stop, commitment not authorized.
  'not_authorized',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type ValueListKey = (typeof VALUE_LIST_KEYS)[number];
export type ReasonContext = (typeof REASON_CONTEXTS)[number];
