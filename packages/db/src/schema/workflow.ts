import { sql } from 'drizzle-orm';
import {
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
  CAPITAL_READINESS,
  CUSTOMER_STATUSES,
  OVERRIDE_APPROVAL_MODES,
  OVERRIDE_STATUSES,
  QUOTE_STATUSES,
  SF_STATUS_FLAGS,
} from './enums';
import { appUser, baseColumns, timestamptz } from './identity';

const SF = 'Salesforce (read-only)';
const KAM = 'KAM';
const ENG = 'Engineering (EngLead / Engineer)';
const PRICING = 'Pricing';
const SYSTEM = 'CCQ (system)';
const COMMERCIAL = ' Commercial: stripped for roles without quote.read.commercialFields.';

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
        'Salesforce Account id; null for a not-yet-established customer.',
        SF,
      ),
      name: c(text('name').notNull(), 'Customer name.', SF),
      status: c(
        text('status').notNull(),
        'existing | not_yet_established (DEC-27: no account creation at intake).',
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
        'Not-yet-established customers: where they are (city, state / country), as typed at intake.',
        KAM,
      ),
      contact: c(
        jsonb('contact'),
        'Not-yet-established customers: business contact {name, email, phone} typed at intake.',
        KAM,
      ),
    },
    (t) => [
      check('customer_status_check', inList(t.status, CUSTOMER_STATUSES)),
      check(
        'customer_sf_account_matches_status_check',
        sql`(${t.status} = 'existing') = (${t.sfAccountId} is not null)`,
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
        'Expected close date.',
        KAM,
      ),
      drawingStatus: c(text('drawing_status'), 'value_list drawing_status code.', KAM),
      neckFinish: c(
        text('neck_finish'),
        'value_list neck_finish code, or free text when "Other".',
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
      shipTo: c(jsonb('ship_to'), 'Ship-to address used for the quote.', KAM),
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
      // Links and dates
      erfNumber: c(text('erf_number'), 'ERF number in the pricing app.', PRICING),
      cerId: c(text('cer_id'), 'Capital expenditure request id (Apex).', PRICING),
      bprId: c(text('bpr_id'), 'BPR (price implementation) id.', PRICING),
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
      cavitation: c(integer('cavitation'), 'Mould cavitation.'),
      cycleTimeS: c(
        numeric('cycle_time_s', { precision: 8, scale: 2, mode: 'number' }),
        'Cycle time (seconds).',
      ),
      toolingNotes: c(text('tooling_notes'), 'Tooling notes (mold, hot runner).'),
      prelimCapitalUsd: c(
        money('prelim_capital_usd'),
        'Preliminary capital estimate (USD).' + COMMERCIAL,
      ),
      downstreamEquipmentNotes: c(
        text('downstream_equipment_notes'),
        'Downstream equipment: air, water, electric, inspection / leak detection (DF-37).',
      ),
      technicalConceptNotes: c(
        text('technical_concept_notes'),
        'Technical concept: how Engineering proposes to make it.',
      ),
    },
    (t) => [check('eng_review_cavitation_check', sql`${t.cavitation} > 0`)],
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
        numeric('utilization_pct', { precision: 5, scale: 2, mode: 'number' }).notNull(),
        'Current utilization %.' + COMMERCIAL,
      ),
      bufferPct: c(
        numeric('buffer_pct', { precision: 5, scale: 2, mode: 'number' }),
        'Capacity buffer %.' + COMMERCIAL,
      ),
      analysisDate: c(date('analysis_date', { mode: 'string' }).notNull(), 'Date of the analysis.'),
      analystId: c(userRef('analyst_id').notNull(), 'Analyst who did it.'),
      notes: c(text('notes'), 'Assumptions and notes.'),
    },
    (t) => [
      index('capacity_evidence_quote_idx').on(t.quoteId),
      check(
        'capacity_evidence_pct_check',
        sql`${t.assumedEffectivenessPct} between 0 and 100 and ${t.utilizationPct} between 0 and 100 and (${t.bufferPct} is null or ${t.bufferPct} between 0 and 100)`,
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
    },
    (t) => [
      uniqueIndex('pricing_record_quote_version_uniq').on(t.quoteId, t.quoteVersion),
      check(
        'pricing_record_capital_readiness_check',
        inList(t.capitalReadiness, CAPITAL_READINESS),
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
      kind: c(text('kind').notNull(), 'bottle_drawing | spec | sample_photo | other.'),
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
    },
    (t) => [
      check('attachment_kind_check', inList(t.kind, ATTACHMENT_KINDS)),
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
      bprId: c(text('bpr_id'), 'BPR (price implementation) id. A reference only, no integration.'),
      notes: c(text('notes'), 'Notes.'),
      completedAt: c(
        timestamptz('completed_at'),
        'B-13: when someone ticked "Hand-off complete"; null while open.',
      ),
      completedBy: c(userRef('completed_by'), 'B-13: who confirmed the hand-off complete.'),
      updatedBy: c(userRef('updated_by'), 'B-13: who last edited the record.'),
    },
    (t) => [
      check(
        'handoff_record_acceptance_evidence_check',
        inList(t.acceptanceEvidence, ACCEPTANCE_EVIDENCE),
      ),
      check(
        'handoff_record_completed_consistency_check',
        sql`(${t.completedAt} is null) = (${t.completedBy} is null)`,
      ),
    ],
  ),
  {
    area: 'workflow',
    owner: KAM,
    description: 'Minimal Awarded hand-off record (CR-41/42, B-13).',
  },
);
