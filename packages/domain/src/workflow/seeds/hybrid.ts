import type {
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

/** Minimum intake set (D-05, provisional): blocking fields before a quote can leave INTAKE. */
const INTAKE_COMPLETE: RequiredRule[] = [
  present('sf_opportunity_id'),
  present('customer_id'),
  present('product_family'),
  present('resin'),
  { anyOf: [present('est_annual_volume'), present('est_annual_revenue')] },
];

/**
 * B-26 (deck slide 11): the capacity owner signs off at G2 and can block. Owner TBD (D-07); the
 * permission `capacity.signoff` is seeded to the EngLead, provisional.
 */
const CAPACITY_SIGNED_OFF: RequiredRule = {
  field: 'capacity_signoff_status',
  op: 'equals',
  value: 'approved',
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
];

/**
 * G3 Advance to Final Review (B-11, DEC-19/20, CR-26; B-26). Pricing records the approval as a decision,
 * not the pricing math (DEC-23): who approved and when, and a capital readiness status. Pending capital is
 * allowed with a justification (D-11 open, so it is a warning on the decision, not a block).
 *
 * B-26 (demo 10/20 and the future-state deck, slides 9/12/17):
 * - no pricing-app reference (ERF / BPR) is required any more: BPR is outside CCQ and ERF is a
 *   transition-only field;
 * - cost before price: the cost sheet must be attested (`costing_completed`) before the price advances;
 * - the price approval is not needed below the pass-through threshold (`pass_through_eligible`, derived
 *   by the server from app_setting `pricing_pass_through`, off until Pricing sets the amount, D-24);
 * - a quote flagged "capital likely" at Stage 1 needs capital readiness confirmed (pre-approved, or
 *   not required after all), not pending.
 * Provisional; confirm at R3 with Gemma Cebolla.
 */
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
  present('pricing_record.capital_readiness'),
  {
    anyOf: [
      {
        field: 'pricing_record.capital_readiness',
        op: 'oneOf',
        value: ['not_required', 'pre_approved', 'not_approved'],
      },
      present('pricing_record.capital_pending_justification'),
    ],
  },
  {
    anyOf: [
      { field: 'capital_likely', op: 'equals', value: false },
      {
        field: 'pricing_record.capital_readiness',
        op: 'oneOf',
        value: ['not_required', 'pre_approved'],
      },
    ],
  },
];

/**
 * B-26 G4 Advance (deck slide 13): the terms check (tooling commitment, MOQ, payment terms) is recorded,
 * and when a Legal trigger applies (`legal_review_required`, derived by the server from app_setting
 * `legal_review_triggers`, D-25) the Legal review is recorded too. Provisional.
 */
const OFFER_READY: RequiredRule[] = [
  present('terms_checked_at'),
  {
    anyOf: [
      { field: 'legal_review_required', op: 'equals', value: false },
      present('legal_reviewed_on'),
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

/** Both defaults and `provisional` are explicit: nothing here is approved by the business yet. */
function outcome(
  gateKey: string,
  key: string,
  label: string,
  extra: Partial<OutcomeInput> = {},
): OutcomeInput {
  return {
    gateKey,
    key,
    label,
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
 * "Capital required" at G2 proceeds to QUOTING with a preliminary capital figure; a quote on hold is
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
        key: 'ENG_REVIEW',
        label: 'Engineering Review',
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
        label: 'Price approved & capital ready',
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
    // B-26: every gate offers the deck's standard outcomes where they apply (slide 18): Advance, Hold,
    // Rework, Redirect, Stop. Labels lead with the standard word; the keys are unchanged so earlier
    // decisions keep their meaning. Each outcome's definition is its admin-editable help text.
    outcomes: [
      // G1
      outcome('G1', 'advance', 'Advance', {
        requiredFields: INTAKE_COMPLETE,
        notify: [{ type: 'quote.ready_for_eng_review', to: { role: 'EngLead' } }],
      }),
      // B-08: Hold needs a reason and a review date; Rework a reason code and a note (the KAM's "what to fix").
      // B-26: and every hold names an owner.
      outcome('G1', 'hold', 'Hold', {
        requiresReasonCode: true,
        reasonContext: 'hold',
        requiredFields: HOLD_FIELDS,
      }),
      outcome('G1', 'rework', 'Rework (back to KAM)', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'rework',
        notify: [{ type: 'quote.reworked', to: { stageOwner: true } }],
      }),
      outcome('G1', 'redirect', 'Redirect (not CCQ work)', {
        requiresReasonCode: true,
        reasonContext: 'redirect',
        notify: [{ type: 'quote.closed', to: { relation: 'kam' } }],
      }),
      outcome('G1', 'stop', 'Stop', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'stop',
        notify: [{ type: 'quote.closed', to: { relation: 'kam' } }],
      }),
      // SUBMIT (no-G1 path)
      outcome('SUBMIT', 'submit', 'Submit', {
        requiredFields: INTAKE_COMPLETE,
        notify: [{ type: 'quote.ready_for_eng_review', to: { role: 'EngLead' } }],
      }),
      // G2
      outcome('G2', 'proceed', 'Advance', {
        requiredFields: ENG_FEASIBLE,
        notify: [{ type: 'quote.ready_for_quoting', to: { role: 'Pricing' } }],
      }),
      outcome('G2', 'proceed_with_risk', 'Advance with risk', {
        requiresNote: true,
        requiredFields: ENG_FEASIBLE,
        notify: [{ type: 'quote.ready_for_quoting', to: { role: 'Pricing' } }],
      }),
      // B-10: "Capital required" needs the preliminary capital figure; Pricing's capital readiness
      // starts as pending (app_setting `capital_readiness_on_outcome`).
      outcome('G2', 'capital_required', 'Advance – capital required', {
        requiredFields: [present('prelim_capital_usd'), CAPACITY_SIGNED_OFF],
        notify: [{ type: 'quote.ready_for_quoting', to: { role: 'Pricing' } }],
      }),
      outcome('G2', 'hold', 'Hold', {
        requiresReasonCode: true,
        reasonContext: 'hold',
        requiredFields: HOLD_FIELDS,
      }),
      // "Return to KAM" from the engineering queue: the note lists the missing information.
      outcome('G2', 'rework', 'Rework (back to KAM)', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'rework',
        notify: [{ type: 'quote.reworked', to: { stageOwner: true } }],
      }),
      // B-26 (slide 11): an alternative platform or site. The quote stays In Feasibility; the note says
      // what changes.
      outcome('G2', 'redirect', 'Redirect (alternative platform / site)', {
        requiresNote: true,
      }),
      outcome('G2', 'stop', 'Stop', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'stop',
        notify: [{ type: 'quote.closed', to: { relation: 'kam' } }],
      }),
      // G3 (B-11): decider Pricing (gate.G3.submit).
      outcome('G3', 'submit', 'Advance to Final Review', {
        requiredFields: PRICE_APPROVED,
        notify: [{ type: 'quote.ready_for_final_review', to: { role: 'Approver' } }],
      }),
      outcome('G3', 'hold', 'Hold', {
        requiresReasonCode: true,
        reasonContext: 'hold',
        requiredFields: HOLD_FIELDS,
      }),
      // B-26 (slide 12): Rework is "re-cost" (stays in Quoting; the costing attestation is cleared) or
      // "back to Stage 2 feasibility".
      outcome('G3', 'recost', 'Rework (re-cost)', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'rework',
      }),
      outcome('G3', 'rework', 'Rework (back to Engineering)', {
        requiresReasonCode: true,
        reasonContext: 'rework',
        notify: [{ type: 'quote.reworked', to: { stageOwner: true } }],
      }),
      // B-26 (slide 12): customer-funded or another capital model. Stays in Quoting.
      outcome('G3', 'redirect', 'Redirect (alternative capital model)', {
        requiresNote: true,
      }),
      outcome('G3', 'stop', 'Stop', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'stop',
        notify: [{ type: 'quote.closed', to: { relation: 'kam' } }],
      }),
      // G4 (B-12): the INTERNAL release decision, decider Approver (gate.G4.decide). Approve sets the
      // proposal issue and validity dates (the gate service, from `validity_days_default`); Decline
      // needs a note AND a decline reason (the 10/14 demo rule) and tells the KAM and Pricing.
      // B-26: Advance also needs the terms check and, when triggered, the Legal review.
      outcome('G4', 'approve', 'Advance (release the offer)', {
        requiredFields: OFFER_READY,
        notify: [{ type: 'quote.approved_for_customer', to: { relation: 'kam' } }],
      }),
      // B-26 (slide 13): G4 gains Hold.
      outcome('G4', 'hold', 'Hold', {
        requiresReasonCode: true,
        reasonContext: 'hold',
        requiredFields: HOLD_FIELDS,
      }),
      outcome('G4', 'return', 'Rework (back to the affected gate)', {
        requiresNote: true,
        reasonContext: 'rework',
        notify: [{ type: 'quote.returned', to: { stageOwner: true } }],
      }),
      outcome('G4', 'decline', 'Stop (withdraw)', {
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
      outcome('G5', 'awarded', 'Awarded', {
        requiresReasonCode: true,
        reasonContext: 'awarded',
        requiredFields: [present('accepted_at')],
      }),
      // B-26 (slides 14, 17): a counter inside the approved range. The KAM negotiates and re-issues;
      // the quote stays in Customer Decision. A counter outside the range is a Re-quote.
      outcome('G5', 'negotiating', 'In negotiation (counter within range)', {
        requiresNote: true,
      }),
      outcome('G5', 'lost', 'Lost', { requiresReasonCode: true, reasonContext: 'lost' }),
      // "Silence is not a loss": its own terminal state, allowed once the validity date has passed, or
      // earlier with a note saying why (e.g. the customer confirmed the project is shelved).
      outcome('G5', 'expired', 'No response / Expired', {
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
      outcome('G5', 'on_hold', 'On hold', {
        requiresReasonCode: true,
        reasonContext: 'hold',
        requiredFields: HOLD_FIELDS,
      }),
      // Back to the affected stage with a version bump; earlier approvals stay as recorded (CR-38).
      outcome('G5', 'requote', 'Re-quote', {
        requiresReasonCode: true,
        reasonContext: 'requote',
        notify: [{ type: 'quote.requote', to: { stageOwner: true } }],
      }),
      // G6 (B-26, Stage 6): commitment authorized (CER, as a reference) and the hand-off accepted.
      outcome('G6', 'advance', 'Advance (close Won)', {
        requiresReasonCode: true,
        reasonContext: 'awarded',
        requiredFields: COMMITTED,
      }),
      outcome('G6', 'hold', 'Hold (commitment pending)', {
        requiresReasonCode: true,
        reasonContext: 'hold',
        requiredFields: HOLD_FIELDS,
      }),
      // "Changed since quote?" (scope, volume, resin, site, capacity) → re-quote at the affected gate.
      outcome('G6', 'requote', 'Rework (re-quote)', {
        requiresReasonCode: true,
        reasonContext: 'requote',
        notify: [{ type: 'quote.requote', to: { stageOwner: true } }],
      }),
      outcome('G6', 'stop', 'Stop (commitment not authorized)', {
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
