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
export const ATTACHMENT_KINDS = ['bottle_drawing', 'spec', 'sample_photo', 'other'] as const;
export const ACCEPTANCE_EVIDENCE = ['verbal', 'po', 'loi', 'contract'] as const;
export const NOTIFICATION_CHANNELS = ['in_app', 'email'] as const;
export const INTEGRATION_SOURCES = ['salesforce', 'pricing', 'sharepoint'] as const;
export const INTEGRATION_STATUSES = ['running', 'succeeded', 'failed', 'partial'] as const;
/** Why a CCQ-linked opportunity needs attention: it was closed or deleted in Salesforce. */
export const SF_STATUS_FLAGS = ['closed_won', 'closed_lost', 'deleted'] as const;
export { SEGREGATION_DENY } from '@ccq/domain';

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
  'resin',
  'component',
  'process_type',
  'machine_type',
  'plant',
  'request_class',
  'drawing_status',
  'neck_finish',
  'packaging_type',
] as const;

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
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type ValueListKey = (typeof VALUE_LIST_KEYS)[number];
export type ReasonContext = (typeof REASON_CONTEXTS)[number];
