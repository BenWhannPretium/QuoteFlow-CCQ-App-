import { z } from 'zod';

// ── Admin configuration console (B-19, CR-51; seeds the F-21 decision log) ─────────────────────
//
// Reads: config.read (Leadership + Admin). Writes: config.manage (Admin). Every write names the row
// `version` it was edited from (stale → 409 `stale_version`) and carries a `changeReason`; the change
// is audited (`audit_event action='config_change'`, before/after + reason) and shows in the
// decision log. Shapes the domain owns (required-field rules, scoring attributes, setting values) are
// `unknown` here and validated by the domain parsers on the server.

export const ADMIN_CONFIG_PROBLEM_CODES = {
  /** Someone changed the row since it was loaded: reload and re-apply. */
  stale: 'stale_version',
  /** The new value fails the domain validator (details in `errors[]`). */
  invalid: 'invalid_config',
  /** Deactivating a value that open quotes use needs `confirmInUse: true`. */
  inUse: 'value_in_use',
  /** Turning G1 off while quotes wait at it needs `confirm: true`. */
  confirmRequired: 'confirmation_required',
  duplicate: 'duplicate_code',
  noDraft: 'no_draft',
  draftExists: 'draft_exists',
  notEditable: 'not_editable',
} as const;

const changeReason = z
  .string()
  .trim()
  .min(5, 'Say why (at least 5 characters): it is the decision log entry')
  .max(2000);
const version = z.number().int().min(1);
const code = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_\-.+/]+$/, 'letters, digits and _ - . + / only');
const label = z.string().trim().min(1).max(200);

/** Provisional (seed, awaiting the owner) or approved by `approvedBy` on `approvedAt`. */
export const Approval = z.object({
  provisional: z.boolean(),
  approvedBy: z.uuid().nullable(),
  approvedByName: z.string().nullable(),
  approvedAt: z.string().nullable(),
});
export type Approval = z.infer<typeof Approval>;

const versioned = { id: z.uuid(), version, updatedAt: z.string() };

/** Common write fields. `approved: true` marks the value approved by the caller (Bailey, interim). */
const writeBase = {
  version,
  changeReason,
  approved: z.boolean().optional(),
};

// ── Value lists ────────────────────────────────────────────────────────────────────────────────

export const AdminValueListEntry = z.object({
  ...versioned,
  listKey: z.string(),
  code: z.string(),
  label: z.string(),
  sort: z.number().int(),
  active: z.boolean(),
  meta: z.record(z.string(), z.unknown()),
  approval: Approval,
});
export type AdminValueListEntry = z.infer<typeof AdminValueListEntry>;

export const AdminValueListsResponse = z.object({
  listKeys: z.array(z.string()),
  items: z.array(AdminValueListEntry),
});
export type AdminValueListsResponse = z.infer<typeof AdminValueListsResponse>;

export const CreateValueListEntryBody = z.object({
  listKey: z.string(),
  code,
  label,
  changeReason,
});
export type CreateValueListEntryBody = z.infer<typeof CreateValueListEntryBody>;

export const UpdateValueListEntryBody = z.object({
  ...writeBase,
  label: label.optional(),
  active: z.boolean().optional(),
  /** Deactivating a value open quotes use: they keep it; this confirms you know. */
  confirmInUse: z.boolean().optional(),
});
export type UpdateValueListEntryBody = z.infer<typeof UpdateValueListEntryBody>;

/** New display order for one list or context: every id with the version it was read at. */
export const ReorderBody = z.object({
  items: z
    .array(z.object({ id: z.uuid(), version }))
    .min(1)
    .max(500),
  changeReason,
});
export type ReorderBody = z.infer<typeof ReorderBody>;

// ── Reason codes ───────────────────────────────────────────────────────────────────────────────

export const AdminReasonCode = z.object({
  ...versioned,
  context: z.string(),
  code: z.string(),
  label: z.string(),
  sort: z.number().int(),
  active: z.boolean(),
  requiresNote: z.boolean(),
  approval: Approval,
});
export type AdminReasonCode = z.infer<typeof AdminReasonCode>;

export const AdminReasonCodesResponse = z.object({
  contexts: z.array(z.string()),
  items: z.array(AdminReasonCode),
});
export type AdminReasonCodesResponse = z.infer<typeof AdminReasonCodesResponse>;

export const CreateReasonCodeBody = z.object({
  context: z.string(),
  code,
  label,
  requiresNote: z.boolean().default(false),
  changeReason,
});
export type CreateReasonCodeBody = z.input<typeof CreateReasonCodeBody>;

export const UpdateReasonCodeBody = z.object({
  ...writeBase,
  label: label.optional(),
  active: z.boolean().optional(),
  requiresNote: z.boolean().optional(),
});
export type UpdateReasonCodeBody = z.infer<typeof UpdateReasonCodeBody>;

// ── Workflow labels and rules ──────────────────────────────────────────────────────────────────

const helpText = z.string().trim().max(1000).nullable();

export const AdminStage = z.object({
  ...versioned,
  key: z.string(),
  label: z.string(),
  helpText: z.string().nullable(),
  ownerRole: z.string().nullable(),
  terminal: z.boolean(),
  sort: z.number().int(),
  approval: Approval,
});
export type AdminStage = z.infer<typeof AdminStage>;

export const AdminGate = z.object({
  ...versioned,
  key: z.string(),
  stageKey: z.string(),
  label: z.string(),
  helpText: z.string().nullable(),
  deciderPermission: z.string(),
  enabled: z.boolean(),
  /** Required-field rules (domain DSL) for every outcome of the gate. */
  requiredFields: z.array(z.unknown()),
  sort: z.number().int(),
  approval: Approval,
});
export type AdminGate = z.infer<typeof AdminGate>;

export const AdminOutcome = z.object({
  ...versioned,
  gateKey: z.string(),
  key: z.string(),
  label: z.string(),
  helpText: z.string().nullable(),
  requiresNote: z.boolean(),
  requiresReasonCode: z.boolean(),
  reasonContext: z.string().nullable(),
  requiredFields: z.array(z.unknown()),
  sort: z.number().int(),
  approval: Approval,
});
export type AdminOutcome = z.infer<typeof AdminOutcome>;

export const AdminWorkflowResponse = z.object({
  stages: z.array(AdminStage),
  gates: z.array(AdminGate),
  outcomes: z.array(AdminOutcome),
  /** Field names the rule editor offers (every field the rules use, plus the intake fields). */
  ruleFields: z.array(z.string()),
  /** `app_setting.g1_enabled` with its version (the toggle writes it through the settings route). */
  g1Enabled: z.object({ value: z.boolean(), version, id: z.uuid() }).nullable(),
});
export type AdminWorkflowResponse = z.infer<typeof AdminWorkflowResponse>;

export const UpdateStageBody = z.object({
  ...writeBase,
  label: label.optional(),
  helpText: helpText.optional(),
});
export type UpdateStageBody = z.infer<typeof UpdateStageBody>;

export const UpdateGateBody = z.object({
  ...writeBase,
  label: label.optional(),
  helpText: helpText.optional(),
  requiredFields: z.array(z.unknown()).optional(),
});
export type UpdateGateBody = z.infer<typeof UpdateGateBody>;

export const UpdateOutcomeBody = z.object({
  ...writeBase,
  label: label.optional(),
  helpText: helpText.optional(),
  requiresNote: z.boolean().optional(),
  requiresReasonCode: z.boolean().optional(),
  requiredFields: z.array(z.unknown()).optional(),
});
export type UpdateOutcomeBody = z.infer<typeof UpdateOutcomeBody>;

// ── App settings ───────────────────────────────────────────────────────────────────────────────

export const AdminSetting = z.object({
  ...versioned,
  key: z.string(),
  value: z.unknown(),
  description: z.string(),
  group: z.string(),
  label: z.string(),
  /** Which editor renders it (domain SETTING_EDITORS). */
  editor: z.string(),
  options: z.array(z.string()).optional(),
  nullable: z.boolean(),
  approval: Approval,
});
export type AdminSetting = z.infer<typeof AdminSetting>;

export const AdminSettingsResponse = z.object({
  groups: z.array(z.string()),
  items: z.array(AdminSetting),
});
export type AdminSettingsResponse = z.infer<typeof AdminSettingsResponse>;

export const UpdateSettingBody = z.object({
  ...writeBase,
  /** JSON null = "not set" (only where the setting allows it). Omit to change only the approval. */
  value: z.unknown().optional(),
  /** Turning G1 off while quotes wait at it. */
  confirm: z.boolean().optional(),
});
export type UpdateSettingBody = z.infer<typeof UpdateSettingBody>;

// ── Scoring model ──────────────────────────────────────────────────────────────────────────────

/** The editable part of a model (domain scoring DSL): attributes, tiers and the unknown score. */
export const ScoringModelBody = z.object({
  attributes: z.array(z.unknown()).min(1),
  tiers: z.array(z.unknown()).min(1),
  unknownScore: z.number().min(0).max(100),
});
export type ScoringModelBody = z.infer<typeof ScoringModelBody>;

export const SCORING_VERSION_STATUSES = ['active', 'scheduled', 'superseded', 'draft'] as const;

export const AdminScoringVersion = z.object({
  ...versioned,
  modelVersion: z.number().int(),
  status: z.enum(SCORING_VERSION_STATUSES),
  effectiveFrom: z.string().nullable(),
  changeReason: z.string(),
  createdByName: z.string().nullable(),
  model: ScoringModelBody,
  approval: Approval,
});
export type AdminScoringVersion = z.infer<typeof AdminScoringVersion>;

export const AdminScoringResponse = z.object({
  versions: z.array(AdminScoringVersion),
  /** Resolver names an attribute's `input` may use (anything else is a fact path, e.g. quote.est_annual_volume). */
  inputs: z.array(z.string()),
});
export type AdminScoringResponse = z.infer<typeof AdminScoringResponse>;

export const CreateScoringDraftBody = z.object({ changeReason });
export type CreateScoringDraftBody = z.infer<typeof CreateScoringDraftBody>;

export const UpdateScoringDraftBody = z.object({
  version,
  changeReason,
  model: ScoringModelBody,
});
export type UpdateScoringDraftBody = z.infer<typeof UpdateScoringDraftBody>;

export const ActivateScoringDraftBody = z.object({ version, changeReason });
export type ActivateScoringDraftBody = z.infer<typeof ActivateScoringDraftBody>;

export const DiscardScoringDraftBody = z.object({ version, changeReason });

export const ScoringPreviewBody = z.object({ model: ScoringModelBody });

const previewSide = z.object({ score: z.number(), tier: z.string(), rank: z.number().int() });
export const ScoringPreviewResponse = z.object({
  activeVersion: z.number().int().nullable(),
  rows: z.array(
    z.object({
      quoteNumber: z.string(),
      stageKey: z.string(),
      status: z.string(),
      before: previewSide.nullable(),
      after: previewSide,
      tierChanged: z.boolean(),
      rankDelta: z.number().int(),
    }),
  ),
  summary: z.object({
    quotes: z.number().int(),
    tierChanges: z.number().int(),
    rankChanges: z.number().int(),
    movedUp: z.number().int(),
    movedDown: z.number().int(),
    byTier: z.array(
      z.object({
        tier: z.string(),
        label: z.string(),
        before: z.number().int(),
        after: z.number().int(),
      }),
    ),
  }),
});
export type ScoringPreviewResponse = z.infer<typeof ScoringPreviewResponse>;

export const ActivateScoringResponse = z.object({
  version: AdminScoringVersion,
  /** Open quotes queued for the background rescore. */
  rescoreQueued: z.number().int(),
});
export type ActivateScoringResponse = z.infer<typeof ActivateScoringResponse>;

// ── Users and scope ────────────────────────────────────────────────────────────────────────────

export const SCOPE_TYPE_VALUES = ['all', 'region', 'owner', 'account_list'] as const;

export const AdminUser = z.object({
  id: z.uuid(),
  displayName: z.string(),
  upn: z.string(),
  email: z.string().nullable(),
  region: z.string().nullable(),
  active: z.boolean(),
  lastSeenAt: z.string().nullable(),
  /** From Entra groups at the last sign-in. Read-only here. */
  roles: z.array(z.string()),
  scope: z.object({ type: z.enum(SCOPE_TYPE_VALUES), values: z.array(z.string()) }),
  /** False when the user has no scope row and gets `default_scope_type`. */
  scopeExplicit: z.boolean(),
  /** The scope row's version; null when there is none yet. */
  scopeVersion: version.nullable(),
});
export type AdminUser = z.infer<typeof AdminUser>;

export const AdminUsersResponse = z.object({
  items: z.array(AdminUser),
  /** Where to ask IT for a role change (Entra group membership). */
  roleChangeUrl: z.string(),
});
export type AdminUsersResponse = z.infer<typeof AdminUsersResponse>;

export const UpdateUserScopeBody = z
  .object({
    /** The version shown; null when the user had no scope row. */
    version: version.nullable(),
    changeReason,
    type: z.enum(SCOPE_TYPE_VALUES),
    values: z.array(z.string().trim().min(1).max(100)).max(500).default([]),
  })
  .refine((b) => (b.type === 'region' || b.type === 'account_list') === b.values.length > 0, {
    message: 'region and account_list scopes need values; all and owner take none',
    path: ['values'],
  });
export type UpdateUserScopeBody = z.input<typeof UpdateUserScopeBody>;

// ── Connector health ───────────────────────────────────────────────────────────────────────────

export const ConnectorHealth = z.object({
  source: z.string(),
  /** How the connector is configured (SF_MODE, PRICING_MODE, FILESTORE_MODE, MAIL_MODE). */
  mode: z.string(),
  /** ok: last run succeeded · degraded: partial, or failures in 24 h · down: last run failed · unknown: no runs. */
  health: z.enum(['ok', 'degraded', 'down', 'unknown']),
  lastRunAt: z.string().nullable(),
  lastStatus: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  failures24h: z.number().int(),
  lastError: z.string().nullable(),
});
export type ConnectorHealth = z.infer<typeof ConnectorHealth>;

export const ConnectorHealthResponse = z.object({ items: z.array(ConnectorHealth) });
export type ConnectorHealthResponse = z.infer<typeof ConnectorHealthResponse>;

// ── Decision log (minimal F-21) ────────────────────────────────────────────────────────────────

export const DecisionLogQuery = z.object({
  entity: z.string().max(64).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type DecisionLogQuery = z.infer<typeof DecisionLogQuery>;

export const DecisionLogEntry = z.object({
  id: z.uuid(),
  at: z.string(),
  actorName: z.string().nullable(),
  actorUpn: z.string().nullable(),
  /** The table (value_list, reason_code, app_setting, scoring_model, …). */
  entity: z.string(),
  entityId: z.string().nullable(),
  /** Human name of what changed, e.g. `reason_code lost/price`, `app_setting validity_days_default`. */
  subject: z.string(),
  changeReason: z.string().nullable(),
  changes: z.array(z.object({ path: z.string(), before: z.unknown(), after: z.unknown() })),
});
export type DecisionLogEntry = z.infer<typeof DecisionLogEntry>;

export const DecisionLogResponse = z.object({
  items: z.array(DecisionLogEntry),
  nextCursor: z.string().nullable(),
});
export type DecisionLogResponse = z.infer<typeof DecisionLogResponse>;
