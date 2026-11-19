import type {
  OutcomeGroup,
  RequiredRule,
  WorkflowConfig,
  WorkflowConfigInput,
} from '../../types/workflow-config';
import { parseWorkflowConfig } from '../validate-config';
import { OUTCOME_HELP } from './outcome-help';
import { SEED_REASON_CODES } from './reason-codes';

type OutcomeInput = WorkflowConfigInput['outcomes'][number];
type TransitionInput = WorkflowConfigInput['transitions'][number];

export interface HybridOptions {
  /** Config flag `g1_enabled` (default true). When false, INTAKE submit goes straight to ENG_REVIEW. */
  g1Enabled?: boolean;
}

const present = (field: string): RequiredRule => ({ field, op: 'present' });

/**
 * Minimum intake set (D-05, provisional): blocking fields before a quote can leave INTAKE. FB-02 (F-009)
 * adds the two need-by dates (migration 0028 updates existing environments).
 */
const INTAKE_COMPLETE: RequiredRule[] = [
  present('sf_opportunity_id'),
  present('customer_id'),
  present('product_family'),
  present('resin'),
  { anyOf: [present('est_annual_volume'), present('est_annual_revenue')] },
  present('quote_needed_by'),
  present('product_needed_by'),
];

/**
 * B-26 (deck slide 11): the capacity owner signs off at G2 and can block. Owner TBD (D-07 / D-008); the
 * permission `capacity.signoff` is held by the EngLead and (FB-16) the assigned production scheduler,
 * provisional. FB-16 (W13-18): a lead deciding G2 while capacity is not yet signed approves it in the
 * same decision (`canApproveCapacityInDecision`); the rule itself is unchanged.
 */
const CAPACITY_SIGNED_OFF: RequiredRule = {
  field: 'capacity_signoff_status',
  op: 'equals',
  value: 'approved',
};

/**
 * DR-engineering-02: G2 Advance is refused while a capacity row has no utilization after (server-derived
 * `capacity_utilization_missing`): an effectiveness of 0, or a missing cycle time, cavitation or volume,
 * leaves it blank, and a feasibility call must not rest on a blank. "Capital required" (switched off by
 * FB-17, kept for history) still needs no row.
 */
const CAPACITY_CALCULATED: RequiredRule = {
  field: 'capacity_utilization_missing',
  op: 'equals',
  value: false,
};

/**
 * FB-06 (F-058, D-033): "Capital required" needs the equipment BOM on file: the Engineering Program Office
 * workbook or its one-page CSR BOM, uploaded on the Engineering tab. `equipment_bom_on_file` is derived
 * from the quote's current `equipment_bom` attachment; a missing field fails closed. Provisional (Kal
 * Kaliszewski's minimum fields, A-030, may add more).
 */
const EQUIPMENT_BOM_ON_FILE: RequiredRule = {
  field: 'equipment_bom_on_file',
  op: 'equals',
  value: true,
};

/**
 * FB-17 (W13-22, provisional): "Advance – capital required" is switched off, so capital is no longer a
 * choice the engineering lead makes at the gate. It follows from the figure: capital is needed when the
 * preliminary capital is above `app_setting.capital_needed_above_usd` (seed 0). The server derives
 * `eng_capital_needed` from the two, and a blank figure counts as needed (fail closed), so:
 * - every G2 Advance needs the preliminary capital figure (enter $0 when no capital is needed);
 * - the equipment BOM is required exactly when capital is needed.
 * Migration 0046 adds both rules in existing environments while the rules still equal the seed.
 */
const PRELIM_CAPITAL_ENTERED: RequiredRule = present('prelim_capital_usd');
const BOM_WHEN_CAPITAL_NEEDED: RequiredRule = {
  anyOf: [{ field: 'eng_capital_needed', op: 'equals', value: false }, EQUIPMENT_BOM_ON_FILE],
};

/**
 * The engineering solution plus capacity evidence needed to say "feasible" (B-10, CR-19). The solution
 * fields are the Engineering Review form's process, machine, plant/site (DF-10: decided by
 * Engineering + Ops + Supply Chain), cavitation and cycle time. Provisional (9/15 interim one-pager);
 * confirm at R2 with Jim Zweifel.
 */
const ENG_FEASIBLE: RequiredRule[] = [
  present('process_type'),
  present('machine_type'),
  present('plant_code'),
  present('cavitation'),
  present('cycle_time_s'),
  { field: 'capacity_evidence', op: 'minItems', value: 1 },
  CAPACITY_SIGNED_OFF,
  CAPACITY_CALCULATED,
  // FB-17 (W13-22): appended, so migration 0046 can extend the stored rule in place.
  PRELIM_CAPITAL_ENTERED,
  BOM_WHEN_CAPITAL_NEEDED,
];

/**
 * G3 Advance to Final Review (B-11, DEC-19/20, CR-26; B-26). Pricing records the approval as a decision,
 * not the pricing math (DEC-23): who approved and when, and a capital readiness status. Pending capital is
 * allowed and needs no note (FB-21: it is the normal state before award); a warning, never a block.
 *
 * B-26 (demo 10/20 and the future-state deck, slides 9/12/17):
 * - no pricing-app reference (ERF / BPR) is required any more: BPR is outside CCQ and ERF is a
 *   transition-only field;
 * - cost before price: the cost sheet must be attested (`costing_completed`) before the price advances;
 * - the price approval is not needed below the pass-through threshold (`pass_through_eligible`, derived
 *   by the server from app_setting `pricing_pass_through`, off until Pricing sets the amount, D-24);
 * - FB-21 removed "a quote flagged capital likely needs pre-approved or not required": only "not
 *   approved" refuses Advance now (`capital_not_approved`, derived by the server).
 * Provisional; confirm at R3 with Gemma Cebolla.
 */
/**
 * FB-07 (D-001, F-032): costing, then ROI, then price confirmation. The pricing lead cannot confirm the
 * price (G3 Advance) until the current costing model is on file and, FB-21, when someone asked Finance
 * for a payback model (`roi_required`), until Finance uploads one after the request (`payback_received`). `cost_model_on_file` / `roi_model_on_file` come from the quote's current
 * attachments; a missing field fails closed. Quotes already in Quoting with costing attested before
 * FB-07 are grandfathered by migration 0031 (`pricing_record.cost_model_requirement`).
 */
const QUOTING_MODELS_ON_FILE: RequiredRule[] = [
  {
    anyOf: [
      { field: 'cost_model_on_file', op: 'equals', value: true },
      { field: 'pricing_record.cost_model_requirement', op: 'equals', value: 'grandfathered' },
    ],
  },
  // FB-21 (N17-21; Ben, 2026-11-18): the payback model only while someone has asked Finance for one,
  // satisfied once Finance uploads one after the request. Migration 0050 updates the stored rule.
  {
    anyOf: [
      { field: 'roi_required', op: 'equals', value: false },
      { field: 'payback_received', op: 'equals', value: true },
    ],
  },
];

const PRICE_APPROVED: RequiredRule[] = [
  {
    anyOf: [
      {
        allOf: [
          present('pricing_record.price_approved_by'),
          present('pricing_record.price_approved_at'),
        ],
      },
      { field: 'pass_through_eligible', op: 'equals', value: true },
    ],
  },
  { field: 'pricing_record.costing_completed', op: 'equals', value: true },
  // FB-21 (N17-19, N17-20; Ben, 2026-11-18): readiness is always filled (a quote entering Quoting starts
  // on app_setting `capital_readiness_default`); "pending" is normal before award and needs no note; only
  // "not approved" (a recommendation to stop) refuses Advance. Migration 0049 updates the stored rule.
  present('pricing_record.capital_readiness'),
  { field: 'capital_not_approved', op: 'equals', value: false },
  ...QUOTING_MODELS_ON_FILE,
];

/**
 * B-26 G4 Advance (deck slide 13): the terms check (tooling commitment, MOQ, payment terms) is recorded,
 * and when a Legal trigger applies (`legal_review_required`, derived by the server from app_setting
 * `legal_review_triggers`, D-25) the Legal review is recorded too. Provisional.
 *
 * FB-01 (F-069, Nov 3 demo): the approver was blocked by fields other roles own. Each check now applies
 * only when app_setting `g4_required_checks` names it (`terms_checked`, `legal_review`); the server
 * derives `g4_terms_check_required` / `g4_legal_review_check_required` from it. The setting is seeded
 * `[]` (provisional; who finalizes terms is D-003), so neither blocks; the Final Review screen shows
 * them as warnings instead. A missing derived field counts as required (fail closed).
 *
 * FB-08 (F-021, F-068): two more checks, both seeded to block (provisional): `terms_exception` (no
 * pending or rejected payment-terms exception) and `terms_finalized` (the approver confirmed the
 * capital terms). Migration 0038 extends the seeded rule in existing environments.
 */
const OFFER_READY: RequiredRule[] = [
  {
    anyOf: [
      { field: 'g4_terms_check_required', op: 'equals', value: false },
      present('terms_checked_at'),
    ],
  },
  {
    anyOf: [
      { field: 'legal_review_required', op: 'equals', value: false },
      { field: 'g4_legal_review_check_required', op: 'equals', value: false },
      present('legal_reviewed_on'),
    ],
  },
  // FB-08 (T-007): non-standard payment terms need the PricingLead's approved exception.
  {
    anyOf: [
      { field: 'g4_terms_exception_check_required', op: 'equals', value: false },
      { field: 'terms_exception_open', op: 'equals', value: false },
    ],
  },
  // FB-08 (F-068, T-031): the approver has confirmed the capital terms.
  {
    anyOf: [
      { field: 'g4_terms_finalized_check_required', op: 'equals', value: false },
      present('terms_finalized_at'),
    ],
  },
];

/**
 * B-26 G6 Advance (Stage 6, deck slide 15): the CER is approved per the official matrix, or not required
 * (G6a, recorded as a reference: no CER integration), and the receiving team accepted the hand-off (G6b,
 * the hand-off record marked complete). Provisional (D-26).
 */
const COMMITTED: RequiredRule[] = [
  {
    field: 'handoff_record.cer_status',
    op: 'oneOf',
    value: ['approved', 'not_required'],
  },
  present('handoff_record.completed_at'),
];

/** B-26 (deck slide 16): every hold names a reason, an owner and a review date. */
const HOLD_FIELDS: RequiredRule[] = [present('review_date'), present('hold_owner_id')];

/**
 * Both defaults and `provisional` are explicit: nothing here is approved by the business yet.
 * FB-17 (W13-23): every outcome names the choice the decision dialog shows it under (`outcomeGroup`).
 */
function outcome(
  gateKey: string,
  key: string,
  label: string,
  outcomeGroup: OutcomeGroup,
  extra: Partial<OutcomeInput> = {},
): OutcomeInput {
  return {
    gateKey,
    key,
    label,
    outcomeGroup,
    helpText: OUTCOME_HELP[`${gateKey}/${key}`] ?? null,
    provisional: true,
    ...extra,
  };
}
function transition(
  gateKey: string,
  outcomeKey: string,
  extra: Omit<Partial<TransitionInput>, 'gateKey' | 'outcomeKey'> &
    Pick<TransitionInput, 'nextStatus'>,
): TransitionInput {
  return { gateKey, outcomeKey, provisional: true, ...extra };
}

/**
 * The seeded hybrid model (architecture §4.1): PRD v1 stages + G1 qualify, capacity evidence,
 * Final Review separate from the customer outcome, reason-coded closures. Every item is provisional.
 *
 * Assumptions to confirm (see 04-decisions-and-risks.md): G1 and G2 Stops close as DECLINED (closeAs
 * `declined`), and so does a G3 Stop (B-11);
 * a G2 Advance proceeds to QUOTING with a preliminary capital figure ($0 when none is needed; FB-17:
 * "Capital required" is switched off and capital needed follows from the figure); a quote on hold is
 * resumed by the next gate decision (Hold keeps it in its stage).
 */
export function buildHybridConfig({ g1Enabled = true }: HybridOptions = {}): WorkflowConfig {
  const closed = { nextStatus: 'closed' } as const;
  const customerClosed = { nextStatus: 'closed', closureOwner: 'kam' } as const;
  const hold = { nextStatus: 'on_hold' } as const;
  const active = { nextStatus: 'active' } as const;

  return parseWorkflowConfig({
    stages: [
      { key: 'INTAKE', label: 'Intake', ownerRole: 'KAM', terminal: false, provisional: true },
      {
        // FB-16 (W13-16, provisional): the stage holds the engineer's review and the production
        // scheduler's capacity work, so the timeline names both. Migration 0045 relabels the row in
        // existing environments while it is still "Engineering Review" and unapproved.
        key: 'ENG_REVIEW',
        label: 'Engineering & Capacity',
        ownerRole: 'EngLead',
        terminal: false,
        provisional: true,
      },
      {
        key: 'QUOTING',
        label: 'Quoting',
        ownerRole: 'Pricing',
        terminal: false,
        provisional: true,
      },
      {
        key: 'FINAL_REVIEW',
        label: 'Final Review',
        ownerRole: 'Approver',
        terminal: false,
        provisional: true,
      },
      {
        key: 'CUSTOMER_DECISION',
        label: 'Customer Decision',
        ownerRole: 'KAM',
        terminal: false,
        provisional: true,
      },
      {
        // B-26 (deck slide 15): an award is not spend authority. The CER and the hand-off are recorded
        // here before the quote closes Won.
        key: 'COMMIT_HANDOFF',
        label: 'Commit & Hand Off',
        ownerRole: 'KAM',
        terminal: false,
        provisional: true,
      },
      // B-26: the key stays AWARDED (RLS, PostAward); the label is the deck's terminal name.
      { key: 'AWARDED', label: 'Closed – Won', terminal: true, provisional: true },
      { key: 'CLOSED_LOST', label: 'Closed Lost', terminal: true, provisional: true },
      { key: 'DECLINED', label: 'Declined', terminal: true, provisional: true },
      { key: 'EXPIRED', label: 'Expired', terminal: true, provisional: true },
      { key: 'REDIRECTED', label: 'Redirected', terminal: true, provisional: true },
      {
        key: 'NOT_AUTHORIZED',
        label: 'Closed – Commitment not authorized',
        terminal: true,
        provisional: true,
      },
    ],
    gates: [
      {
        key: 'G1',
        stageKey: 'INTAKE',
        label: 'Qualify & prioritize',
        deciderPermission: 'gate.G1.decide',
        enabled: g1Enabled,
        // A quote returned for rework is back with the KAM (submitted_at cleared) until they resubmit.
        requiredFields: [present('submitted_at')],
        provisional: true,
      },
      {
        // The no-G1 path: the KAM's submit moves the quote straight to Engineering Review.
        key: 'SUBMIT',
        stageKey: 'INTAKE',
        label: 'Submit to Engineering',
        deciderPermission: 'quote.create',
        enabled: !g1Enabled,
        provisional: true,
      },
      {
        key: 'G2',
        stageKey: 'ENG_REVIEW',
        label: 'Feasible solution?',
        deciderPermission: 'gate.G2.decide',
        provisional: true,
      },
      {
        key: 'G3',
        stageKey: 'QUOTING',
        // FB-07 (D-031, F-081): "Price approved & capital ready" read as clearance to spend and invited
        // POs before a CER existed. Capital readiness stays its own field and panel.
        label: 'Price approved',
        deciderPermission: 'gate.G3.submit',
        provisional: true,
      },
      {
        key: 'G4',
        stageKey: 'FINAL_REVIEW',
        label: 'Release proposition',
        deciderPermission: 'gate.G4.decide',
        provisional: true,
      },
      {
        key: 'G5',
        stageKey: 'CUSTOMER_DECISION',
        label: 'Outcome recorded',
        deciderPermission: 'outcome.record',
        provisional: true,
      },
      {
        key: 'G6',
        stageKey: 'COMMIT_HANDOFF',
        label: 'Commit & hand off',
        deciderPermission: 'gate.G6.decide',
        provisional: true,
      },
    ],
    // B-26: every gate offers the deck's standard outcomes where they apply (slide 18). Labels lead with
    // the standard word; the keys are unchanged so earlier decisions keep their meaning. Each outcome's
    // definition is its admin-editable help text.
    // FB-01 (F-027, D-015: notes are for exceptions only): every exception outcome needs a note:
    // Advance with risk, Hold, every send-back and Stop / Decline. A plain Advance, Approve or Awarded
    // does not.
    // FB-17 (W13-23, W13-24, W13-27; provisional): the decider sees four plain choices, Advance, Send
    // back to…, Hold and Stop, from each outcome's `outcomeGroup`. Rework and Redirect were read as the
    // same thing, so every outcome that sends the work back is in `send_back`, its label says where the
    // quote goes ("Send back to the KAM (fix the intake)"; the dialog's "Send to" list shows the part
    // after "Send back to") and it needs a reason code and a note. G1's "not CCQ work" closes the quote,
    // so it sits under Stop. G5 is the customer's answer (`customer_outcome`) and keeps its flat list.
    // No key or transition changed: analytics and the SQL views read them.
    outcomes: [
      // G1
      outcome('G1', 'advance', 'Advance', 'advance', {
        requiredFields: INTAKE_COMPLETE,
        notify: [{ type: 'quote.ready_for_eng_review', to: { role: 'EngLead' } }],
      }),
      // B-08: Hold needs a reason and a review date; Rework a reason code and a note (the KAM's "what to fix").
      // B-26: and every hold names an owner.
      outcome('G1', 'hold', 'Hold', 'hold', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'hold',
        requiredFields: HOLD_FIELDS,
      }),
      outcome('G1', 'rework', 'Send back to the KAM (fix the intake)', 'send_back', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'rework',
        notify: [{ type: 'quote.reworked', to: { stageOwner: true } }],
      }),
      // FB-17 (W13-23): it closes the quote (REDIRECTED, with its own `redirect` reason codes), so the
      // decider finds it under Stop. Analytics still count it as redirected.
      outcome('G1', 'redirect', 'Stop: not CCQ work (send elsewhere)', 'stop', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'redirect',
        notify: [{ type: 'quote.closed', to: { relation: 'kam' } }],
      }),
      outcome('G1', 'stop', 'Stop', 'stop', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'stop',
        notify: [{ type: 'quote.closed', to: { relation: 'kam' } }],
      }),
      // SUBMIT (no-G1 path)
      outcome('SUBMIT', 'submit', 'Submit', 'advance', {
        requiredFields: INTAKE_COMPLETE,
        notify: [{ type: 'quote.ready_for_eng_review', to: { role: 'EngLead' } }],
      }),
      // G2
      outcome('G2', 'proceed', 'Advance', 'advance', {
        requiredFields: ENG_FEASIBLE,
        notify: [{ type: 'quote.ready_for_quoting', to: { role: 'Pricing' } }],
      }),
      outcome('G2', 'proceed_with_risk', 'Advance with risk', 'advance', {
        requiresNote: true,
        requiredFields: ENG_FEASIBLE,
        notify: [{ type: 'quote.ready_for_quoting', to: { role: 'Pricing' } }],
      }),
      // B-10: "Capital required" needs the preliminary capital figure; Pricing's capital readiness
      // starts as pending (app_setting `capital_readiness_on_outcome`).
      // FB-17 (W13-22): switched off. It is no longer offered or accepted; the row stays so the quotes
      // decided with it keep reading "Advance – capital required" and keep their capital behaviour.
      outcome('G2', 'capital_required', 'Advance – capital required', 'advance', {
        active: false,
        requiresNote: true,
        requiredFields: [
          present('prelim_capital_usd'),
          CAPACITY_SIGNED_OFF,
          EQUIPMENT_BOM_ON_FILE,
          CAPACITY_CALCULATED,
        ],
        notify: [{ type: 'quote.ready_for_quoting', to: { role: 'Pricing' } }],
      }),
      outcome('G2', 'hold', 'Hold', 'hold', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'hold',
        requiredFields: HOLD_FIELDS,
      }),
      // "Return to KAM" from the engineering queue: the note lists the missing information.
      outcome('G2', 'rework', 'Send back to the KAM (fix the intake)', 'send_back', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'rework',
        notify: [{ type: 'quote.reworked', to: { stageOwner: true } }],
      }),
      // B-26 (slide 11): an alternative platform or site. The quote stays In Feasibility; the note says
      // what changes. FB-17 (W13-23): a send-back to Engineering itself, with a rework reason code (the
      // `redirect` context holds G1's not-CCQ codes, which are wrong here).
      outcome(
        'G2',
        'redirect',
        'Send back to Engineering (try another platform or site)',
        'send_back',
        {
          requiresNote: true,
          requiresReasonCode: true,
          reasonContext: 'rework',
        },
      ),
      outcome('G2', 'stop', 'Stop', 'stop', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'stop',
        notify: [{ type: 'quote.closed', to: { relation: 'kam' } }],
      }),
      // G3 (B-11): decider the pricing lead (gate.G3.submit). FB-07 (F-081): the button says what it
      // records, and leads with the standard word (B-26): "Advance – price approved".
      outcome('G3', 'submit', 'Advance – price approved', 'advance', {
        requiredFields: PRICE_APPROVED,
        notify: [{ type: 'quote.ready_for_final_review', to: { role: 'Approver' } }],
      }),
      outcome('G3', 'hold', 'Hold', 'hold', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'hold',
        requiredFields: HOLD_FIELDS,
      }),
      // B-26 (slide 12): Rework is "re-cost" (stays in Quoting; the costing attestation is cleared) or
      // "back to Stage 2 feasibility".
      outcome('G3', 'recost', 'Send back to Pricing (re-cost)', 'send_back', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'rework',
      }),
      outcome('G3', 'rework', 'Send back to Engineering', 'send_back', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'rework',
        notify: [{ type: 'quote.reworked', to: { stageOwner: true } }],
      }),
      // FB-01 (F-029, Kyle Arnold): Pricing sends it to the KAM (missing or wrong commercial input).
      // F-030: the KAM's fix comes straight back to Quoting unless they say the scope changed.
      outcome('G3', 'rework_kam', 'Send back to the KAM', 'send_back', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'rework',
        resumeAt: 'origin',
        notify: [{ type: 'quote.reworked', to: { stageOwner: true } }],
      }),
      // B-26 (slide 12): customer-funded or another capital model. Stays in Quoting. FB-17 (W13-23): a
      // send-back to Pricing itself, with a rework reason code.
      outcome('G3', 'redirect', 'Send back to Pricing (another capital model)', 'send_back', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'rework',
      }),
      outcome('G3', 'stop', 'Stop', 'stop', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'stop',
        notify: [{ type: 'quote.closed', to: { relation: 'kam' } }],
      }),
      // G4 (B-12): the INTERNAL release decision, decider Approver (gate.G4.decide). Approve sets the
      // proposal issue and validity dates (the gate service, from `validity_days_default`); Decline
      // needs a note AND a decline reason (the 10/14 demo rule) and tells the KAM and Pricing.
      // B-26: Advance also needs the terms check and, when triggered, the Legal review.
      outcome('G4', 'approve', 'Advance (release the offer)', 'advance', {
        requiredFields: OFFER_READY,
        notify: [{ type: 'quote.approved_for_customer', to: { relation: 'kam' } }],
      }),
      // B-26 (slide 13): G4 gains Hold.
      outcome('G4', 'hold', 'Hold', 'hold', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'hold',
        requiredFields: HOLD_FIELDS,
      }),
      // FB-17 (W13-23): the decider picks Quoting or Engineering in the same "Send to" list, and every
      // send-back now carries a reason code.
      outcome('G4', 'return', 'Send back to Quoting or Engineering', 'send_back', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'rework',
        notify: [{ type: 'quote.returned', to: { stageOwner: true } }],
      }),
      outcome('G4', 'decline', 'Stop (withdraw)', 'stop', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'decline',
        notify: [
          { type: 'quote.declined', to: { relation: 'kam' } },
          { type: 'quote.declined', to: { role: 'Pricing' } },
        ],
      }),
      // G5 (B-13, CR-37/39): the CUSTOMER outcome, decider the KAM (own quotes) or a SalesLeader
      // (outcome.record). Every closing outcome needs a reason code (CR-39): for Awarded it is the
      // acceptance evidence (verbal award / PO / LOI / contract), with the acceptance date.
      // B-26: Awarded no longer closes the quote; it moves to Commit & Hand Off (Stage 6).
      // FB-17 (W13-23): these are the customer's answer, not the four verbs (`customer_outcome`), so the
      // dialog shows G5 as the flat list it always was. Only "On hold" is a `hold`.
      outcome('G5', 'awarded', 'Awarded', 'customer_outcome', {
        requiresReasonCode: true,
        reasonContext: 'awarded',
        requiredFields: [present('accepted_at')],
      }),
      // B-26 (slides 14, 17): a counter inside the approved range. The KAM negotiates and re-issues;
      // the quote stays in Customer Decision. A counter outside the range is a Re-quote.
      outcome('G5', 'negotiating', 'In negotiation (counter within range)', 'customer_outcome', {
        requiresNote: true,
      }),
      outcome('G5', 'lost', 'Lost', 'customer_outcome', {
        requiresReasonCode: true,
        reasonContext: 'lost',
      }),
      // "Silence is not a loss": its own terminal state, allowed once the validity date has passed, or
      // earlier with a note saying why (e.g. the customer confirmed the project is shelved).
      outcome('G5', 'expired', 'No response / Expired', 'customer_outcome', {
        requiresReasonCode: true,
        reasonContext: 'expired',
        requiredFields: [
          {
            anyOf: [
              { field: 'validity_lapsed', op: 'equals', value: true },
              present('decision_note'),
            ],
          },
        ],
      }),
      // A customer hold stops the cycle-time clock (quote_hold, CR-57).
      outcome('G5', 'on_hold', 'On hold', 'hold', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'hold',
        requiredFields: HOLD_FIELDS,
      }),
      // Back to the affected stage with a version bump; earlier approvals stay as recorded (CR-38).
      outcome('G5', 'requote', 'Re-quote', 'customer_outcome', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'requote',
        notify: [{ type: 'quote.requote', to: { stageOwner: true } }],
      }),
      // G6 (B-26, Stage 6): commitment authorized (CER, as a reference) and the hand-off accepted.
      outcome('G6', 'advance', 'Advance (close Won)', 'advance', {
        requiresReasonCode: true,
        reasonContext: 'awarded',
        requiredFields: COMMITTED,
      }),
      outcome('G6', 'hold', 'Hold (commitment pending)', 'hold', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'hold',
        requiredFields: HOLD_FIELDS,
      }),
      // "Changed since quote?" (scope, volume, resin, site, capacity) → re-quote at the affected gate.
      outcome('G6', 'requote', 'Send back to Quoting or Engineering (re-quote)', 'send_back', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'requote',
        notify: [{ type: 'quote.requote', to: { stageOwner: true } }],
      }),
      outcome('G6', 'stop', 'Stop (commitment not authorized)', 'stop', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'not_authorized',
        notify: [{ type: 'quote.closed', to: { relation: 'kam' } }],
      }),
    ],
    transitions: [
      transition('G1', 'advance', { ...active, targetStageKeys: ['ENG_REVIEW'] }),
      transition('G1', 'hold', hold),
      transition('G1', 'rework', { ...active, targetStageKeys: ['INTAKE'], versionBump: true }),
      transition('G1', 'redirect', {
        ...closed,
        targetStageKeys: ['REDIRECTED'],
        closeAs: 'redirected',
      }),
      // A G1 Stop is an internal "we won't pursue": it closes as DECLINED (B-08), not as a customer loss.
      transition('G1', 'stop', { ...closed, targetStageKeys: ['DECLINED'], closeAs: 'declined' }),
      transition('SUBMIT', 'submit', { ...active, targetStageKeys: ['ENG_REVIEW'] }),
      transition('G2', 'proceed', { ...active, targetStageKeys: ['QUOTING'] }),
      transition('G2', 'proceed_with_risk', { ...active, targetStageKeys: ['QUOTING'] }),
      transition('G2', 'capital_required', { ...active, targetStageKeys: ['QUOTING'] }),
      transition('G2', 'hold', hold),
      transition('G2', 'rework', { ...active, targetStageKeys: ['INTAKE'], versionBump: true }),
      transition('G2', 'redirect', active),
      // B-10: an engineering Stop is an internal "we won't pursue", like G1's: DECLINED, not a customer loss.
      transition('G2', 'stop', { ...closed, targetStageKeys: ['DECLINED'], closeAs: 'declined' }),
      transition('G3', 'submit', { ...active, targetStageKeys: ['FINAL_REVIEW'] }),
      transition('G3', 'hold', hold),
      transition('G3', 'recost', active),
      transition('G3', 'rework', { ...active, targetStageKeys: ['ENG_REVIEW'], versionBump: true }),
      transition('G3', 'rework_kam', { ...active, targetStageKeys: ['INTAKE'], versionBump: true }),
      transition('G3', 'redirect', active),
      // B-11: a Pricing Stop is an internal "won't pursue", like G1/G2: DECLINED, not a customer loss.
      transition('G3', 'stop', { ...closed, targetStageKeys: ['DECLINED'], closeAs: 'declined' }),
      transition('G4', 'approve', { ...active, targetStageKeys: ['CUSTOMER_DECISION'] }),
      transition('G4', 'hold', hold),
      transition('G4', 'decline', {
        ...closed,
        targetStageKeys: ['DECLINED'],
        closeAs: 'declined',
      }),
      transition('G4', 'return', {
        ...active,
        targetStageKeys: ['QUOTING', 'ENG_REVIEW'],
        versionBump: true,
      }),
      // B-26: an award moves to Commit & Hand Off; the quote closes Won at G6.
      transition('G5', 'awarded', { ...active, targetStageKeys: ['COMMIT_HANDOFF'] }),
      transition('G5', 'negotiating', active),
      // B-13: a customer outcome's closure owner defaults to the KAM (CR-39; a SalesLeader may name
      // another); internal no-gos default to the decider.
      transition('G5', 'lost', {
        ...customerClosed,
        targetStageKeys: ['CLOSED_LOST'],
        closeAs: 'lost',
      }),
      transition('G5', 'expired', {
        ...customerClosed,
        targetStageKeys: ['EXPIRED'],
        closeAs: 'expired',
      }),
      transition('G5', 'on_hold', hold),
      transition('G5', 'requote', {
        ...active,
        targetStageKeys: ['QUOTING', 'ENG_REVIEW'],
        versionBump: true,
      }),
      transition('G6', 'advance', {
        ...customerClosed,
        targetStageKeys: ['AWARDED'],
        closeAs: 'awarded',
      }),
      transition('G6', 'hold', hold),
      transition('G6', 'requote', {
        ...active,
        targetStageKeys: ['QUOTING', 'ENG_REVIEW'],
        versionBump: true,
      }),
      transition('G6', 'stop', {
        ...closed,
        targetStageKeys: ['NOT_AUTHORIZED'],
        closeAs: 'not_authorized',
      }),
    ],
    reasonCodes: SEED_REASON_CODES,
    segregation: [
      {
        id: 'g1-kam-cannot-qualify-own',
        gateKeys: ['G1'],
        deny: 'actor_is_kam',
        message: 'You cannot qualify an opportunity you own as KAM',
        provisional: true,
      },
      {
        id: 'g4-kam-cannot-approve-own',
        gateKeys: ['G4'],
        deny: 'actor_is_kam',
        message: 'You cannot decide Final Review on a quote where you are the KAM',
        provisional: true,
      },
      {
        // B-11: Pricing approves the price; it never also releases the proposition (G4).
        id: 'g4-price-approver-cannot-release',
        gateKeys: ['G4'],
        deny: 'actor_is_price_approver',
        message: 'You cannot decide Final Review on a quote whose price you approved or submitted',
        provisional: true,
      },
    ],
  } satisfies WorkflowConfigInput);
}

/** The default seed: G1 enabled. */
export const hybridConfig: WorkflowConfig = buildHybridConfig();
