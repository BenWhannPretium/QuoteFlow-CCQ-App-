import { z } from 'zod';

/**
 * `GET /api/v1/config/public` (quote.read): the labels and lists the UI renders, read from the
 * config tables so the UI never hard-codes a stage name, gate label, reason code or value list.
 * Values marked `provisional` are seeds still waiting on an owner decision.
 */
export const PublicStage = z.object({
  key: z.string(),
  label: z.string(),
  ownerRole: z.string().nullable(),
  terminal: z.boolean(),
  sort: z.number().int(),
  provisional: z.boolean(),
});
export type PublicStage = z.infer<typeof PublicStage>;

export const PublicGate = z.object({
  key: z.string(),
  stageKey: z.string(),
  label: z.string(),
  deciderPermission: z.string(),
  enabled: z.boolean(),
  sort: z.number().int(),
  provisional: z.boolean(),
});
export type PublicGate = z.infer<typeof PublicGate>;

export const PublicGateOutcome = z.object({
  gateKey: z.string(),
  key: z.string(),
  label: z.string(),
  requiresNote: z.boolean(),
  requiresReasonCode: z.boolean(),
  reasonContext: z.string().nullable(),
  sort: z.number().int(),
  provisional: z.boolean(),
});
export type PublicGateOutcome = z.infer<typeof PublicGateOutcome>;

export const PublicReasonCode = z.object({
  context: z.string(),
  code: z.string(),
  label: z.string(),
  requiresNote: z.boolean(),
  sort: z.number().int(),
});
export type PublicReasonCode = z.infer<typeof PublicReasonCode>;

export const PublicValueListEntry = z.object({
  code: z.string(),
  label: z.string(),
  sort: z.number().int(),
  meta: z.record(z.string(), z.unknown()),
});
export type PublicValueListEntry = z.infer<typeof PublicValueListEntry>;

/** `tier` is the tier key stored on quotes (e.g. `HIGH`); `label` is what to show. */
export const PublicTier = z.object({ tier: z.string(), label: z.string(), min: z.number() });
export type PublicTier = z.infer<typeof PublicTier>;

export const PublicConfigResponse = z.object({
  stages: z.array(PublicStage),
  gates: z.array(PublicGate),
  outcomes: z.array(PublicGateOutcome),
  /** Active codes only. */
  reasonCodes: z.array(PublicReasonCode),
  /** Active entries only, keyed by list key (resin, market, plant, …). */
  valueLists: z.record(z.string(), z.array(PublicValueListEntry)),
  /** UI-relevant app settings (see PUBLIC_SETTING_KEYS). JSON null means "not decided yet". */
  settings: z.record(z.string(), z.unknown()),
  /** Priority tiers of the scoring model in effect, highest first. */
  tiers: z.array(PublicTier),
});
export type PublicConfigResponse = z.infer<typeof PublicConfigResponse>;

/** The app settings the UI may read. Everything else in app_setting stays server-side. */
export const PUBLIC_SETTING_KEYS = [
  'validity_days_default',
  'g1_enabled',
  'min_opportunity_value_warning_usd',
  'min_volume_warning_by_process',
  'sla_hours_by_stage',
  'kam_can_see_peer_scores',
  'qualification_exception_note_outcomes',
  // B-07 intake (all provisional; Danielle Leu and Jim Zweifel finalise the field set at M4)
  'intake_required_fields',
  'intake_volume_placeholder',
  'intake_default_request_class',
  'intake_description_template',
  'intake_field_help',
  'salesforce_new_opportunity_url',
] as const;
