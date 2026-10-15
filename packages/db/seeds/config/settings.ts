import { upsertConfig } from './_upsert';
import type { DbOrTx } from '../../src/client';
import { appSetting, scoringModel, sfStageMap } from '../../src/schema/index';

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
];

export const seedAppSettings = (db: DbOrTx) =>
  upsertConfig(
    db,
    appSetting,
    APP_SETTINGS.map((s) => ({ ...s, provisional: true })),
    ['key'],
  );

/** Scoring model v1: the 7 PRD attributes, equal weights, stub band mappings (B-08 fills them). */
export const SCORING_MODEL_V1 = {
  modelVersion: 1,
  attributes: [
    ['revenue', 'Revenue'],
    ['volume', 'Volume'],
    ['strategic_fit', 'Strategic fit'],
    ['capital_exposure', 'Capital exposure'],
    ['customer_risk', 'Customer risk'],
    ['product_fit', 'Product fit'],
    ['timing', 'Timing'],
  ].map(([key, label]) => ({
    key,
    label,
    weight: 1,
    scale: { min: 0, max: 100 },
    mapping: { type: 'bands', bands: [], todo: 'B-08' },
  })),
  tierThresholds: [
    { tier: 'Critical', min: 80 },
    { tier: 'High', min: 60 },
    { tier: 'Standard', min: 40 },
    { tier: 'Low', min: 0 },
  ],
  effectiveFrom: new Date('2026-10-01T00:00:00Z'),
  changeReason: 'Seed v1: PRD attribute set with equal (relative) weights, pending D-19.',
};

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
