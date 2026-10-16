import type {
  RequiredRule,
  WorkflowConfig,
  WorkflowConfigInput,
} from '../../types/workflow-config';
import { parseWorkflowConfig } from '../validate-config';
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
];

/**
 * G3 Submit to Final Review (B-11, DEC-19/20, CR-26). Pricing records the approval as a decision, not
 * the pricing math (DEC-23): who approved and when, at least one pricing-app reference (ERF / BPR) or
 * an explicit "no pricing-app record yet" note, and a capital readiness status. Pending capital is
 * allowed with a justification (D-11 open, so it is a warning on the decision, not a block).
 * Provisional; confirm at R3 with Gemma Cebolla.
 */
const PRICE_APPROVED: RequiredRule[] = [
  present('pricing_record.price_approved_by'),
  present('pricing_record.price_approved_at'),
  {
    anyOf: [
      { field: 'pricing_record.pricing_refs.erf', op: 'minItems', value: 1 },
      { field: 'pricing_record.pricing_refs.bpr', op: 'minItems', value: 1 },
      present('pricing_record.no_pricing_app_record_note'),
    ],
  },
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
];

/** Both defaults and `provisional` are explicit: nothing here is approved by the business yet. */
function outcome(
  gateKey: string,
  key: string,
  label: string,
  extra: Partial<OutcomeInput> = {},
): OutcomeInput {
  return { gateKey, key, label, provisional: true, ...extra };
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
      { key: 'AWARDED', label: 'Awarded', terminal: true, provisional: true },
      { key: 'CLOSED_LOST', label: 'Closed Lost', terminal: true, provisional: true },
      { key: 'DECLINED', label: 'Declined', terminal: true, provisional: true },
      { key: 'EXPIRED', label: 'Expired', terminal: true, provisional: true },
      { key: 'REDIRECTED', label: 'Redirected', terminal: true, provisional: true },
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
    ],
    outcomes: [
      // G1
      outcome('G1', 'advance', 'Advance', {
        requiredFields: INTAKE_COMPLETE,
        notify: [{ type: 'quote.ready_for_eng_review', to: { role: 'EngLead' } }],
      }),
      // B-08: Hold needs a reason and a review date; Rework a reason code and a note (the KAM's "what to fix").
      outcome('G1', 'hold', 'Hold', {
        requiresReasonCode: true,
        reasonContext: 'hold',
        requiredFields: [present('review_date')],
      }),
      outcome('G1', 'rework', 'Rework (back to draft)', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'rework',
        notify: [{ type: 'quote.reworked', to: { stageOwner: true } }],
      }),
      outcome('G1', 'redirect', 'Redirect', {
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
      outcome('G2', 'proceed', 'Proceed', {
        requiredFields: ENG_FEASIBLE,
        notify: [{ type: 'quote.ready_for_quoting', to: { role: 'Pricing' } }],
      }),
      outcome('G2', 'proceed_with_risk', 'Proceed with risk', {
        requiresNote: true,
        requiredFields: ENG_FEASIBLE,
        notify: [{ type: 'quote.ready_for_quoting', to: { role: 'Pricing' } }],
      }),
      // B-10: "Capital required" needs the preliminary capital figure; Pricing's capital readiness
      // starts as pending (app_setting `capital_readiness_on_outcome`).
      outcome('G2', 'capital_required', 'Capital required', {
        requiredFields: [present('prelim_capital_usd')],
        notify: [{ type: 'quote.ready_for_quoting', to: { role: 'Pricing' } }],
      }),
      outcome('G2', 'hold', 'Hold', {
        requiresReasonCode: true,
        reasonContext: 'hold',
        requiredFields: [present('review_date')],
      }),
      // "Return to KAM" from the engineering queue: the note lists the missing information.
      outcome('G2', 'rework', 'Rework (back to KAM)', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'rework',
        notify: [{ type: 'quote.reworked', to: { stageOwner: true } }],
      }),
      outcome('G2', 'stop', 'Stop', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'stop',
        notify: [{ type: 'quote.closed', to: { relation: 'kam' } }],
      }),
      // G3 (B-11): decider Pricing (gate.G3.submit).
      outcome('G3', 'submit', 'Submit to Final Review', {
        requiredFields: PRICE_APPROVED,
        notify: [{ type: 'quote.ready_for_final_review', to: { role: 'Approver' } }],
      }),
      outcome('G3', 'hold', 'Hold', {
        requiresReasonCode: true,
        reasonContext: 'hold',
        requiredFields: [present('review_date')],
      }),
      outcome('G3', 'rework', 'Rework (back to Engineering)', {
        requiresReasonCode: true,
        reasonContext: 'rework',
        notify: [{ type: 'quote.reworked', to: { stageOwner: true } }],
      }),
      outcome('G3', 'stop', 'Stop', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'stop',
        notify: [{ type: 'quote.closed', to: { relation: 'kam' } }],
      }),
      // G4
      outcome('G4', 'approve', 'Approve', {
        notify: [{ type: 'quote.approved_for_customer', to: { relation: 'kam' } }],
      }),
      outcome('G4', 'decline', 'Decline', {
        requiresNote: true,
        requiresReasonCode: true,
        reasonContext: 'decline',
        notify: [{ type: 'quote.declined', to: { relation: 'kam' } }],
      }),
      outcome('G4', 'return', 'Return', {
        requiresNote: true,
        reasonContext: 'rework',
        notify: [{ type: 'quote.returned', to: { stageOwner: true } }],
      }),
      // G5
      outcome('G5', 'awarded', 'Awarded'),
      outcome('G5', 'lost', 'Lost', { requiresReasonCode: true, reasonContext: 'lost' }),
      outcome('G5', 'expired', 'No response / Expired', {
        requiresReasonCode: true,
        reasonContext: 'expired',
      }),
      outcome('G5', 'on_hold', 'On hold', {
        reasonContext: 'hold',
        requiredFields: [present('review_date')],
      }),
      outcome('G5', 'requote', 'Re-quote', {
        reasonContext: 'requote',
        notify: [{ type: 'quote.requote', to: { stageOwner: true } }],
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
      // B-10: an engineering Stop is an internal "we won't pursue", like G1's: DECLINED, not a customer loss.
      transition('G2', 'stop', { ...closed, targetStageKeys: ['DECLINED'], closeAs: 'declined' }),
      transition('G3', 'submit', { ...active, targetStageKeys: ['FINAL_REVIEW'] }),
      transition('G3', 'hold', hold),
      transition('G3', 'rework', { ...active, targetStageKeys: ['ENG_REVIEW'], versionBump: true }),
      // B-11: a Pricing Stop is an internal "won't pursue", like G1/G2: DECLINED, not a customer loss.
      transition('G3', 'stop', { ...closed, targetStageKeys: ['DECLINED'], closeAs: 'declined' }),
      transition('G4', 'approve', { ...active, targetStageKeys: ['CUSTOMER_DECISION'] }),
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
      transition('G5', 'awarded', { ...closed, targetStageKeys: ['AWARDED'], closeAs: 'awarded' }),
      transition('G5', 'lost', { ...closed, targetStageKeys: ['CLOSED_LOST'], closeAs: 'lost' }),
      transition('G5', 'expired', { ...closed, targetStageKeys: ['EXPIRED'], closeAs: 'expired' }),
      transition('G5', 'on_hold', hold),
      transition('G5', 'requote', {
        ...active,
        targetStageKeys: ['QUOTING', 'ENG_REVIEW'],
        versionBump: true,
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
