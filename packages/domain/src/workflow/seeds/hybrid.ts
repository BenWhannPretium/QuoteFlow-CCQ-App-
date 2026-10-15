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

/** Engineering evidence needed to say "feasible" (CR-19 capacity evidence). */
const ENG_FEASIBLE: RequiredRule[] = [
  present('process_type'),
  present('plant_code'),
  { field: 'capacity_evidence', op: 'minItems', value: 1 },
];

const PRICE_APPROVED: RequiredRule[] = [
  present('pricing_record.price_approved_by'),
  present('pricing_record.price_approved_at'),
  present('pricing_record.capital_readiness'),
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
 * Assumptions to confirm (see 04-decisions-and-risks.md): Stop closes as CLOSED_LOST (closeAs `stopped`);
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
      outcome('G1', 'hold', 'Hold', { reasonContext: 'hold' }),
      outcome('G1', 'rework', 'Rework (back to draft)', {
        requiresNote: true,
        reasonContext: 'rework',
        notify: [{ type: 'quote.reworked', to: { stageOwner: true } }],
      }),
      outcome('G1', 'redirect', 'Redirect', {
        requiresReasonCode: true,
        reasonContext: 'redirect',
        notify: [{ type: 'quote.closed', to: { relation: 'kam' } }],
      }),
      outcome('G1', 'stop', 'Stop', {
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
      outcome('G2', 'capital_required', 'Capital required', {
        requiredFields: [...ENG_FEASIBLE, present('prelim_capital_usd')],
        notify: [{ type: 'quote.ready_for_quoting', to: { role: 'Pricing' } }],
      }),
      outcome('G2', 'hold', 'Hold', { reasonContext: 'hold' }),
      outcome('G2', 'rework', 'Rework (back to KAM)', {
        requiresNote: true,
        reasonContext: 'rework',
        notify: [{ type: 'quote.reworked', to: { stageOwner: true } }],
      }),
      outcome('G2', 'stop', 'Stop', {
        requiresReasonCode: true,
        reasonContext: 'stop',
        notify: [{ type: 'quote.closed', to: { relation: 'kam' } }],
      }),
      // G3
      outcome('G3', 'submit', 'Submit to Final Review', {
        requiredFields: PRICE_APPROVED,
        notify: [{ type: 'quote.ready_for_final_review', to: { role: 'Approver' } }],
      }),
      outcome('G3', 'hold', 'Hold', { reasonContext: 'hold' }),
      outcome('G3', 'rework', 'Rework (back to Engineering)', {
        requiresNote: true,
        reasonContext: 'rework',
        notify: [{ type: 'quote.reworked', to: { stageOwner: true } }],
      }),
      outcome('G3', 'stop', 'Stop', {
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
      transition('G1', 'stop', { ...closed, targetStageKeys: ['CLOSED_LOST'], closeAs: 'stopped' }),
      transition('SUBMIT', 'submit', { ...active, targetStageKeys: ['ENG_REVIEW'] }),
      transition('G2', 'proceed', { ...active, targetStageKeys: ['QUOTING'] }),
      transition('G2', 'proceed_with_risk', { ...active, targetStageKeys: ['QUOTING'] }),
      transition('G2', 'capital_required', { ...active, targetStageKeys: ['QUOTING'] }),
      transition('G2', 'hold', hold),
      transition('G2', 'rework', { ...active, targetStageKeys: ['INTAKE'], versionBump: true }),
      transition('G2', 'stop', { ...closed, targetStageKeys: ['CLOSED_LOST'], closeAs: 'stopped' }),
      transition('G3', 'submit', { ...active, targetStageKeys: ['FINAL_REVIEW'] }),
      transition('G3', 'hold', hold),
      transition('G3', 'rework', { ...active, targetStageKeys: ['ENG_REVIEW'], versionBump: true }),
      transition('G3', 'stop', { ...closed, targetStageKeys: ['CLOSED_LOST'], closeAs: 'stopped' }),
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
    ],
  } satisfies WorkflowConfigInput);
}

/** The default seed: G1 enabled. */
export const hybridConfig: WorkflowConfig = buildHybridConfig();
