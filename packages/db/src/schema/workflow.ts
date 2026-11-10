import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { c, documented, inList } from './_doc';
import { stageDefinition } from './config';
import {
  ACCEPTANCE_EVIDENCE,
  ATTACHMENT_KINDS,
  ATTACHMENT_STORAGES,
  CAPACITY_SIGNOFF_STATUSES,
  CAPITAL_READINESS,
  CER_STATUSES,
  COST_MODEL_REQUIREMENTS,
  CUSTOMER_STATUSES,
  OVERRIDE_APPROVAL_MODES,
  OVERRIDE_STATUSES,
  QUOTE_STATUSES,
  QUOTE_TERMS_EXCEPTION_STATUSES,
  RESUME_AT,
  SF_STATUS_FLAGS,
  TERMS_EXCEPTION_STATUSES,
  VERSIONED_ATTACHMENT_KINDS,
} from './enums';
import { appUser, baseColumns, timestamptz } from './identity';

const SF = 'Salesforce (read-only)';
const KAM = 'KAM';
const ENG = 'Engineering (EngLead / Engineer)';
const PRICING = 'Pricing';
const SYSTEM = 'CCQ (system)';
const COMMERCIAL =
  ' Commercial tag: stripped for roles without quote.read.commercialFields (every role holds it since 2026-10-30).';

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });
const userRef = (name: string) => uuid(name).references(() => appUser.id, { onDelete: 'restrict' });
const quoteRef = () =>
  uuid('quote_id')
    .notNull()
    .references(() => quote.id, { onDelete: 'restrict' });

export const customer = documented(
  pgTable(
    'customer',
    {
      ...baseColumns(),
      sfAccountId: c(
        text('sf_account_id').unique(),
        'Salesforce Account id. Every customer from intake has one since FB-02 (F-007, D-011: new accounts start in Salesforce); null only on rows typed at intake before FB-02.',
        SF,
      ),
      name: c(text('name').notNull(), 'Customer name.', SF),
      status: c(
        text('status').notNull(),
        'existing | not_yet_established (DEC-27: no account creation at intake). FB-02: not_yet_established = "Not yet a Pretium customer (no ERP account)", the KAM\'s answer at intake; it drives the new_customer Legal review trigger.',
        KAM,
      ),
      defaultShipTo: c(
        jsonb('default_ship_to'),
        'Default ship-to address {line1, city, state, postal, country}.',
        SF,
      ),
      source: c(
        text('source').notNull().default('salesforce'),
        'Where the row came from: salesforce | intake | synthetic.',
        SYSTEM,
      ),
      lastSyncedAt: c(timestamptz('last_synced_at'), 'Last refresh from Salesforce.', SYSTEM),
      location: c(
        text('location'),
        'Deprecated (FB-02, F-007): where a not-yet-established customer is, as typed at intake before FB-02. Kept for history; no longer written.',
        KAM,
      ),
      contact: c(
        jsonb('contact'),
        "Deprecated (FB-02, F-007): a not-yet-established customer's contact {name, email, phone} typed at intake before FB-02. Kept for history; no longer written.",
        KAM,
      ),
    },
    (t) => [
      check('customer_status_check', inList(t.status, CUSTOMER_STATUSES)),
      // FB-02 (F-007): an existing customer has an SF account; a not-yet-established one (no ERP account)
      // now has one too, except rows typed at intake before FB-02.
      check(
        'customer_existing_has_sf_account_check',
        sql`${t.status} <> 'existing' or ${t.sfAccountId} is not null`,
      ),
      index('customer_name_idx').on(t.name),
      // B-14 pipeline search (`q`: ILIKE '%…%' on the account name).
      index('customer_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
    ],
  ),
  {
    area: 'workflow',
    owner: SF,
    description: 'Customer an opportunity is for. Existing (SF account) or not yet established.',
  },
);

export const sfOpportunitySnapshot = documented(
  pgTable(
    'sf_opportunity_snapshot',
    {
      ...baseColumns(),
      sfOpportunityId: c(
        text('sf_opportunity_id').notNull().unique(),
        'Salesforce Opportunity id.',
      ),
      name: c(text('name').notNull(), 'Opportunity name.'),
      accountId: c(text('account_id'), 'Salesforce Account id.'),
      accountName: c(text('account_name'), 'Account name as shown in SF.'),
      ownerAlias: c(text('owner_alias'), 'Opportunity owner alias.'),
      ownerEmail: c(text('owner_email'), 'Opportunity owner email (maps to the KAM).'),
      amount: c(money('amount'), 'Opportunity amount (USD).'),
      closeDate: c(date('close_date', { mode: 'string' }), 'Expected close date.'),
      sfStage: c(text('sf_stage'), 'Salesforce StageName (see sf_stage_map).'),
      erfNumberSf: c(text('erf_number_sf'), 'ERF number recorded on the opportunity, if any.'),
      quoteSourceSf: c(text('quote_source_sf'), 'Quote source field from SF.'),
      ownerName: c(text('owner_name'), 'Opportunity owner display name.'),
      isClosed: c(
        boolean('is_closed').notNull().default(false),
        'SF IsClosed (Closed Won or Closed Lost).',
      ),
      isWon: c(boolean('is_won').notNull().default(false), 'SF IsWon.'),
      systemModstamp: c(
        timestamptz('system_modstamp'),
        'SF SystemModstamp of the copy; the delta sync reads records changed after the last run.',
      ),
      deletedInSfAt: c(
        timestamptz('deleted_in_sf_at'),
        'When SF reported the opportunity deleted. The snapshot is kept, never deleted.',
        SYSTEM,
      ),
      dataQuality: c(
        text('data_quality').array().notNull().default([]),
        'Mapper flags: amount_missing | amount_suspect | account_missing | owner_missing | close_date_missing.',
        SYSTEM,
      ),
      raw: c(
        jsonb('raw').notNull().default({}),
        'Full SF payload as received, for troubleshooting.',
      ),
      syncedAt: c(timestamptz('synced_at').notNull(), 'When the snapshot was taken.', SYSTEM),
    },
    (t) => [
      index('sf_opportunity_snapshot_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
      index('sf_opportunity_snapshot_account_name_trgm_idx').using(
        'gin',
        t.accountName.op('gin_trgm_ops'),
      ),
      index('sf_opportunity_snapshot_owner_email_idx').on(t.ownerEmail),
    ],
  ),
  {
    area: 'workflow',
    owner: SF,
    description: 'Read-only copy of a Salesforce opportunity. Every quote links to one (DEC-12).',
  },
);

export const quote = documented(
  pgTable(
    'quote',
    {
      ...baseColumns(),
      // Identity and status
      quoteNumber: c(
        text('quote_number').notNull().unique(),
        'CCQ-YYYY-NNNNN from next_quote_number().',
        SYSTEM,
      ),
      sfOpportunityId: c(
        text('sf_opportunity_id')
          .notNull()
          .references(() => sfOpportunitySnapshot.sfOpportunityId, { onDelete: 'restrict' }),
        'Salesforce opportunity the quote belongs to (required, DEC-12).',
        KAM,
      ),
      customerId: c(
        uuid('customer_id').references(() => customer.id, { onDelete: 'restrict' }),
        'Customer.',
        KAM,
      ),
      kamUserId: c(
        userRef('kam_user_id').notNull(),
        'Owning KAM. Drives owner-scoped access.',
        KAM,
      ),
      region: c(
        text('region'),
        'Sales region of the opportunity; drives region-scoped access.',
        KAM,
      ),
      stageKey: c(
        text('stage_key')
          .notNull()
          .references(() => stageDefinition.key, { onDelete: 'restrict', onUpdate: 'cascade' }),
        'Current workflow stage.',
        SYSTEM,
      ),
      status: c(text('status').notNull().default('active'), 'active | on_hold | closed.', SYSTEM),
      version: c(
        integer('version').notNull().default(1),
        'Bumped on return / rework / re-quote. Prior decisions are kept.',
        SYSTEM,
      ),
      // Intake
      description: c(text('description'), 'Free-text description of the request.', KAM),
      structuredDescription: c(
        jsonb('structured_description'),
        'Structured description, e.g. {size, shape, finish, decoration}.',
        KAM,
      ),
      productFamily: c(text('product_family'), 'value_list product_family code.', KAM),
      market: c(text('market'), 'value_list market code.', KAM),
      subMarket: c(
        text('sub_market'),
        "value_list sub_market code (FB-12); belongs to the quote's market. Optional. Sets the strategic-fit score.",
        KAM,
      ),
      resin: c(text('resin'), 'value_list resin code.', KAM),
      components: c(
        text('components').array().notNull().default([]),
        'value_list component codes.',
        KAM,
      ),
      estAnnualVolume: c(
        bigint('est_annual_volume', { mode: 'number' }),
        'Estimated annual volume (units).',
        KAM,
      ),
      estAnnualRevenue: c(money('est_annual_revenue'), 'Estimated annual revenue (USD).', KAM),
      estAnnualRevenueSf: c(
        money('est_annual_revenue_sf'),
        'The SF opportunity amount the revenue was pre-filled from (kept when the KAM edits it).',
        SF,
      ),
      estAnnualVolumeConfirmed: c(
        boolean('est_annual_volume_confirmed').notNull().default(false),
        'The KAM confirmed a round, placeholder-looking volume (e.g. 1,000,000) is real.',
        KAM,
      ),
      expectedCloseDate: c(
        date('expected_close_date', { mode: 'string' }),
        'Deprecated (FB-02, F-008 / T-009): the close date the KAM edited at intake before FB-02. Kept for history and analytics; no longer written. The live value is sf_opportunity_snapshot.close_date.',
        KAM,
      ),
      quoteNeededBy: c(
        date('quote_needed_by', { mode: 'string' }),
        'FB-02 (F-009): when the customer needs the quote (after the submit date). Feeds the timing attribute of the priority score.',
        KAM,
      ),
      productNeededBy: c(
        date('product_needed_by', { mode: 'string' }),
        "FB-02 (F-009): the KAM's best estimate of the customer's launch need; on or after quote_needed_by.",
        KAM,
      ),
      drawingStatus: c(text('drawing_status'), 'value_list drawing_status code.', KAM),
      neckFinish: c(
        text('neck_finish'),
        'Deprecated (FB-02, F-010): the old single neck_finish code, or free text when "Other". Kept for history; no longer written. Migration 0028 split it into neck_diameter / neck_finish_type.',
        KAM,
      ),
      // FB-02 (F-010): the neck as three pick-lists (Jim Zweifel's lists, provisional).
      neckDiameter: c(
        text('neck_diameter'),
        'FB-02: value_list neck_diameter code (mm, or 409 / 605D snap; CUSTOM).',
        KAM,
      ),
      neckDiameterCustom: c(
        text('neck_diameter_custom'),
        'FB-02: short description (≤ 120) when neck_diameter is Custom; null otherwise.',
        KAM,
      ),
      neckFinishType: c(
        text('neck_finish_type'),
        'FB-02: value_list neck_finish_type code (400, 410, CRC, Snap…; CUSTOM).',
        KAM,
      ),
      neckFinishTypeCustom: c(
        text('neck_finish_type_custom'),
        'FB-02: short description (≤ 120) when neck_finish_type is Custom; null otherwise.',
        KAM,
      ),
      neckSpecialFeature: c(
        text('neck_special_feature'),
        'FB-02: optional value_list neck_special_feature code (CT, Multi Lead, Tamper Evident, Vented; CUSTOM).',
        KAM,
      ),
      neckSpecialFeatureCustom: c(
        text('neck_special_feature_custom'),
        'FB-02: short description (≤ 120) when neck_special_feature is Custom; null otherwise.',
        KAM,
      ),
      // FB-02 (F-011, F-055, F-023, F-075): resin grade, PCR, color, additives, variants.
      resinCustomerSpecified: c(
        boolean('resin_customer_specified').notNull().default(false),
        'FB-02 (F-011): the customer specifies the resin; resin_grade names it.',
        KAM,
      ),
      resinGrade: c(
        text('resin_grade'),
        'FB-02 (F-011): supplier / grade of a customer-specified resin (≤ 120), e.g. "LyondellBasell Pro-fax 6331". FB-09: also required when resin is Other.',
        KAM,
      ),
      pcrLevel: c(
        text('pcr_level'),
        'FB-02 (F-055): value_list pcr_level code (0% / Virgin, 25, 30, 50, 100 %, Other).',
        KAM,
      ),
      colorType: c(
        text('color_type'),
        'FB-02 (F-023): value_list color_type code (NATURAL / CUSTOM).',
        KAM,
      ),
      colorDescription: c(
        text('color_description'),
        'FB-02 (F-023): the custom color (≤ 120); null for Natural.',
        KAM,
      ),
      pcrLevelOther: c(
        text('pcr_level_other'),
        'FB-09 (Danielle Leu): the customer-specified PCR level (≤ 120) when pcr_level is Other; null otherwise.',
        KAM,
      ),
      additive: c(
        text('additive'),
        'FB-09: value_list additive code (None / UV / Barrier / Antistat / Impact Modifier / Other). Not backfilled: older quotes keep their additives text only.',
        KAM,
      ),
      additives: c(
        text('additives'),
        'FB-02 (F-023): additives note (≤ 200). FB-09: required, as the customer-specified additive, when additive is Other.',
        KAM,
      ),
      // FB-02 (F-013): component follow-ups (written only while the component is picked).
      linerSpec: c(
        text('liner_spec'),
        'FB-02 (F-013): liner spec (≤ 120) when a Liner is picked.',
        KAM,
      ),
      labelsPurchasedBy: c(
        text('labels_purchased_by'),
        'FB-02 (F-013): value_list labels_purchased_by code (CUSTOMER / PRETIUM) when a Label is picked.',
        KAM,
      ),
      decorationType: c(
        text('decoration_type'),
        'FB-02 (F-013): value_list decoration_type code when Decoration is picked.',
        KAM,
      ),
      decorationPrintColors: c(
        integer('decoration_print_colors'),
        'FB-02 (F-013): number of print colors (1–12) when Decoration is picked.',
        KAM,
      ),
      // FB-02 (F-016, D-018): dimensions for the drawing-or-minimum-spec rule.
      heightMm: c(
        numeric('height_mm', { precision: 10, scale: 2, mode: 'number' }),
        'FB-02 (F-016): product height (mm).',
        KAM,
      ),
      widthOrDiameterMm: c(
        numeric('width_or_diameter_mm', { precision: 10, scale: 2, mode: 'number' }),
        'FB-02 (F-016): product width or diameter (mm).',
        KAM,
      ),
      depthMm: c(
        numeric('depth_mm', { precision: 10, scale: 2, mode: 'number' }),
        'FB-02 (F-016): product depth (mm).',
        KAM,
      ),
      gramWeightG: c(
        numeric('gram_weight_g', { precision: 10, scale: 2, mode: 'number' }),
        'FB-02 (F-016): gram weight (g).',
        KAM,
      ),
      // FB-02 (F-015): modify an existing mold.
      modifyExistingMold: c(
        boolean('modify_existing_mold').notNull().default(false),
        'FB-02 (F-015): the request modifies an existing mold (Engineering queue chip).',
        KAM,
      ),
      existingMoldRef: c(
        text('existing_mold_ref'),
        'FB-02 (F-015): the existing mold / part number (≤ 60) when modify_existing_mold.',
        KAM,
      ),
      moldChangeDescription: c(
        text('mold_change_description'),
        'FB-02 (F-015): what changes (≤ 500), e.g. "finish change 28-410 → 28-400".',
        KAM,
      ),
      // FB-02 (F-014)
      rfpLink: c(
        text('rfp_link'),
        'FB-02 (F-014): customer RFP / portal link (https only, ≤ 500).',
        KAM,
      ),
      quoteVariantsNote: c(
        text('quote_variants_note'),
        'FB-02 (F-075, D-017 option B): variants the customer wants priced (limit: intake_variants_note_max_length). No data-model branching; structured scenarios are F-056.',
        KAM,
      ),
      // FB-11 (D-032, F-080, F-063 dunnage only, F-085): commercial inputs at intake. All optional.
      // The customer-funding answer is the existing tooling_funding_model column (the Commercial panel edits it too).
      requestedPaymentTerms: c(
        text('requested_payment_terms'),
        'FB-11 (F-080): value_list requested_payment_terms code the customer asks for. Non-standard when not in app_setting standard_payment_terms (derived, not stored). FB-08 reconciles it with the terms record.',
        KAM,
      ),
      requestedPaymentTermsOther: c(
        text('requested_payment_terms_other'),
        'FB-11 (F-080): short description (≤ 120) when requested_payment_terms is Other; null otherwise.',
        KAM,
      ),
      returnableDunnage: c(
        boolean('returnable_dunnage').notNull().default(false),
        'FB-11 (F-063, A-033): the customer wants returnable (multi-trip) dunnage; false = single-trip. Safety stock and stocking programs are not captured (not confirmed).',
        KAM,
      ),
      priceBasis: c(
        text('price_basis'),
        'FB-11 (F-080): value_list price_basis code (FOB Pretium plant / Delivered).',
        KAM,
      ),
      freightType: c(
        text('freight_type'),
        'FB-11 (F-080): value_list freight_type code (flatbed, van, drop trailer, T-bar, other) when the price basis is delivered; cleared otherwise.',
        KAM,
      ),
      freightSpecialArrangements: c(
        text('freight_special_arrangements'),
        'FB-11 (F-080): special freight arrangements (≤ 200), e.g. a drop trailer or T-bars; cleared when the price basis is not delivered.',
        KAM,
      ),
      bidReference: c(
        text('bid_reference'),
        'FB-11 (F-085): optional bid / program reference (≤ 60). A plain reference: it does not link quotes or relax one active quote per opportunity (F-084 is P1).',
        KAM,
      ),
      guardrailWarning: c(
        text('guardrail_warning'),
        'FB-10 (F-066): the platform-minimum warning shown to the KAM at the last submit ("Below the platform minimum for …"), kept for G1. Null when none. A warning only: it never blocked the submit.',
        KAM,
      ),
      packagingType: c(text('packaging_type'), 'value_list packaging_type code.', KAM),
      packagingNotes: c(text('packaging_notes'), 'Packaging requirements.', KAM),
      requestClass: c(text('request_class'), 'value_list request_class code.', KAM),
      commentsForEngineering: c(
        text('comments_for_engineering'),
        'Notes from the KAM to Engineering.',
        KAM,
      ),
      submittedAt: c(
        timestamptz('submitted_at'),
        'When the KAM submitted the intake (the quote was created).',
        SYSTEM,
      ),
      // Ship-to
      shipTo: c(
        jsonb('ship_to'),
        'Ship / fill destination used for the quote {line1, city, state, postal, country}; city and state required at intake (FB-02, F-017).',
        KAM,
      ),
      shipToOverridden: c(
        boolean('ship_to_overridden').notNull().default(false),
        'True when it differs from the customer default.',
        KAM,
      ),
      shipToOriginal: c(
        jsonb('ship_to_original'),
        'The customer default ship-to the intake was pre-filled with (kept when overridden).',
        KAM,
      ),
      shipToOverrideReason: c(
        text('ship_to_override_reason'),
        'Why the ship-to differs: the justification of the applied ship_to override (the override row is the record).',
        KAM,
      ),
      // Priority
      priorityScore: c(
        numeric('priority_score', { precision: 5, scale: 2, mode: 'number' }),
        'Advisory priority score 0–100.',
        SYSTEM,
      ),
      priorityTier: c(
        text('priority_tier'),
        'Critical | High | Standard | Low (scoring_model tiers).',
        SYSTEM,
      ),
      priorityTierOverridden: c(
        boolean('priority_tier_overridden').notNull().default(false),
        'True when an approved override set the tier.',
        SYSTEM,
      ),
      scoringModelVersion: c(
        integer('scoring_model_version'),
        'scoring_model.model_version used for the score.',
        SYSTEM,
      ),
      priorityBreakdown: c(
        jsonb('priority_breakdown'),
        'The score explanation as computed: {breakdown: [{key, label, weight, raw, points, contribution, explanation, unknown, sensitive}], unknowns, computedTier}. Raw commercial inputs are stripped on read for roles without commercial access.',
        SYSTEM,
      ),
      priorityScoredAt: c(
        timestamptz('priority_scored_at'),
        'When the score was last computed (submit, an input change, or a gate decision such as the G2 capital estimate).',
        SYSTEM,
      ),
      queuePosition: c(
        integer('queue_position'),
        'Manual position in the engineering queue (DEC-26).',
        ENG,
      ),
      queuePositionOverridden: c(
        boolean('queue_position_overridden').notNull().default(false),
        'True when an applied override (EngLead pin) set the queue position.',
        ENG,
      ),
      // Engineering
      assignedEngineerId: c(
        userRef('assigned_engineer_id'),
        'Engineer assigned in Engineering Review.',
        ENG,
      ),
      assignedAt: c(
        timestamptz('assigned_at'),
        'When the current engineer was assigned (B-10 "time since assignment"); reset on reassign.',
        ENG,
      ),
      // B-26: Quoting assignment (the pricing lead triages the pricing queue)
      assignedPricerId: c(
        userRef('assigned_pricer_id'),
        'B-26: the pricer the pricing lead assigned the Quoting work to.',
        PRICING,
      ),
      pricerAssignedAt: c(
        timestamptz('pricer_assigned_at'),
        'B-26: when the current pricer was assigned; reset on reassign.',
        PRICING,
      ),
      // Lead review (2026-10-30): the assigned engineer submits their part to the lead; the lead may send
      // it back. The latest round only (the timeline and audit keep every one); cleared on a new stay
      // in the stage and on reassignment.
      engSubmittedAt: c(
        timestamptz('eng_submitted_at'),
        'Lead review: when the engineer submitted their part to the lead (null: not waiting on the lead).',
        ENG,
      ),
      engSubmittedBy: c(userRef('eng_submitted_by'), 'Lead review: who submitted it.', ENG),
      engReturnedAt: c(
        timestamptz('eng_returned_at'),
        'Lead review: when the lead last sent it back to the engineer.',
        ENG,
      ),
      engReturnedBy: c(userRef('eng_returned_by'), 'Lead review: the lead who sent it back.', ENG),
      engReturnNote: c(
        text('eng_return_note'),
        'Lead review: what the lead asked the engineer to change.',
        ENG,
      ),
      // Lead review (2026-10-30): the assigned pricer submits their part to the lead; the lead may send
      // it back. The latest round only (the timeline and audit keep every one); cleared on a new stay
      // in the stage and on reassignment.
      pricingSubmittedAt: c(
        timestamptz('pricing_submitted_at'),
        'Lead review: when the pricer submitted their part to the lead (null: not waiting on the lead).',
        PRICING,
      ),
      pricingSubmittedBy: c(
        userRef('pricing_submitted_by'),
        'Lead review: who submitted it.',
        PRICING,
      ),
      pricingReturnedAt: c(
        timestamptz('pricing_returned_at'),
        'Lead review: when the lead last sent it back to the pricer.',
        PRICING,
      ),
      pricingReturnedBy: c(
        userRef('pricing_returned_by'),
        'Lead review: the lead who sent it back.',
        PRICING,
      ),
      pricingReturnNote: c(
        text('pricing_return_note'),
        'Lead review: what the lead asked the pricer to change.',
        PRICING,
      ),
      // FB-01 (F-030): where a rework came from and where the KAM's resubmission resumes.
      reworkOriginStageKey: c(
        text('rework_origin_stage_key'),
        'FB-01 (F-030): the stage a gate decision sent the quote back to the KAM from (e.g. QUOTING for G3 "Rework (back to KAM)"). Set on rework, cleared on resubmit.',
        SYSTEM,
      ),
      reworkResumeAt: c(
        text('rework_resume_at'),
        "FB-01 (F-030): origin | intake, from the outcome's resume_at. origin: the KAM's resubmission goes straight back to the origin stage unless they say the scope changed. Cleared on resubmit.",
        SYSTEM,
      ),
      // B-26: capital awareness (deck slide 9, "Aware")
      capitalLikely: c(
        boolean('capital_likely').notNull().default(false),
        'B-26: significant capital is likely (set at Stage 1 by Sales or upfront Engineering, or by the capital_likely_notice threshold). When set, G3 needs capital readiness confirmed.',
        KAM,
      ),
      capitalLikelySetBy: c(
        userRef('capital_likely_set_by'),
        'B-26: who last set or cleared capital_likely (null when set by the threshold).',
        KAM,
      ),
      capitalLikelySetAt: c(
        timestamptz('capital_likely_set_at'),
        'B-26: when capital_likely last changed.',
        KAM,
      ),
      capitalNoticeSentAt: c(
        timestamptz('capital_notice_sent_at'),
        'B-26: when Capital Management was given early notice (awareness, not approval). Once per quote.',
        SYSTEM,
      ),
      marketDevNoticeSentAt: c(
        timestamptz('market_dev_notice_sent_at'),
        'B-26: when Market Development was told the quote is above the value threshold. Once per quote.',
        SYSTEM,
      ),
      // B-26: commercial terms (deck slides 12-13)
      toolingFundingModel: c(
        text('tooling_funding_model'),
        'B-26: value_list tooling_funding_model code (company-funded, customer-funded, $0 CER, amortized).',
        KAM,
      ),
      termsToolingCommitment: c(
        boolean('terms_tooling_commitment'),
        'B-26: the offer carries a tooling commitment (a Legal review trigger).',
        KAM,
      ),
      termsMoq: c(text('terms_moq'), 'B-26: minimum order quantity terms.', KAM),
      termsPaymentTerms: c(text('terms_payment_terms'), 'B-26: payment terms.', KAM),
      termsNonstandard: c(
        boolean('terms_nonstandard').notNull().default(false),
        'B-26: the terms are nonstandard (a Legal review trigger).',
        KAM,
      ),
      termsNotes: c(text('terms_notes'), 'B-26: notes on the terms check.', KAM),
      termsCheckedAt: c(
        timestamptz('terms_checked_at'),
        'B-26: when the terms check was recorded (G4 Advance needs it). Cleared when the terms change.',
        KAM,
      ),
      termsCheckedBy: c(userRef('terms_checked_by'), 'B-26: who recorded the terms check.', KAM),
      legalReviewedOn: c(
        date('legal_reviewed_on', { mode: 'string' }),
        'B-26: the date Legal reviewed the offer (needed at G4 when a legal_review_triggers trigger applies).',
        KAM,
      ),
      legalReviewerName: c(
        text('legal_reviewer_name'),
        'B-26: who in Legal reviewed it (Legal is not a CCQ role).',
        KAM,
      ),
      legalReviewNote: c(text('legal_review_note'), 'B-26: Legal review notes.', KAM),
      legalRecordedBy: c(
        userRef('legal_recorded_by'),
        'B-26: the CCQ user who recorded the Legal review.',
        KAM,
      ),
      // FB-08 (F-021, D-029, D-003 provisional): payment terms as a list, the tooling payment milestones.
      termsPaymentTermsCode: c(
        text('terms_payment_terms_code'),
        'FB-08 (F-021): value_list requested_payment_terms code of the agreed payment terms. Not in app_setting standard_payment_terms = non-standard (sets terms_nonstandard and opens a terms_exception_request). terms_payment_terms holds the detail for "Other" (and legacy free text from before FB-08).',
        KAM,
      ),
      termsToolingPayment: c(
        text('terms_tooling_payment'),
        'FB-08 (D-029): value_list tooling_payment_terms code: upfront, 50/50 (at the order and at qualification) or amortized into the per-piece price. No quarterly.',
        KAM,
      ),
      termsMilestoneNote: c(
        text('terms_milestone_note'),
        'FB-08 (D-029): short milestone note (≤ 300).',
        KAM,
      ),
      termsExceptionStatus: c(
        text('terms_exception_status'),
        'FB-08 (T-007): the current payment-terms exception request: pending | approved | rejected; null when the terms are standard. Pending or rejected blocks G4 Advance when g4_required_checks names terms_exception.',
        SYSTEM,
      ),
      // FB-08 (F-068, V-054): the capital terms the approver confirms at Final Review.
      termsMoldOwnership: c(
        text('terms_mold_ownership'),
        'FB-08 (F-068): value_list mold_ownership code (Pretium, customer, shared).',
        KAM,
      ),
      termsAmortized: c(
        boolean('terms_amortized'),
        'FB-08 (F-068): the capital is amortized (yes / no; null = not answered).',
        KAM,
      ),
      termsAmortizationMonths: c(
        integer('terms_amortization_months'),
        'FB-08 (F-068): amortization period in months (1–120) when terms_amortized.',
        KAM,
      ),
      termsMinSupply: c(
        text('terms_min_supply'),
        'FB-08 (F-068): minimum supply / shortfall terms (≤ 300).',
        KAM,
      ),
      termsAgreementInPlace: c(
        boolean('terms_agreement_in_place'),
        'FB-08 (F-068): a supply agreement is in place (yes / no; null = not answered).',
        KAM,
      ),
      termsAgreementMonths: c(
        integer('terms_agreement_months'),
        'FB-08 (F-068): agreement duration in months (1–240) when terms_agreement_in_place.',
        KAM,
      ),
      termsFinalizedAt: c(
        timestamptz('terms_finalized_at'),
        'FB-08 (F-068, T-031): when the approver confirmed the capital terms (terms.finalize). Cleared when a capital term changes; G4 Advance needs it when g4_required_checks names terms_finalized. Locked with the terms after G4 Approve.',
        SYSTEM,
      ),
      termsFinalizedBy: c(
        userRef('terms_finalized_by'),
        'FB-08 (F-068): the approver who confirmed the capital terms.',
        SYSTEM,
      ),
      // Links and dates
      erfNumber: c(
        text('erf_number'),
        'B-26: legacy ERF number, a transition-only field for requests that started in the ERF application. ERFs are being retired; nothing new is created there.',
        PRICING,
      ),
      cerId: c(text('cer_id'), 'Capital expenditure request id (Apex).', PRICING),
      bprId: c(
        text('bpr_id'),
        'Deprecated (B-26): BPR is outside CCQ. Kept for history; no longer written.',
        PRICING,
      ),
      proposalIssuedAt: c(
        timestamptz('proposal_issued_at'),
        'When the proposal went to the customer.',
        KAM,
      ),
      validityUntil: c(
        date('validity_until', { mode: 'string' }),
        'Proposal validity date (default from validity_days_default).',
        KAM,
      ),
      reviewDate: c(
        date('review_date', { mode: 'string' }),
        'Date to revisit a quote on customer hold.',
        KAM,
      ),
      holdOwnerId: c(
        userRef('hold_owner_id'),
        'B-26: who owns the current hold (deck slide 16: reason, owner and review date).',
        SYSTEM,
      ),
      validityExpiredFlaggedAt: c(
        timestamptz('validity_expired_flagged_at'),
        'B-13: when the daily expiry job flagged that validity_until had passed (the KAM is told to revalidate or record the outcome; nothing auto-closes, D-12). Cleared when a new validity date is set.',
        SYSTEM,
      ),
      // Close-out
      outcome: c(
        text('outcome'),
        'Closure type (transition_rule.close_as): awarded | lost | expired (customer outcomes, G5) | declined | redirected (internal no-go).',
        KAM,
      ),
      outcomeReasonCode: c(
        text('outcome_reason_code'),
        'reason_code.code for the closure (for awarded: the acceptance evidence). Mandatory to close (CR-39).',
        KAM,
      ),
      closureOwnerId: c(
        userRef('closure_owner_id'),
        'Who owns the closure (CR-39): the KAM for a customer outcome unless a SalesLeader names someone else; the decider for an internal no-go. Mandatory to close.',
        KAM,
      ),
      closedAt: c(timestamptz('closed_at'), 'When the quote closed.', SYSTEM),
      // Salesforce status (set by the SF sync; nothing is deleted)
      sfStatusFlag: c(
        text('sf_status_flag'),
        'closed_won | closed_lost | deleted when the linked SF opportunity was closed or deleted in SF; null while open.',
        SYSTEM,
      ),
      sfStatusFlaggedAt: c(
        timestamptz('sf_status_flagged_at'),
        'When the SF sync set sf_status_flag.',
        SYSTEM,
      ),
    },
    (t) => [
      check('quote_status_check', inList(t.status, QUOTE_STATUSES)),
      check('quote_quote_number_format_check', sql`${t.quoteNumber} ~ '^CCQ-[0-9]{4}-[0-9]{5}$'`),
      check('quote_version_check', sql`${t.version} >= 1`),
      check('quote_priority_score_check', sql`${t.priorityScore} between 0 and 100`),
      check(
        'quote_dimensions_positive_check',
        sql`(${t.heightMm} is null or ${t.heightMm} > 0) and (${t.widthOrDiameterMm} is null or ${t.widthOrDiameterMm} > 0) and (${t.depthMm} is null or ${t.depthMm} > 0) and (${t.gramWeightG} is null or ${t.gramWeightG} > 0)`,
      ),
      check('quote_rfp_link_https_check', sql`${t.rfpLink} is null or ${t.rfpLink} ~* '^https://'`),
      check(
        'quote_terms_exception_status_check',
        sql`${t.termsExceptionStatus} is null or ${inList(t.termsExceptionStatus, QUOTE_TERMS_EXCEPTION_STATUSES)}`,
      ),
      check(
        'quote_terms_months_check',
        sql`(${t.termsAmortizationMonths} is null or (${t.termsAmortized} and ${t.termsAmortizationMonths} between 1 and 120)) and (${t.termsAgreementMonths} is null or (${t.termsAgreementInPlace} and ${t.termsAgreementMonths} between 1 and 240))`,
      ),
      check(
        'quote_terms_finalized_consistency_check',
        sql`(${t.termsFinalizedAt} is null) = (${t.termsFinalizedBy} is null)`,
      ),
      check(
        'quote_decoration_print_colors_check',
        sql`${t.decorationPrintColors} is null or ${t.decorationPrintColors} between 1 and 12`,
      ),
      // FB-02 (F-009): the product is needed on or after the quote. The domain checks it first.
      check(
        'quote_need_by_order_check',
        sql`${t.productNeededBy} is null or ${t.quoteNeededBy} is null or ${t.productNeededBy} >= ${t.quoteNeededBy}`,
      ),
      check(
        'quote_closed_consistency_check',
        sql`(${t.status} = 'closed') = (${t.closedAt} is not null)`,
      ),
      // B-13 (CR-39): the closure rule, repeated in the database. The domain enforces it first.
      check(
        'quote_closure_complete_check',
        sql`${t.status} <> 'closed' or (${t.outcome} is not null and ${t.outcomeReasonCode} is not null and ${t.closureOwnerId} is not null)`,
      ),
      check(
        'quote_sf_status_flag_check',
        sql`${t.sfStatusFlag} is null or ${inList(t.sfStatusFlag, SF_STATUS_FLAGS)}`,
      ),
      check(
        'quote_rework_resume_at_check',
        sql`${t.reworkResumeAt} is null or ${inList(t.reworkResumeAt, RESUME_AT)}`,
      ),
      index('quote_stage_priority_idx').on(t.stageKey, t.priorityScore.desc()),
      index('quote_kam_user_id_idx').on(t.kamUserId),
      index('quote_sf_opportunity_id_idx').on(t.sfOpportunityId),
      // One active CCQ quote per SF opportunity (B-07). Closed quotes don't count, so a re-quote
      // after Lost/Expired is a new quote on the same opportunity.
      uniqueIndex('quote_one_active_per_opportunity_uidx')
        .on(t.sfOpportunityId)
        .where(sql`${t.status} <> 'closed'`),
      index('quote_assigned_engineer_id_idx').on(t.assignedEngineerId),
      index('quote_region_idx').on(t.region),
      // B-14 pipeline views: search by quote number / description, and the default "last updated" sort.
      index('quote_quote_number_trgm_idx').using('gin', t.quoteNumber.op('gin_trgm_ops')),
      index('quote_description_trgm_idx').using('gin', t.description.op('gin_trgm_ops')),
      index('quote_updated_at_idx').on(t.updatedAt.desc()),
    ],
  ),
  { area: 'workflow', owner: SYSTEM, description: 'The CCQ quote: the workflow record CCQ owns.' },
);

export const quoteDraft = documented(
  pgTable(
    'quote_draft',
    {
      ...baseColumns(),
      ownerUserId: c(
        uuid('owner_user_id')
          .notNull()
          .references(() => appUser.id, { onDelete: 'restrict' }),
        'The KAM writing the intake. Only they (and Admin) can see the draft.',
        KAM,
      ),
      sfOpportunityId: c(
        text('sf_opportunity_id'),
        'SF opportunity picked in step 1 (no FK: it may come from a live SF search).',
        KAM,
      ),
      step: c(integer('step').notNull().default(1), 'Wizard step to resume at (1–4).', KAM),
      data: c(
        jsonb('data').notNull().default({}),
        'Intake fields as entered (contracts IntakeDraftData). Autosaved every 5 s.',
        KAM,
      ),
      submittedQuoteId: c(
        uuid('submitted_quote_id').references(() => quote.id, { onDelete: 'restrict' }),
        'Quote created from this draft; set on submit, after which the draft is read-only.',
        SYSTEM,
      ),
      submittedAt: c(timestamptz('submitted_at'), 'When the draft was submitted.', SYSTEM),
      reworkOfQuoteId: c(
        uuid('rework_of_quote_id').references(() => quote.id, { onDelete: 'restrict' }),
        'Set when the draft reworks a quote returned to the KAM (G1/G2 Rework, B-08): submit updates that quote instead of creating one.',
        SYSTEM,
      ),
    },
    (t) => [
      index('quote_draft_owner_idx').on(t.ownerUserId, t.updatedAt),
      uniqueIndex('quote_draft_one_open_rework_uidx')
        .on(t.reworkOfQuoteId)
        .where(sql`${t.reworkOfQuoteId} is not null and ${t.submittedQuoteId} is null`),
      check('quote_draft_step_check', sql`${t.step} between 1 and 4`),
      check(
        'quote_draft_submitted_consistency_check',
        sql`(${t.submittedQuoteId} is null) = (${t.submittedAt} is null)`,
      ),
    ],
  ),
  {
    area: 'workflow',
    owner: KAM,
    description:
      'Intake drafts (B-07). Visible to the creator and Admin only; becomes a quote on submit.',
  },
);

export const quoteNumberCounter = documented(
  pgTable(
    'quote_number_counter',
    {
      ...baseColumns(),
      year: c(integer('year').notNull().unique(), 'Calendar year (US Central) of the counter.'),
      lastValue: c(
        integer('last_value').notNull().default(0),
        'Last sequence number issued for the year.',
      ),
    },
    (t) => [
      check('quote_number_counter_last_value_check', sql`${t.lastValue} between 0 and 99999`),
    ],
  ),
  {
    area: 'workflow',
    owner: SYSTEM,
    description: 'Per-year counter behind next_quote_number(). Not accessed directly by the app.',
  },
);

export const stageHistory = documented(
  pgTable(
    'stage_history',
    {
      ...baseColumns(),
      quoteId: c(quoteRef(), 'Quote.'),
      stageKey: c(text('stage_key').notNull(), 'Stage entered.'),
      quoteVersion: c(
        integer('quote_version').notNull().default(1),
        'Quote version while in the stage.',
      ),
      enteredAt: c(timestamptz('entered_at').notNull(), 'When the quote entered the stage.'),
      exitedAt: c(timestamptz('exited_at'), 'When it left; null while still in the stage.'),
      enteredBy: c(userRef('entered_by'), 'Who moved the quote into the stage.'),
      onHoldMs: c(
        bigint('on_hold_ms', { mode: 'number' }).notNull().default(0),
        'Time on hold during this stay, excluded from cycle time (CR-57).',
      ),
    },
    (t) => [
      index('stage_history_quote_entered_idx').on(t.quoteId, t.enteredAt),
      // B-14: the open stay ("time in stage", the aged-over filter and sort).
      index('stage_history_open_stay_idx')
        .on(t.quoteId, t.enteredAt)
        .where(sql`${t.exitedAt} is null`),
      check(
        'stage_history_exit_after_enter_check',
        sql`${t.exitedAt} is null or ${t.exitedAt} >= ${t.enteredAt}`,
      ),
    ],
  ),
  {
    area: 'workflow',
    owner: SYSTEM,
    description: 'One row per stay in a stage. Powers time-in-stage (CR-55).',
  },
);

export const quoteHold = documented(
  pgTable(
    'quote_hold',
    {
      ...baseColumns(),
      quoteId: c(quoteRef(), 'Quote.'),
      stageKey: c(text('stage_key').notNull(), 'Stage the quote was in when held.'),
      startedAt: c(timestamptz('started_at').notNull(), 'Hold start.'),
      endedAt: c(timestamptz('ended_at'), 'Hold end; null while on hold.'),
      reasonCode: c(text('reason_code'), 'reason_code (context hold).', KAM),
      ownerId: c(userRef('owner_id'), 'B-26: who owns the hold (follows up by the review date).'),
    },
    (t) => [
      index('quote_hold_quote_idx').on(t.quoteId, t.startedAt),
      check(
        'quote_hold_end_after_start_check',
        sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`,
      ),
    ],
  ),
  {
    area: 'workflow',
    owner: SYSTEM,
    description: 'Hold intervals, tracked separately so cycle time can exclude holds (CR-57).',
  },
);

export const gateDecision = documented(
  pgTable(
    'gate_decision',
    {
      ...baseColumns(),
      quoteId: c(quoteRef(), 'Quote.'),
      gateKey: c(text('gate_key').notNull(), 'Gate decided.'),
      outcomeKey: c(text('outcome_key').notNull(), 'Outcome chosen.'),
      decidedBy: c(userRef('decided_by').notNull(), 'Decider.'),
      decidedAt: c(timestamptz('decided_at').notNull(), 'Decision time.'),
      note: c(text('note'), 'Decider note.'),
      reasonCode: c(text('reason_code'), 'reason_code.code, when given.'),
      targetStageKey: c(text('target_stage_key'), 'Stage the quote moved to; null when it stayed.'),
      quoteVersion: c(
        integer('quote_version').notNull(),
        'Quote version the decision was taken against.',
      ),
      evidence: c(
        jsonb('evidence').notNull().default({}),
        'Snapshot of the fields the rules checked.',
      ),
      conditions: c(
        text('conditions'),
        'Conditions attached to the decision (e.g. proceed with risk).',
      ),
      payload: c(jsonb('payload'), 'Values supplied with the decision (e.g. review_date).'),
    },
    (t) => [index('gate_decision_quote_idx').on(t.quoteId, t.decidedAt)],
  ),
  {
    area: 'workflow',
    owner: 'Gate decider',
    description: 'Immutable record of each gate decision.',
  },
);

export const engReview = documented(
  pgTable(
    'eng_review',
    {
      ...baseColumns(),
      quoteId: c(
        uuid('quote_id')
          .notNull()
          .unique()
          .references(() => quote.id, { onDelete: 'restrict' }),
        'Quote (one review per quote).',
      ),
      acceptedAt: c(timestamptz('accepted_at'), 'When Engineering accepted the request.'),
      acceptedBy: c(userRef('accepted_by'), 'Who accepted it (EngLead or the assigned engineer).'),
      returnedReason: c(text('returned_reason'), 'Why Engineering returned the request.'),
      processType: c(text('process_type'), 'value_list process_type code.'),
      machineType: c(text('machine_type'), 'value_list machine_type code.'),
      plantCode: c(
        text('plant_code'),
        'value_list plant code. Decided by Engineering + Ops + Supply Chain, never the KAM (DF-10).',
      ),
      cavitation: c(integer('cavitation'), 'Mould cavitation: a whole number, 1 to 99 (FB-03).'),
      cycleTimeS: c(
        numeric('cycle_time_s', { precision: 8, scale: 2, mode: 'number' }),
        'Cycle time (seconds).',
      ),
      toolingNotes: c(text('tooling_notes'), 'Tooling notes (mold, hot runner).'),
      prelimCapitalUsd: c(
        money('prelim_capital_usd'),
        'Budgetary capital estimate (USD): preliminary, includes contingency; refined after award, before any CER (FB-03, F-064).' +
          COMMERCIAL,
      ),
      downstreamEquipmentNotes: c(
        text('downstream_equipment_notes'),
        'Deprecated (FB-06, F-058): replaced by the equipment BOM upload (attachment kind equipment_bom). Kept for history and Fabric; no longer written. Shown read-only as "Legacy notes". Downstream equipment: air, water, electric, inspection / leak detection (DF-37).',
      ),
      technicalConceptNotes: c(
        text('technical_concept_notes'),
        'Technical concept: how Engineering proposes to make it.',
      ),
      // B-26 (deck slide 11): joint validation inputs and the capacity owner's sign-off
      equipmentBomNotes: c(
        text('equipment_bom_notes'),
        'Deprecated (FB-06, F-058): replaced by the equipment BOM upload (attachment kind equipment_bom). Kept for history and Fabric; no longer written. Shown read-only as "Legacy notes". B-26: Operations Engineering equipment BOM (air, water, electrical, inspection / leak detection).',
      ),
      supplyChainNotes: c(
        text('supply_chain_notes'),
        'B-26: Supply Chain network and freight view.',
      ),
      capacitySignoffStatus: c(
        text('capacity_signoff_status'),
        'B-26: approved | blocked. The capacity owner signs off at G2 and can block (G2 Advance needs approved).',
      ),
      capacitySignoffBy: c(userRef('capacity_signoff_by'), 'B-26: who signed off capacity.'),
      capacitySignoffAt: c(
        timestamptz('capacity_signoff_at'),
        'B-26: when capacity was signed off.',
      ),
      capacitySignoffNote: c(
        text('capacity_signoff_note'),
        "B-26: the capacity owner's note (required to block).",
      ),
      // FB-06 (F-024, D-007 open, provisional): the two-step (preform) process. The four details are
      // cleared when the box is unticked.
      twoStep: c(
        boolean('two_step').notNull().default(false),
        'FB-06 (F-024): the part is made in two steps (a preform, then blown). Pricing reads it (T-008).',
      ),
      preformPlantCode: c(
        text('preform_plant_code'),
        'FB-06 (F-024): value_list plant code where the preform is made. Only when two_step.',
      ),
      blowPlantCode: c(
        text('blow_plant_code'),
        'FB-06 (F-024): value_list plant code where the preform is blown. Only when two_step.',
      ),
      preformNumber: c(
        text('preform_number'),
        'FB-06 (F-024): the preform number, up to 40 characters. Only when two_step.',
      ),
      twoStepFreightNote: c(
        text('two_step_freight_note'),
        'FB-06 (F-024): freight between the preform and blow plants, up to 300 characters. Only when two_step.',
      ),
      // FB-06 (F-025, A-014 not yet confirmed by Engineering, provisional): pack-out quantities.
      unitsPerBag: c(
        integer('units_per_bag'),
        'FB-06 (F-025): units per bag (whole number, optional). Entered by Engineering, shown to Pricing.',
      ),
      unitsPerTray: c(
        integer('units_per_tray'),
        'FB-06 (F-025): units per tray (whole number, optional).',
      ),
      unitsPerCase: c(
        integer('units_per_case'),
        'FB-06 (F-025): units per case (whole number, optional).',
      ),
      unitsPerPallet: c(
        integer('units_per_pallet'),
        'FB-06 (F-025): units per pallet (whole number, optional).',
      ),
    },
    (t) => [
      check(
        'eng_review_pack_out_check',
        sql`(${t.unitsPerBag} is null or ${t.unitsPerBag} between 1 and 9999999) and (${t.unitsPerTray} is null or ${t.unitsPerTray} between 1 and 9999999) and (${t.unitsPerCase} is null or ${t.unitsPerCase} between 1 and 9999999) and (${t.unitsPerPallet} is null or ${t.unitsPerPallet} between 1 and 9999999)`,
      ),
      // FB-03 (F-057): whole numbers 1-99. Added NOT VALID in migration 0027 so existing rows over 99
      // are not rejected (new writes are still checked).
      check('eng_review_cavitation_check', sql`${t.cavitation} between 1 and 99`),
      check(
        'eng_review_capacity_signoff_status_check',
        sql`${t.capacitySignoffStatus} is null or ${inList(t.capacitySignoffStatus, CAPACITY_SIGNOFF_STATUSES)}`,
      ),
    ],
  ),
  { area: 'workflow', owner: ENG, description: 'Engineering Review fields (stage 2).' },
);

export const capacityEvidence = documented(
  pgTable(
    'capacity_evidence',
    {
      ...baseColumns(),
      quoteId: c(quoteRef(), 'Quote.'),
      site: c(text('site').notNull(), 'Plant / site code.'),
      lineAsset: c(text('line_asset'), 'Line or machine asset.'),
      assumedEffectivenessPct: c(
        numeric('assumed_effectiveness_pct', { precision: 5, scale: 2, mode: 'number' }).notNull(),
        'Assumed effectiveness (OEE) %. Always entered, no default (D-08).' + COMMERCIAL,
      ),
      cycleTimeS: c(
        numeric('cycle_time_s', { precision: 8, scale: 2, mode: 'number' }).notNull(),
        'Cycle time (s).' + COMMERCIAL,
      ),
      utilizationPct: c(
        numeric('utilization_pct', { precision: 5, scale: 2, mode: 'number' }),
        'Deprecated (FB-03): replaced by utilization_before_pct. Kept for history and Fabric; no longer written.' +
          COMMERCIAL,
      ),
      bufferPct: c(
        numeric('buffer_pct', { precision: 5, scale: 2, mode: 'number' }),
        'Deprecated (FB-03, F-059): "buffer" was defined three ways by Engineering. Kept for history and Fabric; no longer written.' +
          COMMERCIAL,
      ),
      utilizationBeforePct: c(
        numeric('utilization_before_pct', { precision: 7, scale: 2, mode: 'number' }).notNull(),
        "Utilization before the new business, %: the line's current load, entered (0-100). Replaces utilization_pct (FB-03, F-059)." +
          COMMERCIAL,
      ),
      allocatedAnnualVolume: c(
        bigint('allocated_annual_volume', { mode: 'number' }),
        "Annual volume (units) of this quote allocated to this line. Defaults to the quote's estimated annual volume; the engineer sets each row's share when the business is split across lines or plants (FB-03, T-030).",
      ),
      scheduledRunDaysPerYear: c(
        integer('scheduled_run_days_per_year'),
        'Scheduled run days per year for this line. Defaults from app_setting capacity_basis (provisional, D-021).',
      ),
      utilizationAfterPct: c(
        numeric('utilization_after_pct', { precision: 7, scale: 2, mode: 'number' }),
        'Utilization after the new business, %. CALCULATED by the server (domain capacity.ts) from cavitation, cycle time, effectiveness, run days and allocated volume; stored for reporting, never typed. Null until every input is present (FB-03).' +
          COMMERCIAL,
      ),
      analysisDate: c(date('analysis_date', { mode: 'string' }).notNull(), 'Date of the analysis.'),
      analystId: c(userRef('analyst_id').notNull(), 'Analyst who did it.'),
      notes: c(text('notes'), 'Assumptions and notes.'),
    },
    (t) => [
      index('capacity_evidence_quote_idx').on(t.quoteId),
      check(
        'capacity_evidence_pct_check',
        sql`${t.assumedEffectivenessPct} between 0 and 100 and (${t.utilizationPct} is null or ${t.utilizationPct} between 0 and 100) and (${t.bufferPct} is null or ${t.bufferPct} between 0 and 100)`,
      ),
      check(
        'capacity_evidence_utilization_check',
        sql`${t.utilizationBeforePct} between 0 and 100 and (${t.allocatedAnnualVolume} is null or ${t.allocatedAnnualVolume} >= 0) and (${t.scheduledRunDaysPerYear} is null or ${t.scheduledRunDaysPerYear} between 1 and 366) and (${t.utilizationAfterPct} is null or ${t.utilizationAfterPct} >= 0)`,
      ),
    ],
  ),
  {
    area: 'workflow',
    owner: ENG,
    description: 'Capacity evidence with stated assumptions (CR-19).',
  },
);

export const pricingRecord = documented(
  pgTable(
    'pricing_record',
    {
      ...baseColumns(),
      quoteId: c(quoteRef(), 'Quote.'),
      quoteVersion: c(
        integer('quote_version').notNull(),
        'Quote version the record belongs to. A Rework / Return bumps the version and starts a new record; prior versions are kept as history (CR-38).',
      ),
      priceApprovedBy: c(userRef('price_approved_by'), 'Pricing approver.' + COMMERCIAL),
      priceApprovedAt: c(timestamptz('price_approved_at'), 'Price approval time.' + COMMERCIAL),
      pricingBasisNote: c(
        text('pricing_basis_note'),
        'Basis of the approved price (e.g. resin index month, FOB terms). No figures are edited in CCQ.' +
          COMMERCIAL,
      ),
      pricingRefs: c(
        jsonb('pricing_refs').notNull().default({}),
        'Pricing-app references {erf: string[], bpr: string[]}, format-checked (app_setting pricing_ref_formats).' +
          COMMERCIAL,
      ),
      noPricingAppRecordNote: c(
        text('no_pricing_app_record_note'),
        'Why there is no pricing-app record yet (stands in for a reference at G3).' + COMMERCIAL,
      ),
      approvedRangeNote: c(
        text('approved_range_note'),
        'Approved negotiation range, as a note (guardrails are D-10, open). No figures are edited in CCQ.' +
          COMMERCIAL,
      ),
      costingCompleted: c(
        boolean('costing_completed').notNull().default(false),
        'CR-25 costing-before-pricing checkpoint: attestation only (costing stays in Excel).' +
          COMMERCIAL,
      ),
      costingAttestedBy: c(userRef('costing_attested_by'), 'Who ticked "Costing completed".'),
      costingAttestedAt: c(timestamptz('costing_attested_at'), 'When it was ticked.'),
      capitalReadiness: c(
        text('capital_readiness'),
        'not_required | pending | pre_approved | not_approved.' + COMMERCIAL,
      ),
      cerReference: c(
        text('cer_reference'),
        'Capital expenditure request (CER) id, optional.' + COMMERCIAL,
      ),
      capitalNotes: c(text('capital_notes'), 'Capital notes.' + COMMERCIAL),
      capitalPendingJustification: c(
        text('capital_pending_justification'),
        'Why G3 is submitted with capital still pending (D-11 open: a warning, not a block).' +
          COMMERCIAL,
      ),
      costModelRequirement: c(
        text('cost_model_requirement').notNull().default('required'),
        'FB-07 (F-032): required | grandfathered. The costing attestation and G3 need a current cost_model attachment unless grandfathered: quotes in Quoting with costing attested and no model when FB-07 shipped (migration 0031). Every new version starts required.',
        SYSTEM,
      ),
    },
    (t) => [
      uniqueIndex('pricing_record_quote_version_uniq').on(t.quoteId, t.quoteVersion),
      check(
        'pricing_record_capital_readiness_check',
        inList(t.capitalReadiness, CAPITAL_READINESS),
      ),
      check(
        'pricing_record_cost_model_requirement_check',
        inList(t.costModelRequirement, COST_MODEL_REQUIREMENTS),
      ),
    ],
  ),
  {
    area: 'workflow',
    owner: PRICING,
    description:
      'Price approval and capital readiness record (CR-25/26), one row per quote version. Records the approval as a decision, never a price figure. Commercial.',
  },
);

export const override = documented(
  pgTable(
    'override',
    {
      ...baseColumns(),
      quoteId: c(quoteRef(), 'Quote.'),
      field: c(
        text('field').notNull(),
        'Field being overridden: priority_tier | ship_to | queue_position | …',
      ),
      originalValue: c(jsonb('original_value'), 'Value before the override.'),
      requestedValue: c(jsonb('requested_value').notNull(), 'Value requested.'),
      justification: c(text('justification').notNull(), 'Why (required).'),
      reasonCode: c(text('reason_code'), 'reason_code (context override).'),
      requestedBy: c(userRef('requested_by').notNull(), 'Requester.'),
      status: c(
        text('status').notNull().default('requested'),
        'requested | approved | rejected | applied | reverted.',
      ),
      decidedBy: c(userRef('decided_by'), 'Approver or rejecter.'),
      decidedAt: c(timestamptz('decided_at'), 'Decision time.'),
      decisionNote: c(text('decision_note'), 'Approver note.'),
      revertedBy: c(userRef('reverted_by'), 'Who reverted it.'),
      revertedAt: c(timestamptz('reverted_at'), 'When it was reverted.'),
      approvalMode: c(
        text('approval_mode').notNull().default('approver'),
        'approver (waits for a configured approver) | self (applied by the requester, logged). From overridable_fields at request time.',
      ),
      appliedAt: c(timestamptz('applied_at'), 'When the value was written to the quote.'),
    },
    (t) => [
      check('override_status_check', inList(t.status, OVERRIDE_STATUSES)),
      check('override_approval_mode_check', inList(t.approvalMode, OVERRIDE_APPROVAL_MODES)),
      check('override_justification_check', sql`length(trim(${t.justification})) > 0`),
      index('override_quote_idx').on(t.quoteId),
      index('override_status_idx').on(t.status, t.createdAt),
      uniqueIndex('override_one_open_per_field_uidx')
        .on(t.quoteId, t.field)
        .where(sql`${t.status} = 'requested'`),
    ],
  ),
  {
    area: 'workflow',
    owner: 'Override requester / approver',
    description: 'Governed overrides (F-06). Log readable by Leadership and Admin only.',
  },
);

export const attachment = documented(
  pgTable(
    'attachment',
    {
      ...baseColumns(),
      quoteId: c(
        uuid('quote_id').references(() => quote.id, { onDelete: 'restrict' }),
        'Quote. Null while the file sits on an intake draft (set on submit).',
      ),
      draftId: c(
        uuid('draft_id').references(() => quoteDraft.id, { onDelete: 'set null' }),
        'Intake draft the file was uploaded to (B-16); kept after submit for provenance. Null once a deleted draft took its (removed) files with it.',
        KAM,
      ),
      kind: c(
        text('kind').notNull(),
        'bottle_drawing | spec | sample_photo | capacity_analysis | other | bid_file | project_brief | competitor_drawing | cost_model | roi_model | price_table (capacity_analysis: FB-03; bid_file, project_brief, competitor_drawing: FB-02; cost_model, roi_model, price_table: FB-07, versioned, uploaded on the Quoting tab).',
      ),
      fileName: c(
        text('file_name').notNull(),
        'Original file name (metadata; the stored name is sanitized).',
      ),
      storedName: c(
        text('stored_name'),
        'Sanitized name in storage (after any conflict rename).',
        SYSTEM,
      ),
      size: c(bigint('size', { mode: 'number' }).notNull(), 'Size in bytes.'),
      mime: c(
        text('mime').notNull(),
        'Canonical MIME type for the verified file type (never the browser claim).',
      ),
      note: c(text('note'), 'Optional note from the uploader.'),
      sha256: c(text('sha256'), 'SHA-256 of the bytes as streamed (hex).', SYSTEM),
      storage: c(
        text('storage'),
        'sharepoint | blob | local (FILESTORE_MODE at upload). Null: metadata only, no bytes (synthetic seed).',
        SYSTEM,
      ),
      storageItemId: c(
        text('storage_item_id'),
        "The store's id for the file: Graph driveItem id, blob name or local path.",
        SYSTEM,
      ),
      storagePath: c(
        text('storage_path'),
        'Current folder path in the store (quote folder, draft folder, or the removed folder).',
        SYSTEM,
      ),
      spDriveId: c(text('sp_drive_id'), 'SharePoint drive id.', 'SharePoint'),
      spItemId: c(text('sp_item_id'), 'SharePoint item id.', 'SharePoint'),
      spWebUrl: c(text('sp_web_url'), 'SharePoint web URL.', 'SharePoint'),
      uploadedBy: c(userRef('uploaded_by').notNull(), 'Uploader.'),
      removedAt: c(
        timestamptz('removed_at'),
        'Soft delete: when the file was removed (moved to the removed folder).',
        SYSTEM,
      ),
      removedBy: c(userRef('removed_by'), 'Who removed it.', SYSTEM),
      version: c(
        integer('version'),
        'FB-07 (F-074): version number per quote and kind, from 1, for the versioned kinds (cost_model, roi_model, price_table). Null for every other kind.',
        SYSTEM,
      ),
      supersededBy: c(
        uuid('superseded_by').references((): AnyPgColumn => attachment.id, {
          onDelete: 'restrict',
        }),
        'FB-07 (F-074): the newer version that replaced this one. Null on the current version (the latest is the one with no superseded_at that is not removed). Earlier versions stay downloadable.',
        SYSTEM,
      ),
      supersededAt: c(
        timestamptz('superseded_at'),
        'FB-07 (F-074): when a newer version replaced this one.',
        SYSTEM,
      ),
    },
    (t) => [
      check('attachment_kind_check', inList(t.kind, ATTACHMENT_KINDS)),
      check(
        'attachment_version_check',
        sql`(${t.version} is null) = (${t.kind} not in (${sql.raw(
          VERSIONED_ATTACHMENT_KINDS.map((k) => `'${k}'`).join(', '),
        )})) and (${t.version} is null or ${t.version} >= 1)`,
      ),
      // A version is superseded (superseded_at) in the same transaction that inserts its successor, and
      // then names it (superseded_by): the successor can't exist first, one current version per kind.
      check(
        'attachment_superseded_consistency_check',
        sql`${t.supersededBy} is null or ${t.supersededAt} is not null`,
      ),
      // One current version per quote and kind; version numbers never repeat.
      uniqueIndex('attachment_current_version_uidx')
        .on(t.quoteId, t.kind)
        .where(
          sql`${t.version} is not null and ${t.supersededAt} is null and ${t.removedAt} is null`,
        ),
      uniqueIndex('attachment_version_uidx')
        .on(t.quoteId, t.kind, t.version)
        .where(sql`${t.version} is not null`),
      check('attachment_size_check', sql`${t.size} >= 0`),
      check('attachment_storage_check', inList(t.storage, ATTACHMENT_STORAGES)),
      check(
        'attachment_owner_check',
        sql`${t.quoteId} is not null or ${t.draftId} is not null or ${t.removedAt} is not null`,
      ),
      check(
        'attachment_removed_consistency_check',
        sql`(${t.removedAt} is null) = (${t.removedBy} is null)`,
      ),
      index('attachment_quote_idx').on(t.quoteId),
      index('attachment_draft_idx').on(t.draftId),
    ],
  ),
  {
    area: 'workflow',
    owner: 'Uploader',
    description:
      'Attachment metadata (F-13, B-16). Bytes live in SharePoint (attachment_settings.quoteFolder, /CCQ/{quote_number}/), or Blob/local by FILESTORE_MODE. Removal is soft.',
  },
);

export const comment = documented(
  pgTable(
    'comment',
    {
      ...baseColumns(),
      quoteId: c(quoteRef(), 'Quote.'),
      authorId: c(userRef('author_id').notNull(), 'Author.'),
      body: c(text('body').notNull(), 'Comment text.'),
      mentions: c(uuid('mentions').array().notNull().default([]), 'Mentioned user ids.'),
    },
    (t) => [index('comment_quote_idx').on(t.quoteId, t.createdAt)],
  ),
  { area: 'workflow', owner: 'Author', description: 'Discussion on a quote.' },
);

export const handoffRecord = documented(
  pgTable(
    'handoff_record',
    {
      ...baseColumns(),
      quoteId: c(
        uuid('quote_id')
          .notNull()
          .unique()
          .references(() => quote.id, { onDelete: 'restrict' }),
        'Quote (one hand-off per awarded quote).',
      ),
      acceptanceEvidence: c(
        text('acceptance_evidence').notNull(),
        'verbal | po | loi | contract (the G5 Awarded reason code).',
      ),
      acceptanceDate: c(
        date('acceptance_date', { mode: 'string' }),
        'B-13: when the customer accepted (from the Awarded decision).',
      ),
      acceptanceDocumentUrl: c(
        text('acceptance_document_url'),
        'B-13: optional link to the PO / LOI / contract (http(s) only).',
      ),
      receivingRole: c(
        text('receiving_role'),
        'Team receiving the hand-off: a code from app_setting handoff_receiving_roles (commercial_activation | npi_post_award_pm | other).',
      ),
      receivingRoleOther: c(
        text('receiving_role_other'),
        'B-13: the receiving team when receiving_role = other.',
      ),
      receivingContactName: c(
        text('receiving_contact_name'),
        'B-13: the person on the receiving team who takes the hand-off.',
      ),
      acceptedOn: c(
        date('accepted_on', { mode: 'string' }),
        'B-13: the date the receiving team accepted the hand-off (accepted-by date).',
      ),
      acceptedByName: c(
        text('accepted_by_name'),
        'Customer contact who accepted (business contact only). Unused by the B-13 form.',
      ),
      cerId: c(text('cer_id'), 'CER id (Apex). A reference only, no integration.'),
      cerStatus: c(
        text('cer_status').notNull().default('pending'),
        'B-26 (G6a): pending | approved | not_approved | not_required, per the official CER matrix (TBD).',
      ),
      cerApprovedOn: c(
        date('cer_approved_on', { mode: 'string' }),
        'B-26: the date the CER was approved (required when cer_status = approved).',
      ),
      bprId: c(
        text('bpr_id'),
        'Deprecated (B-26): BPR is outside CCQ. Kept for history; no longer written.',
      ),
      notes: c(text('notes'), 'Notes.'),
      completedAt: c(
        timestamptz('completed_at'),
        'B-13: when someone ticked "Hand-off complete" (B-26: "Hand-off accepted", G6b); null while open.',
      ),
      completedBy: c(userRef('completed_by'), 'B-13: who confirmed the hand-off complete.'),
      cerReadyAt: c(
        timestamptz('cer_ready_at'),
        'FB-03 (F-064): when someone ticked "Ready for CER development" (only after G5 Awarded); null while not ready.',
      ),
      cerReadyBy: c(
        userRef('cer_ready_by'),
        'FB-03 (F-064): who ticked "Ready for CER development".',
      ),
      updatedBy: c(userRef('updated_by'), 'B-13: who last edited the record.'),
    },
    (t) => [
      check(
        'handoff_record_cer_ready_consistency_check',
        sql`(${t.cerReadyAt} is null) = (${t.cerReadyBy} is null)`,
      ),
      check(
        'handoff_record_acceptance_evidence_check',
        inList(t.acceptanceEvidence, ACCEPTANCE_EVIDENCE),
      ),
      check('handoff_record_cer_status_check', inList(t.cerStatus, CER_STATUSES)),
      check(
        'handoff_record_completed_consistency_check',
        sql`(${t.completedAt} is null) = (${t.completedBy} is null)`,
      ),
    ],
  ),
  {
    area: 'workflow',
    owner: KAM,
    description:
      'Hand-off record (CR-41/42, B-13): opened by an award, completed in Commit & Hand Off (B-26 Stage 6).',
  },
);

/**
 * FB-08 (F-021, T-007, D-003 provisional): every payment-terms exception request. A non-standard
 * payment term opens one (pending) and tells the pricing lead, who approves or rejects it with a
 * rationale. A later change to the terms supersedes it (a new request) or withdraws it (back to
 * standard). `quote.terms_exception_status` mirrors the current request. Never deleted.
 */
export const termsExceptionRequest = documented(
  pgTable(
    'terms_exception_request',
    {
      ...baseColumns(),
      quoteId: c(quoteRef(), 'Quote.'),
      quoteVersion: c(integer('quote_version').notNull(), 'Quote version when it was requested.'),
      paymentTermsCode: c(
        text('payment_terms_code').notNull(),
        'value_list requested_payment_terms code that was non-standard.',
      ),
      paymentTermsDetail: c(text('payment_terms_detail'), 'The terms as described (for "Other").'),
      status: c(
        text('status').notNull().default('pending'),
        'pending | approved | rejected | withdrawn (back to standard) | superseded (the terms changed again).',
      ),
      requestedBy: c(
        userRef('requested_by').notNull(),
        'Who entered the non-standard terms (told of the decision).',
      ),
      requestedAt: c(timestamptz('requested_at').notNull(), 'When it was requested.'),
      decidedBy: c(userRef('decided_by'), 'The pricing lead (terms.exception.decide) who decided.'),
      decidedAt: c(timestamptz('decided_at'), 'When it was decided.'),
      rationale: c(text('rationale'), 'The decision rationale (required, ≤ 1000).'),
      closedAt: c(
        timestamptz('closed_at'),
        'When it was withdrawn or superseded without a decision.',
      ),
    },
    (t) => [
      index('terms_exception_request_quote_idx').on(t.quoteId, t.requestedAt),
      check('terms_exception_request_status_check', inList(t.status, TERMS_EXCEPTION_STATUSES)),
      check(
        'terms_exception_request_decision_check',
        sql`(${t.decidedAt} is null) = (${t.decidedBy} is null) and (${t.decidedAt} is null or ${t.rationale} is not null)`,
      ),
    ],
  ),
  {
    area: 'workflow',
    owner: PRICING,
    description:
      'FB-08 (T-007): payment-terms exception requests: non-standard terms need the pricing lead to approve or reject them with a rationale.',
  },
);

/**
 * FB-08 (F-082, D-002, A-035 open): extra Final Review sign-offs (app_setting g4_additional_approvals,
 * seeded off). One row per sign-off on a quote version; a rework asks again. Never deleted.
 */
export const g4Signoff = documented(
  pgTable(
    'g4_signoff',
    {
      ...baseColumns(),
      quoteId: c(quoteRef(), 'Quote.'),
      quoteVersion: c(integer('quote_version').notNull(), 'Quote version the sign-off is for.'),
      ruleKey: c(text('rule_key').notNull(), 'g4_additional_approvals rule key.'),
      signoffKey: c(text('signoff_key').notNull(), 'The sign-off within the rule.'),
      signedBy: c(userRef('signed_by').notNull(), 'Who signed off (finalReview.signoff).'),
      signedAt: c(timestamptz('signed_at').notNull(), 'When they signed off.'),
      note: c(text('note'), 'Optional note (≤ 1000).'),
    },
    (t) => [
      uniqueIndex('g4_signoff_once_uniq').on(t.quoteId, t.quoteVersion, t.ruleKey, t.signoffKey),
    ],
  ),
  {
    area: 'workflow',
    owner: KAM,
    description:
      'FB-08 (F-082): extra Final Review sign-offs (e.g. sales leader, then leadership when the customer funds capital). Off until A-035.',
  },
);
