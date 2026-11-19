import { z } from 'zod';

import { CommercialDetail } from './commercial';
import { EngineeringDetail } from './eng-review';
import { IntakeAddress } from './intake';
import { CustomerDecisionDetail } from './outcome';
import { QuoteOverridableField } from './overrides';
import { QuotingDetail } from './pricing';
import { QuoteRequoteLinks } from './requote-links';

// ── Priority (B-08, advisory) ────────────────────────────────────────────────────────────────────

export const ScoreBreakdownItem = z.object({
  key: z.string(),
  label: z.string(),
  weight: z.number(),
  /** What the attribute was scored on; null when unknown or restricted (commercial input). */
  raw: z.union([z.string(), z.number()]).nullable(),
  points: z.number(),
  contribution: z.number(),
  explanation: z.string(),
  unknown: z.boolean(),
  sensitive: z.boolean(),
  /** FB-04: the attribute's map is empty, so the points are the neutral default until D-004 is decided. */
  provisional: z.boolean().optional(),
});
export type ScoreBreakdownItem = z.infer<typeof ScoreBreakdownItem>;

/**
 * A quote's priority. `tier` is what to display: the override tier when an approved override set one
 * (B-09), else the computed tier. `computedTier` is always the score's own tier.
 * `visible: false` means the server withheld it (`kam_can_see_peer_scores` = false): every value is null.
 */
export const QuotePriority = z.object({
  visible: z.boolean(),
  score: z.number().nullable(),
  tier: z.string().nullable(),
  tierLabel: z.string().nullable(),
  computedTier: z.string().nullable(),
  computedTierLabel: z.string().nullable(),
  tierOverridden: z.boolean(),
  modelVersion: z.number().int().nullable(),
  /** The "Why this priority?" table; empty when not scored or hidden. */
  breakdown: z.array(ScoreBreakdownItem),
  /** Attribute keys scored neutral because their input is unknown (e.g. capital before G2). */
  unknowns: z.array(z.string()),
});
export type QuotePriority = z.infer<typeof QuotePriority>;

/** G1 qualification screens (D-06): warnings only, never a block. */
export const QualificationWarning = z.object({
  code: z.string(),
  field: z.string(),
  threshold: z.number(),
  actual: z.number(),
  message: z.string(),
});
export type QualificationWarning = z.infer<typeof QualificationWarning>;

// ── Gate actions (from the domain's availableActions) ────────────────────────────────────────────

export const MissingField = z.object({ field: z.string(), message: z.string() });
export type MissingField = z.infer<typeof MissingField>;

/**
 * FB-17 (W13-23): the choices of the decision dialog. The same list as the domain's `OUTCOME_GROUPS`
 * (this package does not import the domain; a web unit test keeps the two equal).
 */
export const OUTCOME_GROUP_VALUES = [
  'advance',
  'send_back',
  'hold',
  'stop',
  'customer_outcome',
] as const;
export const OutcomeGroup = z.enum(OUTCOME_GROUP_VALUES);
export type OutcomeGroup = z.infer<typeof OutcomeGroup>;

export const AvailableGateAction = z.object({
  gateKey: z.string(),
  gateLabel: z.string(),
  outcomeKey: z.string(),
  outcomeLabel: z.string(),
  requiresNote: z.boolean(),
  requiresReasonCode: z.boolean(),
  reasonCodes: z.array(
    z.object({ code: z.string(), label: z.string(), requiresNote: z.boolean() }),
  ),
  /** More than one: the decider chooses (`targetStageKey`). */
  targetStageKeys: z.array(z.string()),
  nextStatus: z.enum(['active', 'on_hold', 'closed']),
  /** The outcome needs a review date (sent as `holdUntil`). */
  requiresReviewDate: z.boolean(),
  /** A strategic exception note is required because the quote has qualification warnings. */
  requiresExceptionNote: z.boolean(),
  /** Quote fields this outcome needs that are still missing (the completeness summary). */
  missing: z.array(MissingField),
  /** B-12: the outcome releases the proposition (Final Review → Customer Decision): it sets the proposal dates. */
  releasesProposal: z.boolean(),
  /** B-12: `validity_days_default`, so the dialog can show "valid until"; null unless `releasesProposal`. */
  validityDays: z.number().int().nullable(),
  /**
   * B-13: the outcome closes the quote as the customer's outcome (G5 Awarded / Lost / Expired), so the
   * dialog shows the closure owner (and for an award, the acceptance date and document link).
   */
  closesAs: z.string().nullable(),
  /** B-13: whom the closure owner defaults to (the KAM, or the decider); null unless it closes. */
  closureOwnerDefault: z.enum(['kam', 'decider']).nullable(),
  /** B-13: the outcome needs an acceptance date (`acceptedAt`; G5 Awarded). */
  requiresAcceptanceDate: z.boolean(),
  /** B-13: a note is required only because the proposal's validity has not passed yet (Expired). */
  requiresNoteBeforeValidity: z.boolean(),
  /** B-26: the outcome needs a hold owner (sent as `holdOwnerId`). */
  requiresHoldOwner: z.boolean(),
  /** B-26: the outcome's definition (admin-editable help text); null when none is set. */
  helpText: z.string().nullable(),
  /**
   * FB-17 (W13-23): the choice the dialog shows the outcome under: `advance`, `send_back`, `hold`, `stop`
   * or `customer_outcome` (G5, the customer's answer, listed flat). Config
   * (`gate_outcome_definition.outcome_group`), never worked out from the key; null in a config without
   * groups. Only switched-on outcomes are listed at all.
   */
  outcomeGroup: OutcomeGroup.nullable(),
  /**
   * FB-16 (W13-18): this outcome needs capacity approved, nobody has signed it yet, and the caller may
   * sign it off (`capacity.signoff`). The dialog shows the required checkbox "Capacity approved (I'm
   * signing it off)" and sends `capacityApproved: true`; `missing` already leaves the sign-off out.
   * False when capacity is approved or blocked (a block keeps Advance unavailable).
   */
  capacityApproval: z.boolean(),
});
export type AvailableGateAction = z.infer<typeof AvailableGateAction>;

// ── Quotes ───────────────────────────────────────────────────────────────────────────────────────

export const QuoteSummary = z.object({
  id: z.string(),
  quoteNumber: z.string(),
  /** FB-19 (W13-32): how many items the quote holds (1 for a single-item quote). */
  itemCount: z.number().int().min(1).default(1),
  /**
   * FB-19: item 1's label with the count of the others ("16 oz bottle + 2 more"); for a one-item quote its
   * label, or null when it has none.
   */
  itemsSummary: z.string().nullable().default(null),
  stageKey: z.string(),
  status: z.string(),
  version: z.number().int(),
  sfOpportunityId: z.string(),
  /**
   * FB-04 (F-076): the Lightning link to the Salesforce opportunity; null until `salesforce_instance_url`
   * is set. FB-18 (W13-31): on the summary, so every list that names the opportunity (the queues, Final
   * Review, the pipeline) can link to it, not only the quote page.
   */
  sfOpportunityUrl: z.string().nullable(),
  opportunityName: z.string().nullable(),
  customerName: z.string().nullable(),
  customerStatus: z.string().nullable(),
  kamUserId: z.string(),
  kamName: z.string().nullable(),
  requestClass: z.string().nullable(),
  productFamily: z.string().nullable(),
  market: z.string().nullable(),
  /** FB-12 (F-073): the sub-market under `market`; sets the strategic-fit score. Optional at intake. */
  subMarket: z.string().nullable(),
  resin: z.string().nullable(),
  estAnnualVolume: z.number().nullable(),
  estAnnualRevenue: z.number().nullable(),
  /**
   * FB-02 (F-008, T-009): the Salesforce close date from the latest sync ("updates with Salesforce").
   * Quotes from before FB-02 with no synced date show the deprecated close date stored at intake.
   */
  expectedCloseDate: z.string().nullable(),
  /** Null while the quote is back with the KAM for rework. */
  submittedAt: z.string().nullable(),
  reviewDate: z.string().nullable(),
  priority: QuotePriority,
  warnings: z.array(QualificationWarning),
});
export type QuoteSummary = z.infer<typeof QuoteSummary>;

export const GateDecisionSummary = z.object({
  id: z.string(),
  gateKey: z.string(),
  outcomeKey: z.string(),
  decidedBy: z.string(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string(),
  note: z.string().nullable(),
  reasonCode: z.string().nullable(),
  /**
   * UX-006: the reason code's configured label, read from every code the gate's outcome ever had, so a
   * code retired since the decision still reads as it did. Null with no reason code, or when the code
   * has no label at all. Read-only.
   */
  reasonLabel: z.string().nullable().optional(),
  quoteVersion: z.number().int(),
  /**
   * B-13 (CR-38): taken against an earlier version than the quote's current one (a re-quote or return
   * bumped it). Kept exactly as recorded, never edited; shown as superseded.
   */
  superseded: z.boolean(),
});
export type GateDecisionSummary = z.infer<typeof GateDecisionSummary>;

/** Shown to the KAM (and on the quote) while a quote is back for rework. */
export const ReworkRequest = z.object({
  gateKey: z.string(),
  reasonCode: z.string().nullable(),
  reasonLabel: z.string().nullable(),
  note: z.string().nullable(),
  decidedAt: z.string(),
  decidedByName: z.string().nullable(),
});
export type ReworkRequest = z.infer<typeof ReworkRequest>;

/**
 * FB-02: the product and timing facts the KAM entered at intake, for every role that reads the quote
 * (Engineering and Pricing included). Codes are value-list codes; the UI shows their labels.
 */
export const QuoteIntakeFacts = z.object({
  /** F-009: when the customer needs the quote, and the best estimate of the launch need. */
  quoteNeededBy: z.string().nullable(),
  productNeededBy: z.string().nullable(),
  /** F-010: the neck (value-list codes; a Custom value carries its description). */
  neckDiameter: z.string().nullable(),
  neckDiameterCustom: z.string().nullable(),
  neckFinishType: z.string().nullable(),
  neckFinishTypeCustom: z.string().nullable(),
  neckSpecialFeature: z.string().nullable(),
  neckSpecialFeatureCustom: z.string().nullable(),
  /** F-011: customer-specified resin and its supplier / grade (T-013). */
  resinCustomerSpecified: z.boolean(),
  resinGrade: z.string().nullable(),
  /** F-055 */
  pcrLevel: z.string().nullable(),
  /** FB-09: the customer-specified PCR level (PCR is Other). */
  pcrLevelOther: z.string().nullable(),
  /** FB-09: additive code; the `additives` note is the customer-specified additive when it is Other. */
  additive: z.string().nullable(),
  /** F-023 */
  colorType: z.string().nullable(),
  colorDescription: z.string().nullable(),
  additives: z.string().nullable(),
  /** F-075 */
  quoteVariantsNote: z.string().nullable(),
  /** F-013: component follow-ups. */
  linerSpec: z.string().nullable(),
  labelsPurchasedBy: z.string().nullable(),
  /** FB-24 (N17-02): decoration_type codes, several at once (was one `decorationType`). */
  decorationTypes: z.array(z.string()),
  decorationPrintColors: z.number().int().nullable(),
  /** F-016: dimensions (mm) and gram weight (g). */
  heightMm: z.number().nullable(),
  widthOrDiameterMm: z.number().nullable(),
  depthMm: z.number().nullable(),
  gramWeightG: z.number().nullable(),
  /** F-015: modify an existing mold (the Engineering queue shows a "Mold modification" chip). */
  modifyExistingMold: z.boolean(),
  existingMoldRef: z.string().nullable(),
  moldChangeDescription: z.string().nullable(),
  /** F-014: the customer's RFP / portal link (https), for every role that reads the quote. */
  rfpLink: z.string().nullable(),
  /**
   * FB-11 (D-032): the commercial inputs the KAM gave at intake, for every role that reads the quote
   * (rule 2). `requestedPaymentTerms` is a value-list code; whether it is non-standard is judged from the
   * `standard_payment_terms` setting where it is shown. `toolingFundingModel` is the same field the
   * Commercial panel edits.
   */
  requestedPaymentTerms: z.string().nullable(),
  requestedPaymentTermsOther: z.string().nullable(),
  toolingFundingModel: z.string().nullable(),
  returnableDunnage: z.boolean(),
  priceBasis: z.string().nullable(),
  freightType: z.string().nullable(),
  freightSpecialArrangements: z.string().nullable(),
  /** F-085: the bid / program reference. */
  bidReference: z.string().nullable(),
  /** FB-15 (W13-09, provisional): the customer's share in percent when funding is Shared; Pretium covers the rest. */
  customerSharePct: z.number().nullable(),
  /** FB-24 (N17-03): what a concept / innovation quote assumes; null for any other class. */
  conceptAssumptions: z.string().nullable(),
  /**
   * FB-24 (N18-02): will the customer commit to the tooling (`terms_tooling_commitment`, the column the
   * Commercial terms panel edits): true / false; null = not known yet.
   */
  toolingCommitment: z.boolean().nullable(),
  /** FB-24 (D4): the stocking agreement the customer asks for (null = not known yet), weeks and a note. */
  stockHoldRequested: z.boolean().nullable(),
  stockHoldWeeks: z.number().int().nullable(),
  stockHoldNote: z.string().nullable(),
  /** FB-15 (W13-03): what an "Other" product family, component or decoration is. */
  productFamilyOther: z.string().nullable(),
  componentOther: z.string().nullable(),
  decorationTypeOther: z.string().nullable(),
  /** FB-10 (F-066): the platform-minimum warning shown at the last submit, kept for G1; null when none. */
  guardrailWarning: z.string().nullable(),
});
export type QuoteIntakeFacts = z.infer<typeof QuoteIntakeFacts>;

/**
 * FB-19 (W13-32): one item of a quote as Quoting, Final Review, the hand-off and the quote page list it:
 * its key product facts, volume and need-by, and the plant and machine Engineering chose for it.
 */
export const QuoteItemSummary = z.object({
  /** The `quote_item` id; null only for a quote that has no item row yet (listed from its own columns). */
  id: z.string().nullable(),
  itemNo: z.number().int(),
  label: z.string().nullable(),
  /** "Item 2 (24 oz bottle)". */
  name: z.string(),
  productFamily: z.string().nullable(),
  productFamilyLabel: z.string().nullable(),
  resin: z.string().nullable(),
  resinLabel: z.string().nullable(),
  containerSize: z.string().nullable(),
  standardDescription: z.string().nullable(),
  estAnnualVolume: z.number().nullable(),
  productNeededBy: z.string().nullable(),
  plantCode: z.string().nullable(),
  plantLabel: z.string().nullable(),
  machineType: z.string().nullable(),
  machineTypeLabel: z.string().nullable(),
  cavitation: z.number().nullable(),
  /** The item's budgetary capital estimate; absent for roles without commercial access (none today). */
  prelimCapitalUsd: z.number().nullable().optional(),
});
export type QuoteItemSummary = z.infer<typeof QuoteItemSummary>;

/**
 * UX-002: whose move the quote is, as facts (the UI words them, with the gate's label from the public
 * config). The same lists as the domain's `NEXT_STEP_PARTIES`, `NEXT_STEP_STATES` and
 * `NEXT_STEP_PLACES` (this package does not import the domain; an API unit test keeps them equal).
 */
export const NEXT_STEP_PARTY_VALUES = [
  'kam',
  'sales_leader',
  'engineering',
  'engineering_lead',
  'pricing',
  'pricing_lead',
  'finance',
  'approver',
  'leadership',
  'customer',
  'nobody',
] as const;
export const NEXT_STEP_STATE_VALUES = [
  'rework',
  'unassigned',
  'in_progress',
  'with_lead',
  'at_gate',
  'on_hold',
  'closed',
] as const;
export const NEXT_STEP_PLACE_VALUES = ['intake', 'engineering', 'quoting', 'decision'] as const;
export const NEXT_STEP_PART_VALUES = ['capacity', 'decide'] as const;

export const QuoteNextStep = z.object({
  /** Who the quote is waiting on: a role in plain terms, the customer, or nobody (closed). */
  waitingOn: z.enum(NEXT_STEP_PARTY_VALUES),
  /** The person waited on, when the quote names one (its KAM, the assigned engineer or pricer). */
  personName: z.string().nullable(),
  /**
   * `rework`: back with the KAM until resubmitted. `unassigned`: nobody assigned in Engineering or
   * Quoting. `in_progress`: the assignee (or Finance, for the payback model) is doing their part.
   * `with_lead`: submitted to the lead. `at_gate`: waiting for the stage's gate decision.
   */
  state: z.enum(NEXT_STEP_STATE_VALUES),
  /** When it entered this state, when known: the send-back (`rework`), the submit (`with_lead`). */
  since: z.string().nullable(),
  /** The enabled gate of the quote's stage (what is decided next); null when closed. */
  gateKey: z.string().nullable(),
  /** Where the next step is done: the intake wizard, a work tab of the quote, or the gate's decision. */
  place: z.enum(NEXT_STEP_PLACE_VALUES).nullable(),
  /** The caller is the one waited on and the server would accept their move now. */
  yourMove: z.boolean(),
  /**
   * Set only when it is the caller's move and their part is not simply the assignee's: `capacity` (the
   * production scheduler assigned to the quote: the capacity evidence and sign-off), `decide` (a lead
   * who is the assignee: their work ends in the gate decision, not a submit).
   */
  part: z.enum(NEXT_STEP_PART_VALUES).optional(),
  /** Only while on hold: the review date (`YYYY-MM-DD`), the owner and the reason code's label. */
  hold: z
    .object({
      reviewDate: z.string().nullable(),
      ownerName: z.string().nullable(),
      reasonLabel: z.string().nullable(),
    })
    .nullable(),
});
export type QuoteNextStep = z.infer<typeof QuoteNextStep>;

export const QuoteDetail = QuoteSummary.extend({
  /** FB-19 (W13-32): every item, in item order (one for a single-item quote). */
  items: z.array(QuoteItemSummary).default([]),
  description: z.string().nullable(),
  standardDescription: z.string().nullable(),
  components: z.array(z.string()),
  drawingStatus: z.string().nullable(),
  neckFinish: z.string().nullable(),
  packagingType: z.string().nullable(),
  packagingNotes: z.string().nullable(),
  commentsForEngineering: z.string().nullable(),
  shipTo: IntakeAddress.nullable(),
  /** FB-02: product and timing facts from intake. */
  intakeFacts: QuoteIntakeFacts,
  outcome: z.string().nullable(),
  outcomeReasonCode: z.string().nullable(),
  closedAt: z.string().nullable(),
  /** B-12: set by the Final Review approval (the actual send date) and its validity date. */
  proposalIssuedAt: z.string().nullable(),
  validityUntil: z.string().nullable(),
  decisions: z.array(GateDecisionSummary),
  /** What the caller may decide now (rendered as the decision dialog's options). */
  availableActions: z.array(AvailableGateAction),
  rework: ReworkRequest.nullable(),
  /** B-09: the overridable fields (tier, ship-to, …) with pending / applied overrides and whether the caller may request one. */
  overridableFields: z.array(QuoteOverridableField),
  /** B-10: the Engineering tab (assignment, review, capacity evidence), commercial numbers redacted per role. */
  engineering: EngineeringDetail,
  /** B-11: the Quoting tab. Commercial parts are stripped for roles without commercial access. */
  quoting: QuotingDetail,
  /** B-13: the Customer Decision header (validity countdown, SF stage), the closure and the hand-off. */
  customerDecision: CustomerDecisionDetail,
  /** B-26: capital flag, commercial terms, Legal review, hold owner and escalations. */
  commercial: CommercialDetail,
  /** UX-002: who the quote is waiting on and whether it is the caller's move. Read-only. */
  nextStep: QuoteNextStep.optional(),
  /** FB-26 (N17-30): the linked re-quote, both ends, and whether the caller may start one. */
  requote: QuoteRequoteLinks.optional(),
});
export type QuoteDetail = z.infer<typeof QuoteDetail>;

export const QuoteNumberParams = z.object({
  quoteNumber: z.string().regex(/^CCQ-\d{4}-\d{5}$/, 'A quote number looks like CCQ-2026-00001'),
});

// ── Gate decisions (generic: G1–G5) ──────────────────────────────────────────────────────────────

export const GateDecisionParams = QuoteNumberParams.extend({
  gateKey: z.string().min(1).max(40),
});

/** POST /api/v1/quotes/:quoteNumber/gates/:gateKey/decisions */
export const GateDecisionBody = z.object({
  outcomeKey: z.string().min(1),
  note: z.string().max(4000).optional(),
  reasonCode: z.string().max(80).optional(),
  /** Review date for a Hold (`YYYY-MM-DD`); stored as the quote's review_date. */
  holdUntil: z.iso.date().optional(),
  /** B-26: who owns the hold (an active CCQ user); every hold names one. */
  holdOwnerId: z.uuid().optional(),
  /** Only for outcomes with several target stages (returns / re-quotes). */
  targetStageKey: z.string().optional(),
  /**
   * Only for an outcome that releases the proposition (G4 Approve): the actual send date. Default now;
   * never in the future. `validity_until` is set from it (B-12).
   */
  proposalIssuedAt: z.iso.datetime({ offset: true }).optional(),
  /** B-13, G5 Awarded: the date the customer accepted (`YYYY-MM-DD`, not in the future). */
  acceptedAt: z.iso.date().optional(),
  /** B-13, G5 Awarded: optional link to the PO / LOI / contract (http(s)). */
  acceptanceDocumentUrl: z.string().max(2000).optional(),
  /** B-13, G5 Lost: optional competitor who won. Kept on the decision. */
  competitor: z.string().max(200).optional(),
  /**
   * B-13 (CR-39): the closure owner when the decision closes the quote. Default: the KAM for a customer
   * outcome, the decider for an internal no-go. Naming anyone else needs `outcome.assignOwner`.
   */
  closureOwnerId: z.uuid().optional(),
  /**
   * FB-01 (F-069), G4 only: the warning codes the approver saw on the Final Review screen (e.g.
   * TERMS_NOT_CHECKED). Recorded on the decision. When sent, it must include every open warning, or the
   * decision is refused (the screen is stale).
   */
  acknowledgedWarnings: z.array(z.string().max(80)).max(50).optional(),
  /**
   * FB-16 (W13-18), G2 only: the decider signs capacity off with this decision ("Capacity approved (I'm
   * signing it off)"). Accepted only where `AvailableGateAction.capacityApproval` is true: the sign-off
   * and the decision are recorded in one transaction, both audited, then the gate rules run.
   */
  capacityApproved: z.boolean().optional(),
});
export type GateDecisionBody = z.infer<typeof GateDecisionBody>;

export const GateDecisionResponse = z.object({
  decision: GateDecisionSummary,
  quote: QuoteDetail,
});
export type GateDecisionResponse = z.infer<typeof GateDecisionResponse>;

/** GET /api/v1/gates/:gateKey/queue: quotes waiting for this gate, highest priority first. */
export const GateQueueParams = z.object({ gateKey: z.string().min(1).max(40) });
export const GateQueueResponse = z.object({
  gate: z.object({
    key: z.string(),
    label: z.string(),
    stageKey: z.string(),
    enabled: z.boolean(),
  }),
  /** The caller holds the gate's decider permission. */
  canDecide: z.boolean(),
  items: z.array(QuoteSummary),
});
export type GateQueueResponse = z.infer<typeof GateQueueResponse>;

/** Problem `code`s for quote and gate routes. A rejected decision lists every domain error. */
export const GATE_PROBLEM_CODES = {
  notFound: 'not_found',
  unknownGate: 'unknown_gate',
  rejected: 'gate_decision_rejected',
  notPermitted: 'not_permitted',
  /** DR-cross-cutting-01: the gate was decided meanwhile (another person or tab), or the quote is already on hold. */
  alreadyDecided: 'already_decided',
} as const;
