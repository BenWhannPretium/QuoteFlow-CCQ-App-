import { z } from 'zod';

/**
 * `GET /api/v1/config/public` (quote.read): the labels and lists the UI renders, read from the
 * config tables so the UI never hard-codes a stage name, gate label, reason code or value list.
 * Values marked `provisional` are seeds still waiting on an owner decision.
 */
export const PublicStage = z.object({
  key: z.string(),
  label: z.string(),
  /** B-19: admin-editable help text; null = none. */
  helpText: z.string().nullable(),
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
  /** B-19: admin-editable help text; null = none. */
  helpText: z.string().nullable(),
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
  /** B-19: admin-editable help text; null = none. */
  helpText: z.string().nullable(),
  requiresNote: z.boolean(),
  requiresReasonCode: z.boolean(),
  reasonContext: z.string().nullable(),
  /**
   * FB-17 (W13-22): false = switched off. It is still listed, so a decision recorded with it keeps its
   * label on the timeline and in every list; it is no longer offered as a choice.
   */
  active: z.boolean(),
  /** FB-17 (W13-23): the choice the decision dialog shows it under; null = none set. */
  outcomeGroup: z.string().nullable(),
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
  /** FB-09: labels of inactive entries (list → code → label), so a quote that still holds a retired code can show it. */
  retiredValues: z.record(z.string(), z.record(z.string(), z.string())).optional(),
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
  // FB-02 intake overhaul (provisional)
  'intake_allowed_request_classes',
  'intake_redirect_message',
  'intake_variants_note_max_length',
  // FB-09 (F-019, D-016 default): the free-text cap for new edits (provisional)
  'intake_free_text_max_length',
  'intake_min_spec_fields',
  // FB-15 (W13-03, W13-10): the "Other" description limit and the master-data notice (provisional)
  'intake_other_description_max_length',
  'customer_master_data_notice',
  // FB-11 intake commercial inputs (provisional)
  'standard_payment_terms',
  // FB-31 (N19-07): who approves which non-standard terms, for the intake and Commercial tab line.
  'terms_exception_routes',
  // FB-08 (F-021): the payment terms pre-selected on the quote.
  'default_payment_terms',
  // FB-10 (F-066): the platform-minimum warning (seeded off, provisional)
  'intake_guardrails',
  'salesforce_new_opportunity_url',
  // B-09 overrides (the per-field config reaches the quote page as QuoteDetail.overridableFields)
  'override_justification_min_length',
  // FB-16 (W13-12 to W13-14, provisional): the merged process & machine pick, the two-step plant
  // pickers and the pack-out rule, so the Engineering tab filters and checks as the server does.
  'machine_type_process_map',
  'two_step_plant_machine_types',
  'pack_out_rule',
  // FB-23 (N18-04 to N18-07, N18-14; provisional): the cost lines, their pre-fill figures and the default
  // tooling markup, so the Engineering tab shows the lines for the process and totals as the server does.
  'engineering_cost_lines',
  'engineering_cost_defaults',
  'tooling_markup_default_pct',
  // FB-17 (W13-22, W13-25; provisional): when capital is needed (the Engineering tab says when the
  // equipment BOM is required) and who the hold-owner picker starts on.
  'capital_needed_above_usd',
  'hold_owner_default',
  // FB-19 (W13-32, provisional): the most items one quote may hold (the wizard checks it as the server does).
  'quote_items_max',
  // FB-19 (W13-33, provisional): whether the opportunity picker offers a separate quote beside an open one.
  'opportunity_active_quotes',
  // FB-24 (N17-03, N17-01, N17-06/07; provisional): the concept classes exempt from the minimum spec,
  // the ship-to sources, and the file types each place offers.
  'intake_min_spec_exempt_classes',
  'ship_to_sources',
  'attachment_kinds_by_place',
  // FB-32 (N19-04; provisional, off): whether the intake offers "Salesforce says X, Use this" hints.
  'intake_sf_suggestions_enabled',
] as const;
