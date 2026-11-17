import { LEAD_REVIEW, LEAD_REVIEW_KINDS, type LeadReviewKind } from '../lead-review';
import { rolesWithPermission } from '../policy/matrix';
import type { QuoteStatus } from '../types/quote';
import type { Role } from '../types/roles';
import type { GateDefinition, WorkflowConfig } from '../types/workflow-config';

/**
 * UX-002 (2026-11-17): "whose move is it" on a quote. Who the quote is waiting on, in what state, and
 * whether the reader is the one to act. A structured answer, never a sentence: the web words it, with
 * the gate's label from the workflow config.
 *
 * It is worked out from what the server already knows and would enforce: the stage's enabled gate and
 * who may decide it (the permission matrix), the lead-review round, the assignment, the rework and the
 * hold. `yourMove` is true only when the reader is the one waited on AND the server would accept their
 * move, so the line never offers what a route would refuse.
 */
export const NEXT_STEP_PARTIES = [
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
export type NextStepParty = (typeof NEXT_STEP_PARTIES)[number];

export const NEXT_STEP_STATES = [
  /** Back with the KAM, sent back at a gate, until they resubmit. */
  'rework',
  /** In Engineering or Quoting with nobody assigned yet. */
  'unassigned',
  /** Someone is doing their part (the assignee; Finance for the payback model). */
  'in_progress',
  /** The assignee submitted to their lead, who reviews and decides the gate. */
  'with_lead',
  /** Waiting for the stage's gate decision. */
  'at_gate',
  'on_hold',
  'closed',
] as const;
export type NextStepState = (typeof NEXT_STEP_STATES)[number];

/** Where the next step is done: the intake wizard, a work tab of the quote, or the gate's decision. */
export const NEXT_STEP_PLACES = ['intake', 'engineering', 'quoting', 'decision'] as const;
export type NextStepPlace = (typeof NEXT_STEP_PLACES)[number];

export interface NextStepHold {
  /** `YYYY-MM-DD`. */
  reviewDate: string | null;
  ownerName: string | null;
  reasonLabel: string | null;
}

export interface NextStep {
  waitingOn: NextStepParty;
  /** The person waited on, when the quote names one (its KAM, the assigned engineer or pricer). */
  personName: string | null;
  state: NextStepState;
  /** When the quote entered this state, when known: the send-back (rework), the submit (with_lead). */
  since: string | null;
  /** The enabled gate of the quote's stage: what is decided next. Null when closed or the stage has none. */
  gateKey: string | null;
  place: NextStepPlace | null;
  /** The reader is the one waited on, and the server would accept their move now. */
  yourMove: boolean;
  /** Only while on hold. */
  hold: NextStepHold | null;
}

/** One lead-reviewed part (Engineering, Quoting) as the quote detail already reports it for the reader. */
export interface NextStepWork {
  assigneeId: string | null;
  assigneeName: string | null;
  /** When the assignee submitted to the lead; null when it is not waiting on the lead. */
  submittedAt: string | null;
  /** What the server would accept from the reader: assigning, editing the part, reviewing as the lead. */
  canAssign: boolean;
  canWork: boolean;
  canReview: boolean;
}

export interface NextStepFacts {
  stageKey: string;
  status: QuoteStatus;
  readerId: string;
  readerRoles: readonly Role[];
  kam: { id: string; name: string | null };
  /** When the quote was sent back to the KAM; null unless it is waiting for their resubmission. */
  reworkSince: string | null;
  /** The current hold; read only while the status is `on_hold`. */
  hold: NextStepHold | null;
  work: Readonly<Record<LeadReviewKind, NextStepWork>>;
  /** Quoting's payback (ROI) step is the one waiting, and whether the reader, as its owner, may upload it. */
  payback: { waiting: boolean; canUpload: boolean };
  /** Gates the reader is offered here with at least one outcome that nothing blocks. */
  decidableGateKeys: readonly string[];
}

/** Admin and PostAward act for support or after the award: a quote never waits on them. */
const ROLE_PARTY: Readonly<Partial<Record<Role, NextStepParty>>> = {
  KAM: 'kam',
  SalesLeader: 'sales_leader',
  EngLead: 'engineering_lead',
  Engineer: 'engineering',
  ProductionScheduler: 'engineering',
  Pricing: 'pricing',
  PricingLead: 'pricing_lead',
  Finance: 'finance',
  Approver: 'approver',
  Leadership: 'leadership',
};

/** The party of the first role that has one (the matrix lists a permission's main role first). */
export function partyOfRoles(roles: readonly Role[]): NextStepParty {
  for (const role of roles) {
    const party = ROLE_PARTY[role];
    if (party) return party;
  }
  return 'nobody';
}

const deciderParty = (gate: GateDefinition): NextStepParty =>
  partyOfRoles(rolesWithPermission(gate.deciderPermission));

const PLACE: Record<LeadReviewKind, NextStepPlace> = {
  engineering: 'engineering',
  pricing: 'quoting',
};

export function nextStep(config: WorkflowConfig, facts: NextStepFacts): NextStep {
  const gate = config.gates.find((g) => g.enabled && g.stageKey === facts.stageKey) ?? null;
  const base = {
    personName: null,
    since: null,
    gateKey: gate?.key ?? null,
    place: null,
    yourMove: false,
    hold: null,
  } satisfies Partial<NextStep>;
  const inParty = (party: NextStepParty) =>
    facts.readerRoles.some((role) => ROLE_PARTY[role] === party);
  const stageOwner = config.stages.find((s) => s.key === facts.stageKey)?.ownerRole;
  const ownerParty = stageOwner ? partyOfRoles([stageOwner]) : 'nobody';

  if (facts.status === 'closed') {
    return { ...base, waitingOn: 'nobody', state: 'closed', gateKey: null };
  }

  // A hold ends when the stage's gate is decided again, so it waits on whoever decides it.
  if (facts.status === 'on_hold') {
    return {
      ...base,
      waitingOn: gate ? deciderParty(gate) : ownerParty,
      state: 'on_hold',
      hold: facts.hold ?? { reviewDate: null, ownerName: null, reasonLabel: null },
    };
  }

  if (facts.reworkSince) {
    return {
      ...base,
      waitingOn: 'kam',
      personName: facts.kam.name,
      state: 'rework',
      since: facts.reworkSince,
      place: 'intake',
      yourMove: facts.readerId === facts.kam.id,
    };
  }

  const kind = LEAD_REVIEW_KINDS.find((k) => LEAD_REVIEW[k].stageKey === facts.stageKey);
  if (kind) {
    const spec = LEAD_REVIEW[kind];
    const work = facts.work[kind];
    const leadRoles = rolesWithPermission(spec.leadPermission);
    const lead = partyOfRoles(leadRoles);
    const workers = partyOfRoles(
      rolesWithPermission(spec.workPermission).filter((role) => !leadRoles.includes(role)),
    );
    const place = PLACE[kind];
    // Costing, then the payback model, then the price: while the payback step waits, Finance is next.
    if (kind === 'pricing' && facts.payback.waiting) {
      return {
        ...base,
        waitingOn: 'finance',
        state: 'in_progress',
        place,
        yourMove: facts.payback.canUpload && inParty('finance'),
      };
    }
    if (!work.assigneeId) {
      return {
        ...base,
        waitingOn: lead,
        state: 'unassigned',
        place,
        yourMove: work.canAssign && inParty(lead),
      };
    }
    if (work.submittedAt) {
      return {
        ...base,
        waitingOn: lead,
        state: 'with_lead',
        since: work.submittedAt,
        place,
        yourMove: work.canReview && inParty(lead),
      };
    }
    return {
      ...base,
      waitingOn: workers,
      personName: work.assigneeName,
      state: 'in_progress',
      place,
      yourMove: work.assigneeId === facts.readerId && work.canWork,
    };
  }

  if (gate) {
    // A gate whose outcomes are the customer's answer waits on the customer; the decider records it.
    const customer = config.outcomes.some(
      (o) => o.gateKey === gate.key && o.active && o.outcomeGroup === 'customer_outcome',
    );
    const party = customer ? 'customer' : deciderParty(gate);
    const named = party === 'kam';
    const readerIsParty = named ? facts.readerId === facts.kam.id : inParty(party);
    return {
      ...base,
      waitingOn: party,
      personName: named ? facts.kam.name : null,
      state: 'at_gate',
      place: 'decision',
      yourMove: !customer && readerIsParty && facts.decidableGateKeys.includes(gate.key),
    };
  }

  // A stage with no gate: its owner works it.
  return { ...base, waitingOn: ownerParty, state: 'in_progress' };
}
