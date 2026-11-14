import {
  CAPITAL_NOTICE_SEED,
  ESCALATION_ROUTES_SEED,
  G4_REQUIRED_CHECKS_SEED,
  G4_ADDITIONAL_APPROVALS_SEED,
  CAPITAL_TERMS_REQUIRED_SEED,
  LEGAL_REVIEW_TRIGGERS_SEED,
  MARKET_DEV_NOTICE_SEED,
  PASS_THROUGH_SEED,
  PROCESS_OWNER_SEED,
  ATTACHMENT_SETTINGS_SEED,
  CAPACITY_BASIS_SEED,
  ASSIGNMENT_RULES_SEED,
  ENG_QUEUE_SETTINGS_SEED,
  HANDOFF_RECEIVING_ROLES_SEED,
  VALIDITY_WARNING_DAYS_SEED,
  SF_OUTCOME_STAGE_NAMES_SEED,
  OVERRIDE_SETTINGS_SEED,
  PRICING_REF_FORMATS_SEED,
  SCORING_MODEL_V1_INPUT,
  SCORING_MODEL_V2_INPUT,
  COMMENT_EMAIL_COLLAPSE_MINUTES_SEED,
  ROI_REQUIRED_WHEN_SEED,
  MODEL_SUMMARY_LIMITS_SEED,
  MODEL_SUMMARY_TEMPLATES_SEED,
  MODEL_SUMMARY_VISIBLE_SEED,
  SCORING_DRAFT_V3_CHANGE_REASON,
  SCORING_MODEL_V3_INPUT,
  INTAKE_GUARDRAILS_SEED,
  VOLUME_ROUTING_SEED,
} from '@ccq/domain';

import { upsertConfig } from './_upsert';
import type { DbOrTx } from '../../src/client';
import { scoringModelRow } from '../../src/repos/config';
import { appSetting, scoringModel, sfStageMap } from '../../src/schema/index';

const present = (field: string) => ({ field, op: 'present' });

/**
 * Seed blocking set (D-05 recommended direction): SF opportunity, customer, ship/fill destination city
 * and state (FB-02, F-017), product family, resin, volume, and the two need-by dates (FB-02, F-009).
 * Existing environments get the FB-02 changes from migration 0028, FB-15's market and sub-market from 0044.
 */
export const INTAKE_REQUIRED_FIELDS = [
  present('sf_opportunity_id'),
  present('customer.name'),
  present('ship_to.city'),
  present('ship_to.state'),
  present('product_family'),
  present('resin'),
  present('est_annual_volume'),
  present('quote_needed_by'),
  present('product_needed_by'),
  // FB-15 (W13-02, D-006 owner Bailey Schmitt, 2026-11-13): Market and Sub-market are required. Provisional.
  // Every active market has sub-markets today; see `subMarketIssues` if one without is ever added.
  present('market'),
  present('sub_market'),
];

/** FB-15 (W13-10): the master-data reminder for a customer with no ERP account (provisional wording). */
export const CUSTOMER_MASTER_DATA_NOTICE =
  'This customer has no ERP account yet. Request master-data setup (help-desk ticket) as part of commercial activation.';

/** FB-02 (F-067): only CCQ is submitted here for MVP (provisional). */
export const INTAKE_ALLOWED_REQUEST_CLASSES = ['CCQ'];
export const INTAKE_REDIRECT_MESSAGE =
  'Stock, stock-plus, price inquiries and pack-out evaluations stay in the pricing application for now. Submit them there.';

/**
 * FB-02 (F-016): the minimum spec without a drawing (D-018 decided; the list is provisional).
 * TODO(A-024): Jim Zweifel / Danielle Leu may add 'layerStructure' and a container photo; add the
 * fields first, then the keys (MIN_SPEC_KEYS in the domain).
 */
export const INTAKE_MIN_SPEC_FIELDS = [
  'height',
  'widthOrDiameter',
  'depth',
  'gramWeight',
  'neck',
  'resin',
  'color',
];

/** FB-11 (F-080): the payment terms that are standard (value-list codes; A-012 decided Nov 9). */
export const STANDARD_PAYMENT_TERMS = ['NET_15', 'NET_30'];

/** FB-08 (F-021): pre-selected on the quote when the customer requested no payment terms. Provisional. */
export const DEFAULT_PAYMENT_TERMS = 'NET_30';

/** The setting descriptions FB-08 changes (migration 0038 writes the same text). */
export const G4_REQUIRED_CHECKS_DESCRIPTION =
  'FB-01 (F-069) and FB-08 (D-003 provisional): which checks block G4 Advance (release the offer). terms_checked: the Sales / Pricing terms check. legal_review: the Legal review, when a legal_review_triggers trigger applies. terms_exception: non-standard payment terms need the pricing lead to approve the exception (a pending or rejected one blocks). terms_finalized: the approver confirmed the capital terms. A check not listed shows to the approver as a warning, and the G4 decision records that they saw it. Seed: terms_exception and terms_finalized.';
export const CAPITAL_TERMS_REQUIRED_DESCRIPTION =
  'FB-08 (F-068, D-003 provisional): the capital terms the approver must fill before confirming them at Final Review: funding_model, mold_ownership, amortization (yes/no, and the months when yes), min_supply (minimum supply / shortfall terms), agreement (in place yes/no, and the duration when yes).';
export const G4_ADDITIONAL_APPROVALS_DESCRIPTION =
  'FB-08 (F-082, D-002, A-035 open): extra Final Review sign-offs before the approver may release the offer, by funding model, in order. Seeded with the Nov 9 proposal (customer-funded or $0 CER: the sales leader, then leadership) switched OFF (active: false). Set active: true only once Oleg and Sarah confirm it (A-035). Signers need finalReview.signoff (SalesLeader, Leadership).';
export const DEFAULT_PAYMENT_TERMS_DESCRIPTION =
  'FB-08 (F-021, D-003 provisional): the payment terms the Commercial panel pre-selects when the customer requested none at intake (a requested_payment_terms code; the customer request wins when there is one). Nothing is saved until someone saves the terms.';

/** "Why we ask", one line per intake field (keys are the snake_case intake field names). */
export const INTAKE_FIELD_HELP: Record<string, string> = {
  sf_opportunity_id:
    'Every CCQ quote starts from a Salesforce opportunity, so pipeline and outcomes stay linked.',
  customer:
    'The customer is the Salesforce Account on the opportunity. Tick "Not yet a Pretium customer" when it has no ERP account yet.',
  ship_to:
    'Where the product ships or is filled (city and state). Engineering uses it to choose the plant and freight.',
  ship_to_override_reason:
    'A ship-to that differs from the account default changes the quote, so we record why.',
  request_class:
    'CCQ is new business that needs engineering or capital. Stock, stock-plus, price inquiries and pack-out evaluations stay in the pricing application.',
  product_family: 'Tells Engineering which product line and tooling family to look at.',
  // FB-15 (W13-03): what an "Other" product family, component or decoration is.
  product_family_other: 'Required when the product family is Other: say what the product is.',
  components: 'Closures, liners and labels change tooling, sourcing and the price build.',
  component_other: 'Required when a component is Other: say what it is.',
  decoration_type_other: 'Required when the decoration is Other: say how it is decorated.',
  market: 'Market drives material, regulatory and cleanliness requirements.',
  // FB-12 (F-073): the sub-market sets the strategic-fit score once the draft model is active.
  // FB-15 (W13-11, Bailey Schmitt): the Midas name for Spirits & Mixers.
  sub_market:
    'Pick the closest sub-market. It sets the strategic-fit score. Beverage › Spirits & Mixers covers alcoholic drinks (Midas calls it Alcoholic).',
  resin: 'Resin decides the process, the machine and much of the cost.',
  neck_finish: 'The neck finish is one of the details Engineering most often has to chase.',
  neck_diameter:
    'Neck diameter in mm. Pick Custom and describe it if it is not on the list. Engineering most often has to chase the neck.',
  neck_finish_type: 'The finish (thread or closure style). Pick Custom and describe it if needed.',
  neck_special_feature: 'Optional: continuous thread, multi lead, tamper evident, vented.',
  resin_customer_specified:
    'Pricing needs the exact material when the customer dictates it, not just "polypropylene".',
  pcr_level:
    'Post-consumer recycled content, from the standard levels. Pick Other for a level that is not listed.',
  // FB-09 (Danielle Leu, 2026-11-09): the detail fields for an "Other" resin, PCR level or additive.
  resin_grade:
    'Required when the resin is Other: the customer-specified resin and grade, e.g. "LyondellBasell Pro-fax 6331". Also used when the customer specifies the resin.',
  pcr_level_other: 'Required when PCR is Other: the PCR level the customer asked for.',
  additive:
    'Anything added to the resin, from the standard list. Pick Other for a specialty additive.',
  color_type:
    'Color and additives drive material cost. Describe a custom color. A stock color is the colorant Pretium uses for its stock items at that plant.',
  additives:
    'Optional note on additives. Required, as the customer-specified additive, when the additive is Other.',
  quote_variants_note:
    'Variants the customer wants priced, e.g. "0/25/50% PCR; near-site vs ideal-site". Optional.',
  packaging_type: 'How it ships (bulk, bagged, trayed) changes pack-out, labour and freight.',
  packaging_notes: 'Pallet, case and labelling rules are a common reason quotes come back.',
  est_annual_volume:
    "Volume sizes the machine, cavitation and capacity. Please use the customer's real number.",
  est_annual_revenue: 'Revenue helps rank the request; it starts from the Salesforce amount.',
  quote_needed_by:
    'When the customer needs the quote. It sets the timing part of the priority score, so be realistic.',
  product_needed_by:
    'Your best estimate of when the customer needs product (launch). On or after Quote needed by.',
  container_size: 'Size, with the container type and resin, makes up the standard description.',
  standard_description: 'A consistent description makes requests easy to compare and search.',
  description: 'Anything else about the request, in your own words.',
  drawing_status:
    'A drawing is the fastest way to an accurate quote. Without a bottle or competitor drawing attached, the minimum spec is required.',
  dimensions:
    'Height, width or diameter, depth and gram weight. Required (with neck, resin and color) when no drawing is attached; the red asterisks go away once a drawing is attached.',
  modify_existing_mold:
    'Changing a mold we already run (e.g. a finish change). Attach the reference drawing or a photo of the part.',
  rfp_link: 'The customer’s RFP or bid portal page, if there is one (https link).',
  // FB-11 (D-032, F-080, F-063, F-085). Provisional wording; Pretium has no standard dunnage wording yet (A-033).
  requested_payment_terms:
    'The payment terms the customer asks for. The standard is Net 15 or Net 30; a longer request is a negotiation point because Pretium carries the cost, so Pricing needs to know. It does not change the costing.',
  requested_payment_terms_other: 'Describe the terms the customer asked for.',
  tooling_funding_model:
    'Only whether the customer pays for any of the tooling or capital. The amount and how it is paid belong to the terms later.',
  tooling_funding_tax_hint:
    'If the customer owns the tool it is not Pretium capital, and sales tax and contract terms apply. Tax will want to know.',
  returnable_dunnage:
    '"Multi-trip" dunnage comes back to Pretium; "single-trip" ships out and the customer is charged for it. Leave unticked for single-trip.',
  price_basis:
    'Delivered or FOB Pretium plant. A delivered price carries freight, which was missed in costing before.',
  freight_type:
    'How it ships when the price is delivered. Drop trailers and T-bars add real cost: say so below.',
  freight_special_arrangements:
    'Anything unusual about the freight. A drop trailer sits for about two weeks and T-bars are very expensive, so name them here if the customer expects them. Required when the freight type is Other.',
  // FB-15 (W13-09): the customer's share when funding is Shared.
  customer_share_pct: 'Pretium covers the rest.',
  // FB-15 (W13-06, Bailey Schmitt, Zachary Cairns): customers rarely send their own reference.
  bid_reference: "Most customers don't send one. Leave it blank if not.",
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
  {
    key: 'comment_email_collapse_minutes',
    value: COMMENT_EMAIL_COLLAPSE_MINUTES_SEED,
    description:
      'FB-05 (F-034): comment emails wait this many minutes so several comments on a quote go out as one email to each person ("3 new comments on CCQ-…"). 0 sends each comment at once. The in-app notification is never delayed. Provisional.',
  },
  // ── B-13 customer decision (D-12, D-15, R3). All provisional.
  {
    key: 'validity_warning_days',
    value: VALIDITY_WARNING_DAYS_SEED,
    description:
      'The proposal validity countdown turns amber at this many days left or fewer (red once expired). The daily expiry job flags lapsed quotes and tells the KAM; nothing auto-closes (D-12 open).',
  },
  // ── FB-04 (F-076): the Salesforce link and the reminder after a G5 outcome. Provisional.
  {
    key: 'salesforce_instance_url',
    value: '',
    description:
      'FB-04 (F-076): the Salesforce Lightning base URL, e.g. https://pretium.lightning.force.com (not a secret). Empty: the quote header shows the plain opportunity ID. Set by an Admin; the Salesforce connection itself only knows a login URL.',
  },
  {
    key: 'sf_outcome_stage_names',
    value: SF_OUTCOME_STAGE_NAMES_SEED,
    description:
      'FB-04 (F-076): the Salesforce stage named in the reminder shown after a G5 outcome is saved (CCQ outcome key to a name in sf_stage_map). Nothing is written to Salesforce. Provisional until the KAMs confirm which stage they use.',
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
  // ── FB-10 (T-011, F-066, D-004 open). Both seeded OFF, provisional.
  {
    key: 'g1_volume_routing',
    value: VOLUME_ROUTING_SEED,
    description:
      'FB-10 (T-011, D-004 open): volume-band routing at intake, seeded OFF. When enabled, a submitted quote whose metric (est_annual_volume or est_annual_revenue) is outside [min, max) goes to the sales leader to qualify (G1); one inside the band goes straight to Engineering (SUBMIT). A missing value goes to the sales leader. It replaces g1_enabled for the submit, so G1 must be on to switch it on. The tracker words T-011 as revenue bands; the platform guide gives volumes, so the metric is a setting. Seed: min 1,000,000 units (the lowest platform minimum), no maximum. Provisional until D-004 sets the band.',
  },
  {
    key: 'intake_guardrails',
    value: INTAKE_GUARDRAILS_SEED,
    description:
      'FB-10 (F-066, T-025, D-004 open): non-blocking platform-minimum warning at intake, seeded OFF. minAnnualVolumeByProcess = new-mold planning minimum (units/yr) by process_type, from Danielle Leu’s corrected Machine Platforms table (2026-11-09): ISBM 1M, RHB 1M, Injection (IMM) 3M, IBM 3M, EBM 1M. While the platform is not known the lowest minimum applies. The warning is shown on the intake and kept on the quote for G1; it never blocks a submit. An Admin switches it on once D-004 agrees to warn at these volumes.',
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
    description: 'The request_class code a new intake starts with.',
  },
  // ── FB-02 intake overhaul (Nov 2–3 walkthroughs). All provisional.
  {
    key: 'intake_allowed_request_classes',
    value: INTAKE_ALLOWED_REQUEST_CLASSES,
    description:
      'FB-02 (F-067): the request_class codes that can be submitted to CCQ. Any other class shows intake_redirect_message and Submit is disabled; the API answers 422 REQUEST_CLASS_NOT_ALLOWED. Provisional (Matthew Graden, Tania Nazario).',
  },
  {
    key: 'intake_variants_note_max_length',
    value: 300,
    description:
      'FB-02 (F-075): longest "Quote variants requested" note (characters). The note is the interim answer to D-017 (option B); structured scenarios are F-056 (P1).',
  },
  {
    key: 'intake_free_text_max_length',
    value: 500,
    description:
      'FB-09 (F-019, D-016 default; the tracker recommends A + B, Bailey Schmitt to confirm): the longest packaging note (characters) the intake accepts on a new edit. An older, longer note stays readable and shows a warning. Provisional.',
  },
  {
    key: 'plant_packaging_standards',
    value: {},
    description:
      'FB-09 (F-012, D-016 default; A-028 not received): plant code → the standard pack-out configuration Engineering has published for that plant. "Plant specified" packaging is offered only for a plant listed here, and "Pretium / plant preferred" is never offered (Paul Slomkowski). Empty until Engineering sends plant-packaging-standards.csv. Provisional.',
  },
  {
    key: 'intake_other_description_max_length',
    value: 200,
    description:
      'FB-15 (W13-03): the longest description (characters) of an "Other" product family, component or decoration. Provisional.',
  },
  {
    key: 'customer_master_data_notice',
    value: CUSTOMER_MASTER_DATA_NOTICE,
    description:
      'FB-15 (W13-10, Bailey Schmitt): shown on the Commit & Hand Off view and the closed-won quote when the customer is "not yet a Pretium customer" (no ERP account). Empty = no notice. Provisional wording.',
  },
  {
    key: 'intake_min_spec_fields',
    value: INTAKE_MIN_SPEC_FIELDS,
    description:
      'FB-02 (F-016, D-018 decided: Paul Slomkowski, Jim Zweifel, Matthew Graden, Tania Nazario): without a bottle or competitor drawing attached, every one of these must be filled to submit (422 DRAWING_OR_MIN_SPEC_REQUIRED). Keys: height, widthOrDiameter, depth, gramWeight, neck (diameter + finish), resin, color. Provisional: A-024 may add layer structure and a container photo.',
  },
  // ── FB-11 intake commercial inputs (D-032, 2026-11-06). Provisional.
  {
    key: 'standard_payment_terms',
    value: STANDARD_PAYMENT_TERMS,
    description:
      'FB-11 (F-080, D-032, A-012 decided Nov 9): the requested_payment_terms codes that count as standard. Any other request is flagged "Non-standard: Pricing will review" on the intake and the quote. Net 15 and Net 30 are both standard (Gemma Cebolla, Nov 9); still marked provisional until an Admin approves it.',
  },
  {
    // FB-08 (F-021): the default the Commercial panel pre-selects (the customer's request wins).
    key: 'default_payment_terms',
    value: DEFAULT_PAYMENT_TERMS,
    description: DEFAULT_PAYMENT_TERMS_DESCRIPTION,
  },
  {
    key: 'intake_redirect_message',
    value: INTAKE_REDIRECT_MESSAGE,
    description:
      'FB-02 (F-067): shown when a non-CCQ request class is chosen. D-030 (open) may change where pack-out changes go.',
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
  // ── FB-03 (F-059, D-021 open): the basis for utilization after the new business. Provisional.
  {
    key: 'capacity_basis',
    value: CAPACITY_BASIS_SEED,
    description:
      'FB-03 / D-021 (open): the basis for utilization after the new business. scheduledRunDaysPerYear defaults each capacity row; warnAbovePct turns the after-utilization amber (over 100 is always red); basisLabel is shown under the capacity table and in the CSV. Provisional until Faron Ipox and leadership confirm the basis (A-023).',
  },
  // ── FB-06 (F-062, D-008 open, A-006): the suggested engineer in the assign dialog. Provisional.
  {
    key: 'engineering_assignment_rules',
    value: ASSIGNMENT_RULES_SEED,
    description:
      'FB-06 (F-062, D-008 open): routing suggestions for the engineering assignment. A rule lists process types and / or resins (value-list codes; an empty list means any) and the engineer by surname or full name; the first matching rule wins and the assign dialog shows "Suggested: <name>". It never assigns: the lead still does. Seeded from the Nov 4 email from Paul Slomkowski (ISBM, RHB, IMM, IMM Preform → Neiberger; EBM, IBM → Pasillas); the resin rules are a fallback while the process type is not yet chosen. Provisional until D-008 is decided.',
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
      'D-25: when any switched-on trigger applies (new customer, nonstandard terms, tooling commitment), a Legal review is due before the offer is released. Whether it blocks G4 Advance is g4_required_checks.',
  },
  {
    // FB-01 (F-069): the approver is no longer blocked by fields other roles own.
    key: 'g4_required_checks',
    value: G4_REQUIRED_CHECKS_SEED,
    description: G4_REQUIRED_CHECKS_DESCRIPTION,
  },
  {
    // FB-08 (F-068, T-031): what the approver must fill before confirming the capital terms.
    key: 'capital_terms_required',
    value: CAPITAL_TERMS_REQUIRED_SEED,
    description: CAPITAL_TERMS_REQUIRED_DESCRIPTION,
  },
  {
    // FB-08 (F-082, D-002, A-035 open): the extra sign-off proposal, switched off.
    key: 'g4_additional_approvals',
    value: G4_ADDITIONAL_APPROVALS_SEED,
    description: G4_ADDITIONAL_APPROVALS_DESCRIPTION,
  },
  {
    // FB-07 (D-001): Quoting's ROI step (Finance) applies when capital is required, $0 CER included.
    key: 'roi_required_when',
    value: ROI_REQUIRED_WHEN_SEED,
    description:
      'FB-07 (D-001): when a quote needs Finance\'s payback model (roi_model; "Payback" since FB-14) before the pricing lead approves the price (G3). Any of: Engineering\'s latest G2 outcome is in g2Outcomes, the quote is flagged capital likely (capitalLikely), or the tooling funding model is in fundingModels. Seed: capital required, $0 CER included. Provisional.',
  },
  // ── FB-14 (F-031 summary half, D-013, A-031 partly received): the model summary. Provisional.
  {
    key: 'model_summary_templates',
    value: MODEL_SUMMARY_TEMPLATES_SEED,
    description:
      'FB-14 (F-031 summary half, D-013, A-031 partly received): the one-page summary maps. One entry per template: the attachment kind, how to recognise it (a sheet plus label cells) and the fields to read (a defined name when the workbook has one, else an A1 address; fallbackRef is used until the name exists). Inactive maps are not used. Seeded: the payback calculator (Finance, draft #3: cells proposed, Finance to confirm and add the QF_ names) and the pre-makeover ERF costing layout (inactive). Provisional.',
  },
  {
    key: 'model_summary_visible',
    value: MODEL_SUMMARY_VISIBLE_SEED,
    description:
      'FB-14 (04 §2a, open): may QuoteFlow show the figures read from uploaded models (costing, payback) to the roles that read the quote? Seeded on (CLAUDE.md rule 2: every role that reads a quote sees its commercial figures). Off hides the figures everywhere; the files and their versions still show. Provisional until Gemma Cebolla decides.',
  },
  {
    key: 'model_summary_limits',
    value: MODEL_SUMMARY_LIMITS_SEED,
    description:
      'FB-14: the work cap for reading a model summary at upload: maxBytes (a larger file is stored and shows "too large"), timeoutMs (well inside the upload request), maxCells. Provisional.',
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

/**
 * FB-02 (F-009): v2 scores timing on the KAM's "Quote needed by" date. Same weights and bands as v1
 * (D-004 open). In a new database it is in effect from the same date as v1, so every score uses it
 * (intake no longer stores the close date v1 reads). Existing environments get it from migration 0028
 * (as max version + 1, copied from the model in effect, effective at the migration); here it is only
 * inserted when no model reads the need-by date yet, so a re-seed never rewrites a version an admin made.
 */
export const SCORING_MODEL_V2 = scoringModelRow(SCORING_MODEL_V2_INPUT, {
  effectiveFrom: new Date('2026-10-01T00:00:00Z'),
  changeReason:
    "FB-02 (F-009): timing reads the KAM's Quote needed by date instead of the Salesforce close date. Weights and bands unchanged (D-004 open).",
});

export async function seedScoringModel(db: DbOrTx): Promise<void> {
  await upsertConfig(
    db,
    scoringModel,
    [{ ...SCORING_MODEL_V1, provisional: true }],
    ['modelVersion'],
  );
  // Only when no model already reads the need-by date (migration 0028 may have made it as another version).
  const models = await db
    .select({ version: scoringModel.modelVersion, attributes: scoringModel.attributes })
    .from(scoringModel);
  const readsNeedBy = models.some(
    (m) =>
      m.version === SCORING_MODEL_V2.modelVersion ||
      (m.attributes as { key?: string; input?: string }[]).some(
        (a) => a.key === 'timing' && a.input === 'days_to_quote_needed',
      ),
  );
  if (!readsNeedBy) {
    await db
      .insert(scoringModel)
      .values({ ...SCORING_MODEL_V2, provisional: true })
      .onConflictDoNothing();
  }
  await seedScoringDraftV3(db);
}

/**
 * FB-10 (F-073, D-004 open): v3, an INACTIVE draft (no effective_from) with strategic-fit points by market
 * from the 9-box. The live model is not touched. Inserted once: not when a draft already exists, nor when an
 * FB-10 version was made before (an Admin who discarded or activated it is not given another). Existing
 * environments get the same draft, copied from the model in effect, from migration 0034.
 */
async function seedScoringDraftV3(db: DbOrTx): Promise<void> {
  const rows = await db
    .select({
      version: scoringModel.modelVersion,
      effectiveFrom: scoringModel.effectiveFrom,
      changeReason: scoringModel.changeReason,
    })
    .from(scoringModel);
  if (
    rows.some(
      (r) =>
        r.effectiveFrom === null ||
        r.changeReason.startsWith('FB-10') ||
        r.changeReason.startsWith('FB-12'),
    )
  )
    return;
  const version = Math.max(0, ...rows.map((r) => r.version)) + 1;
  await db.insert(scoringModel).values({
    ...scoringModelRow(
      { ...SCORING_MODEL_V3_INPUT, version },
      { effectiveFrom: new Date(), changeReason: SCORING_DRAFT_V3_CHANGE_REASON },
    ),
    effectiveFrom: null,
    provisional: true,
  });
}

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
