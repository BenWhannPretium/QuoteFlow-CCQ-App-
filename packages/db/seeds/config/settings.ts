import {
  CAPITAL_NOTICE_SEED,
  ESCALATION_ROUTES_SEED,
  LEGAL_REVIEW_TRIGGERS_SEED,
  MARKET_DEV_NOTICE_SEED,
  PASS_THROUGH_SEED,
  PROCESS_OWNER_SEED,
  ATTACHMENT_SETTINGS_SEED,
  ENG_QUEUE_SETTINGS_SEED,
  HANDOFF_RECEIVING_ROLES_SEED,
  VALIDITY_WARNING_DAYS_SEED,
  OVERRIDE_SETTINGS_SEED,
  PRICING_REF_FORMATS_SEED,
  SCORING_MODEL_V1_INPUT,
} from '@ccq/domain';

import { upsertConfig } from './_upsert';
import type { DbOrTx } from '../../src/client';
import { scoringModelRow } from '../../src/repos/config';
import { appSetting, scoringModel, sfStageMap } from '../../src/schema/index';

const present = (field: string) => ({ field, op: 'present' });

/** Seed blocking set (D-05 recommended direction): SF opportunity, customer, ship-to, product family, resin, volume. */
export const INTAKE_REQUIRED_FIELDS = [
  present('sf_opportunity_id'),
  present('customer.name'),
  { anyOf: [present('ship_to.line1'), present('ship_to.city')] },
  present('product_family'),
  present('resin'),
  present('est_annual_volume'),
];

/** "Why we ask", one line per intake field (keys are the snake_case intake field names). */
export const INTAKE_FIELD_HELP: Record<string, string> = {
  sf_opportunity_id:
    'Every CCQ quote starts from a Salesforce opportunity, so pipeline and outcomes stay linked.',
  customer:
    'Engineering and Pricing size the work differently for a new versus an established customer.',
  ship_to: 'Freight and the plant that can fill the order both depend on where the product ships.',
  ship_to_override_reason:
    'A ship-to that differs from the account default changes the quote, so we record why.',
  request_class:
    'CCQ is new business that needs engineering or capital; stock and price checks take a faster route.',
  product_family: 'Tells Engineering which product line and tooling family to look at.',
  components: 'Closures, liners and labels change tooling, sourcing and the price build.',
  market: 'Market drives material, regulatory and cleanliness requirements.',
  resin: 'Resin decides the process, the machine and much of the cost.',
  neck_finish: 'The neck finish is one of the details Engineering most often has to chase.',
  packaging_type: 'How it ships (bulk, bagged, trayed) changes pack-out, labour and freight.',
  packaging_notes: 'Pallet, case and labelling rules are a common reason quotes come back.',
  est_annual_volume:
    "Volume sizes the machine, cavitation and capacity. Please use the customer's real number.",
  est_annual_revenue: 'Revenue helps rank the request; it starts from the Salesforce amount.',
  expected_close_date: 'Lets Engineering plan around when the customer needs an answer.',
  container_size: 'Size, with the container type and resin, makes up the standard description.',
  standard_description: 'A consistent description makes requests easy to compare and search.',
  description: 'Anything else about the request, in your own words.',
  drawing_status:
    'A drawing is the fastest way to an accurate quote; without one it usually takes longer.',
  comments_for_engineering: 'Context only you know: the customer, competitors, history, deadlines.',
};

/** Settings for open decisions. Values are provisional seeds; the descriptions name the decision. */
export const APP_SETTINGS: { key: string; value: unknown; description: string }[] = [
  {
    key: 'validity_days_default',
    value: 30,
    description: 'Default proposal validity in days. PTF says 30; D-12 open.',
  },
  // ── B-18 notifications. Provisional.
  {
    key: 'email_notifications_enabled',
    value: true,
    description:
      'Send notification emails (B-18). false = in-app notifications only (the documented fallback if the shared mailbox is not ready). Turning it off stops new email rows and drops the ones still queued (the dispatcher skips them; they are not sent later).',
  },
  // ── B-13 customer decision (D-12, D-15, R3). All provisional.
  {
    key: 'validity_warning_days',
    value: VALIDITY_WARNING_DAYS_SEED,
    description:
      'The proposal validity countdown turns amber at this many days left or fewer (red once expired). The daily expiry job flags lapsed quotes and tells the KAM; nothing auto-closes (D-12 open).',
  },
  {
    key: 'handoff_receiving_roles',
    value: HANDOFF_RECEIVING_ROLES_SEED,
    description:
      'Who an awarded quote is handed to (the minimal hand-off record, B-13): [{code, label}]. "other" asks for the team. Provisional: confirm with Amanda Cronkhite (Commercial Activation) at R3.',
  },
  {
    key: 'g4_tier_rules',
    value: null,
    description:
      'Final Review approver tiers (B-12, D-10). Null = disabled: any Approver may decide. When set: { outcomeKeys: ["approve"], tiers: [{ key, label, minCapitalUsd?, minAnnualRevenueUsd?, approverRoles[], approverUserIds[] }] }, lowest to highest tier; the highest tier a quote falls in decides who may approve it.',
  },
  {
    key: 'g1_enabled',
    value: true,
    description:
      'Whether the G1 qualify gate is used (D-06). When false, SUBMIT goes straight to Engineering.',
  },
  {
    key: 'min_opportunity_value_warning_usd',
    value: null,
    description: 'Warn (never block) below this opportunity value. Null = no warning until D-06.',
  },
  {
    key: 'min_volume_warning_by_process',
    value: {},
    description:
      'Warn (never block) below these annual volumes, keyed by process_type code. D-06 open.',
  },
  {
    key: 'qualification_exception_note_outcomes',
    value: ['G1:advance'],
    description:
      'gate:outcome pairs that need a strategic exception note when a qualification warning is raised (D-06). Warnings never block otherwise.',
  },
  {
    key: 'sla_hours_by_stage',
    value: null,
    description: 'SLA hours per stage key. Null until D-20; aging buckets only.',
  },
  {
    key: 'kam_can_see_peer_scores',
    value: true,
    description: "KAMs see peers' priority scores (D-K1, PRD lean).",
  },
  {
    key: 'sf_amount_suspect_below_usd',
    value: 100,
    description:
      'Salesforce opportunity amounts below this (USD) are flagged as suspect placeholders (B-06 discovery: e.g. $0.31).',
  },
  {
    key: 'default_scope_type',
    value: 'all',
    description: 'Data scope for users with no user_scope row (PRD lean: full pipeline).',
  },
  // ── B-07 intake. All provisional: Danielle Leu and Jim Zweifel finalise "stop vs enrich" at M4 (D-05, CR-08).
  {
    key: 'intake_required_fields',
    value: INTAKE_REQUIRED_FIELDS,
    description:
      'Intake fields that BLOCK a submit (required-field DSL). Every other missing field is an amber "Engineering may ask about this". D-05 / CR-08.',
  },
  {
    key: 'intake_volume_placeholder',
    value: { values: [1_000_000], roundMultiple: 1_000_000 },
    description:
      'Soft confirm when the annual volume looks like a default ("almost always entered as one million"): exact values, or any whole multiple of roundMultiple (null = off).',
  },
  {
    key: 'intake_default_request_class',
    value: 'CCQ',
    description:
      'Default request_class code at intake. Any other class shows "This may be redirected at qualification".',
  },
  {
    key: 'intake_description_template',
    value: '{container_size} {product_family}[, {resin}][ with {components}]',
    description:
      'Suggested standard description (Sarah Brennan). {field} is replaced by its label; a [ … ] segment is dropped when a field in it is empty. Format provisional.',
  },
  {
    key: 'intake_field_help',
    value: INTAKE_FIELD_HELP,
    description:
      'One-line "why we ask" helper text per intake field (feeds the P1 F-19 per-field explanations).',
  },
  // ── B-09 governed overrides. Who approves is a blueprint gap: interim SalesLeader / EngLead, confirm in R1.
  {
    key: 'overridable_fields',
    value: OVERRIDE_SETTINGS_SEED.fields,
    description:
      'Fields that may be overridden, with who requests, approves (approval: approver | self) and reverts each. Who approves overrides is a blueprint gap to confirm in R1.',
  },
  {
    key: 'override_justification_min_length',
    value: OVERRIDE_SETTINGS_SEED.justificationMinLength,
    description: 'Minimum length (characters, trimmed) of an override justification.',
  },
  // ── B-10 engineering queue (DEC-26: manual prioritized queue to the upfront engineering lead).
  {
    key: 'eng_queue_aging_days',
    value: ENG_QUEUE_SETTINGS_SEED.agingDays,
    description:
      "Engineering queue aging buckets in business days (US Central): < aging, aging–old, > old. 3 is Jim Zweifel's unwritten target. Buckets only, NOT an SLA (D-20).",
  },
  {
    key: 'eng_queue_backup_assigner_user_ids',
    value: ENG_QUEUE_SETTINGS_SEED.backupAssignerUserIds,
    description:
      'app_user ids who may assign / reassign engineering reviews when the EngLead is out (Op Model R-04). They also get the queue-arrival alert and need a role that can open the queue (engQueue.read).',
  },
  {
    key: 'capital_readiness_on_outcome',
    value: { 'G2:capital_required': 'pending' },
    description:
      'gate:outcome → the capital_readiness the decision writes on the pricing record (B-10: "Capital required" at G2 starts Pricing on pending).',
  },
  {
    key: 'pricing_ref_formats',
    value: PRICING_REF_FORMATS_SEED,
    description:
      'B-11: format-only check for the legacy ERF numbers on the Quoting tab ({erf: {label, pattern, example}}). B-26: ERF is a transition-only reference and BPR is outside CCQ (a stored bpr entry is ignored). B-15 (2026-10-22): the format of the pricing-app export, ERF<yy>-<n> or EP<yy>-<n>.',
  },
  // ── B-26 demo feedback and the future-state deck. All provisional.
  {
    key: 'pricing_pass_through',
    value: PASS_THROUGH_SEED,
    description:
      'D-24: below this estimated annual revenue (USD) a price proceeds without formal Pricing approval, so the pricing gate does not become a bottleneck. null = off (Pricing has not set the amount): every price needs its approval.',
  },
  {
    key: 'legal_review_triggers',
    value: LEGAL_REVIEW_TRIGGERS_SEED,
    description:
      'D-25: when any switched-on trigger applies (new customer, nonstandard terms, tooling commitment), G4 Advance needs the Legal review recorded.',
  },
  {
    key: 'capital_management_notice',
    value: CAPITAL_NOTICE_SEED,
    description:
      'D-27: app_user ids told (awareness, not approval) the first time a quote is flagged "capital likely". Capital Management is not a CCQ role, so name the people. Empty = nobody yet.',
  },
  {
    key: 'market_development_notice',
    value: MARKET_DEV_NOTICE_SEED,
    description:
      'D-27: Market Development is told when a quote at or above minAnnualRevenueUsd enters Engineering Review (once per quote). null threshold = off; recipientUserIds = app_user ids.',
  },
  {
    key: 'process_owner',
    value: PROCESS_OWNER_SEED,
    description:
      'D-28: the CCQ Process Owner (net-new Commercial role, TBD; Oleg Yarovinski is interim). Set userId to the CCQ user; escalation routes with processOwner=true go to them.',
  },
  {
    key: 'escalation_routes',
    value: ESCALATION_ROUTES_SEED,
    description:
      'D-28: escalation types (the paths on the future-state stage maps) and who receives each: CCQ roles, named app_user ids (Operations / Supply Chain leadership, Market Development) and/or the Process Owner.',
  },
  // ── B-19 admin console.
  {
    key: 'role_change_request_url',
    value: null,
    description:
      'Where Admin > Users sends someone who needs a different CCQ role: the IT ticket form for Entra group membership (roles come from Entra groups; CCQ never edits them). Null = "contact the IT help desk" until IT confirms the link.',
  },
  {
    key: 'salesforce_new_opportunity_url',
    value: 'https://pretiumpkg.lightning.force.com/lightning/o/Opportunity/new',
    description:
      'Where the intake sends a KAM whose opportunity is not in Salesforce yet (DEC-12).',
  },
  {
    key: 'attachment_settings',
    value: ATTACHMENT_SETTINGS_SEED,
    description:
      'B-16 (D-SP): folders relative to the document library root ({quoteFolder} with {quote_number}, {draftFolder} with {draft_id}, {removedFolder} for soft deletes) and how many hours an uploader may remove their own file (Admin always may). Folder convention agreed at M7 with Bailey (ERF restructure for Ranger); /CCQ/{quote_number}/ until then.',
  },
];

export const seedAppSettings = (db: DbOrTx) =>
  upsertConfig(
    db,
    appSetting,
    APP_SETTINGS.map((s) => ({ ...s, provisional: true })),
    ['key'],
  );

/** Scoring model v1 as a row, derived from the domain seed (`packages/domain/src/scoring/seeds.ts`), the single source. */
export const SCORING_MODEL_V1 = scoringModelRow(SCORING_MODEL_V1_INPUT, {
  effectiveFrom: new Date('2026-10-01T00:00:00Z'),
  changeReason:
    'Seed v1: the PRD F-05 attribute set with provisional weights and bands, pending D-19 (M4).',
});

export const seedScoringModel = (db: DbOrTx) =>
  upsertConfig(db, scoringModel, [{ ...SCORING_MODEL_V1, provisional: true }], ['modelVersion']);

/**
 * Salesforce stages (architecture §4.2) with the CCQ stage they usually line up with. The names and
 * order are the org's active OpportunityStage rows (read 2026-10-24): both the older and the newer
 * stage sets are active. Won = "Closed Won - Product Shipping" (a hyphen), lost = "Closed Lost". The
 * hints are provisional.
 */
export const SF_STAGES: [sfStage: string, hint: string | null][] = [
  ['Prospecting', 'INTAKE'],
  ['Qualification / Needs Analysis', 'INTAKE'],
  ['Qualifying', 'INTAKE'],
  ['RFP / Quote Entry - In Process', 'QUOTING'],
  ['Quoted', 'CUSTOMER_DECISION'],
  ['Quoting', 'QUOTING'],
  ['Negotiating', 'CUSTOMER_DECISION'],
  ['Negotiation / Customer Testing', 'CUSTOMER_DECISION'],
  ['Final Review', 'FINAL_REVIEW'],
  // B-26: an award waits in Commit & Hand Off until the CER and hand-off close it Won.
  ['Verbal Award', 'COMMIT_HANDOFF'],
  ['Verbal Award / Tool PO in Hand', 'COMMIT_HANDOFF'],
  ['PO(s) in hand', 'COMMIT_HANDOFF'],
  ['Closed Won - Product Shipping', 'AWARDED'],
  ['Closed Lost', 'CLOSED_LOST'],
];

export const seedSfStageMap = (db: DbOrTx) =>
  upsertConfig(
    db,
    sfStageMap,
    SF_STAGES.map(([sfStage, ccqStageHint], i) => ({
      sfStage,
      ccqStageHint,
      sort: (i + 1) * 10,
      provisional: true,
    })),
    ['sfStage'],
  );
