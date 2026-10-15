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
  uuid,
} from 'drizzle-orm/pg-core';

import { c, documented, inList } from './_doc';
import { stageDefinition } from './config';
import {
  ACCEPTANCE_EVIDENCE,
  ATTACHMENT_KINDS,
  CAPITAL_READINESS,
  CUSTOMER_STATUSES,
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
    },
    (t) => [
      check('customer_status_check', inList(t.status, CUSTOMER_STATUSES)),
      check(
        'customer_sf_account_matches_status_check',
        sql`(${t.status} = 'existing') = (${t.sfAccountId} is not null)`,
      ),
      index('customer_name_idx').on(t.name),
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
      // Ship-to
      shipTo: c(jsonb('ship_to'), 'Ship-to address used for the quote.', KAM),
      shipToOverridden: c(
        boolean('ship_to_overridden').notNull().default(false),
        'True when it differs from the customer default.',
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
      queuePosition: c(
        integer('queue_position'),
        'Manual position in the engineering queue (DEC-26).',
        ENG,
      ),
      // Engineering
      assignedEngineerId: c(
        userRef('assigned_engineer_id'),
        'Engineer assigned in Engineering Review.',
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
      // Close-out
      outcome: c(
        text('outcome'),
        'Closure type: awarded | lost | declined | expired | redirected | stopped.',
        KAM,
      ),
      outcomeReasonCode: c(text('outcome_reason_code'), 'reason_code.code for the closure.', KAM),
      closureOwnerId: c(userRef('closure_owner_id'), 'Who closed the quote (CR-39).', KAM),
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
      check(
        'quote_sf_status_flag_check',
        sql`${t.sfStatusFlag} is null or ${inList(t.sfStatusFlag, SF_STATUS_FLAGS)}`,
      ),
      index('quote_stage_priority_idx').on(t.stageKey, t.priorityScore.desc()),
      index('quote_kam_user_id_idx').on(t.kamUserId),
      index('quote_sf_opportunity_id_idx').on(t.sfOpportunityId),
      index('quote_assigned_engineer_id_idx').on(t.assignedEngineerId),
      index('quote_region_idx').on(t.region),
    ],
  ),
  { area: 'workflow', owner: SYSTEM, description: 'The CCQ quote: the workflow record CCQ owns.' },
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
      returnedReason: c(text('returned_reason'), 'Why Engineering returned the request.'),
      processType: c(text('process_type'), 'value_list process_type code.'),
      machineType: c(text('machine_type'), 'value_list machine_type code.'),
      plantCode: c(text('plant_code'), 'value_list plant code.'),
      cavitation: c(integer('cavitation'), 'Mould cavitation.'),
      cycleTimeS: c(
        numeric('cycle_time_s', { precision: 8, scale: 2, mode: 'number' }),
        'Cycle time (seconds).',
      ),
      toolingNotes: c(text('tooling_notes'), 'Tooling notes.'),
      prelimCapitalUsd: c(
        money('prelim_capital_usd'),
        'Preliminary capital estimate (USD).' + COMMERCIAL,
      ),
      downstreamEquipmentNotes: c(
        text('downstream_equipment_notes'),
        'Downstream equipment notes.',
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
      quoteId: c(
        uuid('quote_id')
          .notNull()
          .unique()
          .references(() => quote.id, { onDelete: 'restrict' }),
        'Quote (one pricing record per quote).',
      ),
      priceApprovedBy: c(userRef('price_approved_by'), 'Pricing approver.' + COMMERCIAL),
      priceApprovedAt: c(timestamptz('price_approved_at'), 'Price approval time.' + COMMERCIAL),
      pricingRefs: c(
        jsonb('pricing_refs').notNull().default({}),
        'ERF/BPR ids from the pricing app.' + COMMERCIAL,
      ),
      approvedRangeNote: c(
        text('approved_range_note'),
        'Note on the approved price range. No figures are edited in CCQ.' + COMMERCIAL,
      ),
      capitalReadiness: c(
        text('capital_readiness'),
        'not_required | pending | pre_approved | not_approved.' + COMMERCIAL,
      ),
      capitalNotes: c(text('capital_notes'), 'Capital notes.' + COMMERCIAL),
    },
    (t) => [
      check(
        'pricing_record_capital_readiness_check',
        inList(t.capitalReadiness, CAPITAL_READINESS),
      ),
    ],
  ),
  {
    area: 'workflow',
    owner: PRICING,
    description: 'Price approval and capital readiness record (CR-26). Commercial.',
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
    },
    (t) => [
      check('override_status_check', inList(t.status, OVERRIDE_STATUSES)),
      check('override_justification_check', sql`length(trim(${t.justification})) > 0`),
      index('override_quote_idx').on(t.quoteId),
      index('override_status_idx').on(t.status),
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
      quoteId: c(quoteRef(), 'Quote.'),
      kind: c(text('kind').notNull(), 'bottle_drawing | spec | sample_photo | other.'),
      fileName: c(text('file_name').notNull(), 'Original file name.'),
      size: c(bigint('size', { mode: 'number' }).notNull(), 'Size in bytes.'),
      mime: c(text('mime').notNull(), 'MIME type.'),
      spDriveId: c(text('sp_drive_id'), 'SharePoint drive id.', 'SharePoint'),
      spItemId: c(text('sp_item_id'), 'SharePoint item id.', 'SharePoint'),
      spWebUrl: c(text('sp_web_url'), 'SharePoint web URL.', 'SharePoint'),
      uploadedBy: c(userRef('uploaded_by').notNull(), 'Uploader.'),
    },
    (t) => [
      check('attachment_kind_check', inList(t.kind, ATTACHMENT_KINDS)),
      check('attachment_size_check', sql`${t.size} >= 0`),
      index('attachment_quote_idx').on(t.quoteId),
    ],
  ),
  {
    area: 'workflow',
    owner: 'Uploader',
    description: 'Attachment metadata. Bytes live in SharePoint (/CCQ/{quote_number}/).',
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
      acceptanceEvidence: c(text('acceptance_evidence').notNull(), 'verbal | po | loi | contract.'),
      receivingRole: c(text('receiving_role'), 'Team receiving the hand-off.'),
      acceptedByName: c(
        text('accepted_by_name'),
        'Customer contact who accepted (business contact only).',
      ),
      cerId: c(text('cer_id'), 'CER id.'),
      bprId: c(text('bpr_id'), 'BPR id.'),
      notes: c(text('notes'), 'Notes.'),
    },
    (t) => [
      check(
        'handoff_record_acceptance_evidence_check',
        inList(t.acceptanceEvidence, ACCEPTANCE_EVIDENCE),
      ),
    ],
  ),
  { area: 'workflow', owner: KAM, description: 'Minimal Awarded hand-off record (CR-41/42).' },
);
