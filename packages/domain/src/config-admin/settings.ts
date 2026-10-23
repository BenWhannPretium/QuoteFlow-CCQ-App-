import { z } from 'zod';

import { parseAttachmentSettings } from '../attachments/rules';
import {
  parseCapitalNotice,
  parseEscalationRoutes,
  parseLegalReviewTriggers,
  parseMarketDevNotice,
  parsePassThrough,
  parseProcessOwner,
} from '../commercial';
import { engQueueSettingsSchema } from '../engineering/queue';
import { DomainError } from '../errors';
import { parseValidityDays } from '../final-review/release';
import { parseApproverTierRules } from '../final-review/tiers';
import { intakeConfigSchema } from '../intake/intake';
import { parseReceivingRoles } from '../outcome/handoff';
import { parseValidityWarningDays } from '../outcome/validity';
import { overridableFieldSchema, parseOverrideSettings } from '../overrides/config';
import { CAPITAL_READINESS_VALUES, parsePricingRefFormats } from '../pricing/record';
import { requiredRuleSchema } from '../types/workflow-config';

/**
 * The admin console's app settings (B-19, CR-51). Each `app_setting` key the console knows has a
 * spec: which screen group it sits in, which editor renders it, and the parser that validates a new
 * value before it is saved. The parsers are the same ones the features use when they read the
 * setting, so a value the console accepts is a value the feature can run on.
 *
 * A key with no spec still shows (as JSON) and saves any well-formed JSON: that only happens for a
 * setting added after B-19 without a spec here, and adding one is the fix.
 */

export const SETTING_GROUPS = [
  'workflow',
  'proposal',
  'qualification',
  'intake',
  'engineering',
  // B-26
  'pricing',
  'final_review',
  'escalation',
  'overrides',
  'scoring',
  'notifications',
  'integrations',
  'other',
] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

/**
 * How the console renders a value. Structured editors for the CR-51 items; `json` for the rest.
 * - integer / number: a number input; `nullableNumber` adds "not set" (JSON null = off).
 * - numberMap: code → number rows (e.g. minimum volume by process type).
 * - agingDays: the two engineering-queue bucket edges.
 * - userIds: a user picker (app_user ids).
 * - rules: the guided required-field rule editor (domain DSL).
 * - overridableFields: per field, who requests / approves / reverts.
 * - select: one of `options`.
 */
export const SETTING_EDITORS = [
  'integer',
  'number',
  'nullableNumber',
  'boolean',
  'text',
  'select',
  'numberMap',
  'agingDays',
  'userIds',
  'rules',
  'overridableFields',
  'json',
] as const;
export type SettingEditor = (typeof SETTING_EDITORS)[number];

export interface SettingSpec {
  key: string;
  group: SettingGroup;
  label: string;
  editor: SettingEditor;
  /** `select` choices. */
  options?: readonly string[];
  /** Whether JSON null ("not set") is a valid value. */
  nullable?: boolean;
  /** Validates and normalises a proposed value. Throws INVALID_CONFIG. */
  parse(value: unknown): unknown;
}

function zodParser<T extends z.ZodType>(key: string, schema: T) {
  return (value: unknown): z.infer<T> => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(value)'}: ${i.message}`)
        .join('; ');
      throw new DomainError('INVALID_CONFIG', `${key}: ${detail}`);
    }
    return parsed.data;
  };
}

/** A parser that rejects null for settings whose feature parser treats null as "use the seed". */
function notNull(key: string, parse: (v: unknown) => unknown) {
  return (value: unknown) => {
    if (value === null || value === undefined) {
      throw new DomainError('INVALID_CONFIG', `${key} needs a value`);
    }
    return parse(value);
  };
}

const nonNegative = z.number().finite().nonnegative();
const gateOutcomePair = z.string().regex(/^[A-Z0-9_]+:[a-z0-9_]+$/, 'use GATE:outcome');

const spec = (
  key: string,
  group: SettingGroup,
  label: string,
  editor: SettingEditor,
  parse: (value: unknown) => unknown,
  extra: Partial<Pick<SettingSpec, 'options' | 'nullable'>> = {},
): SettingSpec => ({ key, group, label, editor, parse, ...extra });

const z_ = zodParser;

export const SETTING_SPECS: readonly SettingSpec[] = [
  // Workflow
  spec(
    'g1_enabled',
    'workflow',
    'Use the G1 qualify gate',
    'boolean',
    z_('g1_enabled', z.boolean()),
  ),
  spec(
    'sla_hours_by_stage',
    'workflow',
    'SLA hours by stage (D-20; not set = aging buckets only)',
    'numberMap',
    z_('sla_hours_by_stage', z.record(z.string().min(1), z.number().positive()).nullable()),
    { nullable: true },
  ),
  // Proposal validity (D-12)
  spec(
    'validity_days_default',
    'proposal',
    'Default proposal validity (days)',
    'integer',
    notNull('validity_days_default', parseValidityDays),
  ),
  spec(
    'validity_warning_days',
    'proposal',
    'Validity countdown turns amber at (days left)',
    'integer',
    notNull('validity_warning_days', parseValidityWarningDays),
  ),
  spec(
    'handoff_receiving_roles',
    'proposal',
    'Hand-off receiving roles',
    'json',
    notNull('handoff_receiving_roles', parseReceivingRoles),
  ),
  // Qualification warnings (D-06)
  spec(
    'min_opportunity_value_warning_usd',
    'qualification',
    'Warn below this opportunity value (USD)',
    'nullableNumber',
    z_('min_opportunity_value_warning_usd', nonNegative.nullable()),
    { nullable: true },
  ),
  spec(
    'min_volume_warning_by_process',
    'qualification',
    'Warn below this annual volume, by process type (* = process not known yet)',
    'numberMap',
    z_('min_volume_warning_by_process', z.record(z.string().min(1), nonNegative)),
  ),
  spec(
    'qualification_exception_note_outcomes',
    'qualification',
    'Decisions that need a strategic exception note when a warning is raised',
    'json',
    z_('qualification_exception_note_outcomes', z.array(gateOutcomePair)),
  ),
  // Scoring visibility
  spec(
    'kam_can_see_peer_scores',
    'scoring',
    "KAMs see peers' priority scores",
    'boolean',
    z_('kam_can_see_peer_scores', z.boolean()),
  ),
  // Intake (D-05, CR-08)
  spec(
    'intake_required_fields',
    'intake',
    'Intake fields that block a submit',
    'rules',
    z_('intake_required_fields', z.array(requiredRuleSchema)),
  ),
  spec(
    'intake_volume_placeholder',
    'intake',
    'Volume placeholder guard',
    'json',
    z_('intake_volume_placeholder', intakeConfigSchema.shape.volumePlaceholder),
  ),
  spec(
    'intake_default_request_class',
    'intake',
    'Default request class code',
    'text',
    z_('intake_default_request_class', z.string().trim().min(1)),
  ),
  spec(
    'intake_description_template',
    'intake',
    'Standard description template',
    'text',
    z_('intake_description_template', z.string().trim().min(1)),
  ),
  spec(
    'intake_field_help',
    'intake',
    '"Why we ask" help per intake field',
    'json',
    z_('intake_field_help', z.record(z.string().min(1), z.string())),
  ),
  // Engineering queue (DEC-26, R-04)
  spec(
    'eng_queue_aging_days',
    'engineering',
    'Engineering queue aging buckets (business days)',
    'agingDays',
    z_('eng_queue_aging_days', engQueueSettingsSchema.shape.agingDays),
  ),
  spec(
    'eng_queue_backup_assigner_user_ids',
    'engineering',
    'Backup assigners when the engineering lead is out',
    'userIds',
    z_('eng_queue_backup_assigner_user_ids', z.array(z.uuid()).refine(unique, 'duplicate user')),
  ),
  spec(
    'capital_readiness_on_outcome',
    'engineering',
    'Capital readiness written by a gate decision (GATE:outcome → readiness)',
    'json',
    z_('capital_readiness_on_outcome', z.record(gateOutcomePair, z.enum(CAPITAL_READINESS_VALUES))),
  ),
  // Pricing (B-26, D-24)
  spec(
    'pricing_pass_through',
    'pricing',
    'Price proceeds without formal approval below this annual revenue (not set = every price is approved)',
    'json',
    notNull('pricing_pass_through', parsePassThrough),
  ),
  // Capital and Market Development notices (B-26, D-27)
  spec(
    'capital_management_notice',
    'notifications',
    'Capital Management early notice: who hears when a quote is flagged "capital likely"',
    'json',
    notNull('capital_management_notice', parseCapitalNotice),
  ),
  spec(
    'market_development_notice',
    'notifications',
    'Market Development notice: value threshold and who hears',
    'json',
    notNull('market_development_notice', parseMarketDevNotice),
  ),
  // Escalations and the Process Owner (B-26, D-28)
  spec(
    'process_owner',
    'escalation',
    'CCQ Process Owner (owns the process, not the work)',
    'json',
    notNull('process_owner', parseProcessOwner),
  ),
  spec(
    'escalation_routes',
    'escalation',
    'Escalation types and who receives each',
    'json',
    notNull('escalation_routes', parseEscalationRoutes),
  ),
  // Final Review (D-10)
  spec(
    'legal_review_triggers',
    'final_review',
    'Legal review triggers before G4 releases the offer (D-25)',
    'json',
    notNull('legal_review_triggers', parseLegalReviewTriggers),
  ),
  spec(
    'g4_tier_rules',
    'final_review',
    'Final Review approver tiers (not set = any Approver)',
    'json',
    (v) => parseApproverTierRules(v),
    { nullable: true },
  ),
  // Overrides (R1)
  spec(
    'overridable_fields',
    'overrides',
    'Override approvers per field',
    'overridableFields',
    (v) =>
      parseOverrideSettings({
        fields: z_('overridable_fields', z.array(overridableFieldSchema))(v),
        justificationMinLength: 1,
      }).fields,
  ),
  spec(
    'override_justification_min_length',
    'overrides',
    'Minimum override justification length (characters)',
    'integer',
    z_('override_justification_min_length', z.number().int().min(1).max(500)),
  ),
  // Notifications
  spec(
    'email_notifications_enabled',
    'notifications',
    'Send notification emails',
    'boolean',
    z_('email_notifications_enabled', z.boolean()),
  ),
  // Integrations and data
  spec(
    'pricing_ref_formats',
    'integrations',
    'Legacy ERF number format (transition only)',
    'json',
    notNull('pricing_ref_formats', parsePricingRefFormats),
  ),
  spec(
    'salesforce_new_opportunity_url',
    'integrations',
    'Salesforce "new opportunity" link',
    'text',
    z_('salesforce_new_opportunity_url', z.url({ protocol: /^https$/ })),
  ),
  spec(
    'role_change_request_url',
    'other',
    'IT ticket form for role changes (not set = "contact the IT help desk")',
    'text',
    z_('role_change_request_url', z.url({ protocol: /^https$/ }).nullable()),
    { nullable: true },
  ),
  spec(
    'sf_amount_suspect_below_usd',
    'integrations',
    'Flag Salesforce amounts below (USD) as placeholders',
    'number',
    z_('sf_amount_suspect_below_usd', nonNegative),
  ),
  spec(
    'attachment_settings',
    'integrations',
    'Attachment folders and removal window',
    'json',
    notNull('attachment_settings', parseAttachmentSettings),
  ),
  spec(
    'default_scope_type',
    'other',
    'Data scope for users with no scope row',
    'select',
    z_('default_scope_type', z.enum(['all', 'owner'])),
    { options: ['all', 'owner'] },
  ),
];

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const SPECS = new Map(SETTING_SPECS.map((s) => [s.key, s]));

/** The spec for a key; a generic JSON spec for keys the console has no editor for. */
export function settingSpec(key: string): SettingSpec {
  return (
    SPECS.get(key) ?? {
      key,
      group: 'other',
      label: key,
      editor: 'json',
      nullable: true,
      parse: zodParser(key, z.json()),
    }
  );
}

/**
 * Validates a proposed value for `key` and returns what to store (normalised: trimmed, defaults
 * applied). Throws INVALID_CONFIG. JSON null means "not set" and is only valid where the spec says so,
 * so `g4_tier_rules: null` (disabled) is stored as null rather than replaced by a fallback.
 */
export function parseSettingValue(key: string, value: unknown): unknown {
  const s = settingSpec(key);
  if (value === null || value === undefined) {
    if (!s.nullable) throw new DomainError('INVALID_CONFIG', `${key} needs a value`);
    return null;
  }
  return s.parse(value);
}
