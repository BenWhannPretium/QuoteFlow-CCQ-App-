import {
  ENG_QUEUE_SETTINGS_SEED,
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
      'B-11: format-only checks for the pricing-app references on the Quoting tab ({erf|bpr: {label, pattern, example}}). Guesses until Cory McGahan confirms the real formats at M5 (D-PR).',
  },
  {
    key: 'salesforce_new_opportunity_url',
    value: 'https://pretiumpkg.lightning.force.com/lightning/o/Opportunity/new',
    description:
      'Where the intake sends a KAM whose opportunity is not in Salesforce yet (DEC-12).',
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

/** Salesforce stages (architecture §4.2) with the CCQ stage they usually line up with. */
export const SF_STAGES: [sfStage: string, hint: string | null][] = [
  ['Qualifying', 'INTAKE'],
  ['Quoting', 'QUOTING'],
  ['Negotiating', 'CUSTOMER_DECISION'],
  ['Final Review', 'FINAL_REVIEW'],
  ['Verbal Award', 'AWARDED'],
  ['PO(s) in hand', 'AWARDED'],
  ['Closed Won – Product Shipping', 'AWARDED'],
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
