import { describe, expect, it } from 'vitest';

import {
  HANDOFF_TYPES,
  classifyHandoff,
  planCommentRecipients,
  planLeadReturned,
  planLeadSubmitted,
  planMoveNotifications,
  planResume,
  planTermsExceptionDecided,
  planTermsExceptionRequested,
  resolveDeliveries,
  rolesIn,
  stageLeadRoles,
  type Delivery,
  type MoveNotifyInput,
} from './recipients';
import { rolesWithPermission } from '../policy/matrix';
import { KAM_ID, NOW, makeActor, makeQuote, validCase } from '../test-utils';
import { asUserId } from '../types/ids';
import type { Role } from '../types/roles';
import { evaluateTransition } from '../workflow/evaluate';
import { hybridConfig } from '../workflow/seeds';

/**
 * FB-05 (F-079, F-034): who is told for each gate x outcome x target of the seeded workflow, one
 * notification per person, never the actor.
 */

const ENG = asUserId('user-engineer');
const PRICER = asUserId('user-pricer');
const BACKUP = asUserId('user-backup');
const APPROVER = asUserId('user-price-approver');
const HOLD_OWNER = asUserId('user-hold-owner');
const DECIDER = asUserId('user-decider');
/** The roles an actor needs to decide each gate (the seeded deciders). */
const DECIDER_ROLE: Record<string, Role> = {
  G1: 'SalesLeader',
  G2: 'EngLead',
  G3: 'PricingLead',
  G4: 'Approver',
  G5: 'SalesLeader',
  G6: 'SalesLeader',
};

/** Real transition effects: the engine decides, the planner reads them. */
function effectsFor(gateKey: string, outcomeKey: string, targetStageKey?: string) {
  const c = validCase(hybridConfig, gateKey, outcomeKey);
  const quote = makeQuote(c.gate.stageKey, {
    fields: c.fields,
    assignedEngineerId: ENG,
    assignedPricerId: PRICER,
  });
  const result = evaluateTransition(
    hybridConfig,
    quote,
    makeActor(DECIDER_ROLE[gateKey]!, { userId: DECIDER }),
    {
      ...c.request,
      ...(targetStageKey ? { targetStageKey } : {}),
      payload: {
        ...(outcomeKey === 'hold' || outcomeKey === 'on_hold'
          ? { review_date: '2026-12-01', hold_owner_id: HOLD_OWNER }
          : {}),
        ...(gateKey === 'G5' ? { accepted_at: '2026-10-19', validity_lapsed: true } : {}),
      },
    },
    NOW,
  );
  if (!result.ok)
    throw new Error(`${gateKey}/${outcomeKey}: ${result.errors.map((e) => e.code).join(',')}`);
  return result.effects;
}

const members: Record<string, UserIds> = {
  EngLead: [asUserId('lead-eng-1'), asUserId('lead-eng-2')],
  PricingLead: [asUserId('lead-pricing')],
  Pricing: [PRICER, asUserId('pricer-2')],
  Approver: [asUserId('approver-1'), APPROVER],
  SalesLeader: [asUserId('sales-leader')],
  KAM: [KAM_ID],
};
type UserIds = ReturnType<typeof asUserId>[];
const membersOf = (r: Role) => members[r] ?? [];

function plan(
  gateKey: string,
  outcomeKey: string,
  opts: Partial<MoveNotifyInput> & { target?: string } = {},
) {
  const { target, ...rest } = opts;
  return planMoveNotifications({
    config: hybridConfig,
    effects: effectsFor(gateKey, outcomeKey, target),
    quote: { kamUserId: KAM_ID, assignedEngineerId: ENG, assignedPricerId: PRICER },
    ...rest,
  });
}

/** Who gets what, as `type -> user ids`, for a decision taken by `actor`. */
function told(
  gateKey: string,
  outcomeKey: string,
  opts: Parameters<typeof plan>[2] & { actor?: string } = {},
): Delivery[] {
  const p = plan(gateKey, outcomeKey, opts);
  return resolveDeliveries(p.entries, membersOf, opts.actor ?? DECIDER);
}
const idsOf = (ds: Delivery[], type?: string) =>
  ds.filter((d) => !type || d.type === type).map((d) => d.userId);

describe('classifying a decision', () => {
  const kind = (g: string, o: string, t?: string) =>
    classifyHandoff({
      config: hybridConfig,
      effects: effectsFor(g, o, t),
      quote: { kamUserId: KAM_ID },
    });

  it('reads advance, return, return to the KAM, hold, close and stay from where the quote goes', () => {
    expect(kind('G1', 'advance').kind).toBe('advance');
    expect(kind('G2', 'proceed').kind).toBe('advance');
    expect(kind('G3', 'submit').kind).toBe('advance');
    expect(kind('G4', 'approve').kind).toBe('advance');
    expect(kind('G5', 'awarded').kind).toBe('advance');
    expect(kind('G1', 'rework').kind).toBe('return_to_kam');
    expect(kind('G2', 'rework').kind).toBe('return_to_kam');
    expect(kind('G3', 'rework_kam').kind).toBe('return_to_kam');
    expect(kind('G3', 'rework').kind).toBe('return');
    expect(kind('G3', 'recost').kind).toBe('return');
    expect(kind('G4', 'return', 'ENG_REVIEW').kind).toBe('return');
    expect(kind('G5', 'requote', 'QUOTING').kind).toBe('return');
    expect(kind('G6', 'requote', 'QUOTING').kind).toBe('return');
    for (const [g, o] of [
      ['G1', 'hold'],
      ['G2', 'hold'],
      ['G3', 'hold'],
      ['G4', 'hold'],
      ['G5', 'on_hold'],
      ['G6', 'hold'],
    ] as const) {
      expect(kind(g, o).kind, `${g} ${o}`).toBe('hold');
    }
    for (const [g, o] of [
      ['G1', 'redirect'],
      ['G1', 'stop'],
      ['G2', 'stop'],
      ['G3', 'stop'],
      ['G4', 'decline'],
      ['G5', 'lost'],
      ['G5', 'expired'],
      ['G6', 'advance'],
      ['G6', 'stop'],
    ] as const) {
      expect(kind(g, o).kind, `${g} ${o}`).toBe('close');
    }
    expect(kind('G2', 'redirect').kind).toBe('stay');
    expect(kind('G5', 'negotiating').kind).toBe('stay');
  });

  it('says where a send-back came from', () => {
    expect(kind('G3', 'rework').returnedFrom).toBe('pricing');
    expect(kind('G4', 'return', 'QUOTING').returnedFrom).toBe('final_review');
    expect(kind('G5', 'requote', 'ENG_REVIEW').returnedFrom).toBe('customer_requote');
    expect(kind('G6', 'requote', 'QUOTING').returnedFrom).toBe('commitment');
    expect(kind('G3', 'recost').returnedFrom).toBe('in_place');
  });
});

describe('advances: the next owner and the KAM', () => {
  it('G1 Advance: the EngLeads and backup assigners get "ready for engineering", the KAM gets progress', () => {
    const ds = told('G1', 'advance', { backupAssigners: [BACKUP] });
    const eng = ds.filter((d) => d.type === HANDOFF_TYPES.readyForEng).map((d) => d.userId);
    expect(eng).toEqual(expect.arrayContaining([...members.EngLead!, BACKUP, ENG]));
    expect(idsOf(ds, HANDOFF_TYPES.progress)).toEqual([KAM_ID]);
    // The assigned engineer is told as the assignee (a kept assignment), the leads are not.
    expect(ds.find((d) => d.userId === ENG)?.asAssignee).toBe(true);
    expect(ds.find((d) => d.userId === members.EngLead![0])?.asAssignee).toBe(false);
  });

  it('G2 Advance (all three): the PricingLead, the pricers and the KAM', () => {
    for (const outcome of ['proceed', 'proceed_with_risk', 'capital_required']) {
      const ds = told('G2', outcome);
      const quoting = idsOf(ds, HANDOFF_TYPES.readyForQuoting);
      expect(quoting, outcome).toEqual(expect.arrayContaining([...members.PricingLead!, PRICER]));
      expect(idsOf(ds, HANDOFF_TYPES.progress), outcome).toEqual([KAM_ID]);
    }
  });

  it('G3 Advance: the Approvers hear "ready for Final Review" and the KAM hears progress', () => {
    const ds = told('G3', 'submit');
    expect(idsOf(ds, HANDOFF_TYPES.readyForFinalReview)).toEqual(members.Approver);
    expect(idsOf(ds, HANDOFF_TYPES.progress)).toEqual([KAM_ID]);
  });

  it('G4 Approve: the KAM and the price approver get "approved"; no second notice for the KAM', () => {
    const ds = told('G4', 'approve', { priceApproverId: APPROVER });
    expect(idsOf(ds, HANDOFF_TYPES.approved).sort()).toEqual([KAM_ID, APPROVER].sort());
    expect(idsOf(ds, HANDOFF_TYPES.progress)).toEqual([]);
  });

  it('G5 Awarded (decided by a SalesLeader): the KAM is told it moved to Commit & Hand Off', () => {
    const ds = told('G5', 'awarded');
    expect(ds).toEqual([expect.objectContaining({ userId: KAM_ID, type: HANDOFF_TYPES.progress })]);
  });
});

describe('every rework or return', () => {
  it('G1 and G2 rework: "returned to you" for the KAM, once', () => {
    for (const gate of ['G1', 'G2']) {
      const ds = told(gate, 'rework');
      expect(ds, gate).toEqual([
        expect.objectContaining({ userId: KAM_ID, type: HANDOFF_TYPES.reworked }),
      ]);
    }
  });

  it('G3 -> KAM (FB-01): "returned to you" for the KAM', () => {
    const ds = told('G3', 'rework_kam');
    expect(ds).toEqual([expect.objectContaining({ userId: KAM_ID, type: HANDOFF_TYPES.reworked })]);
  });

  it('G3 -> Engineering: the assigned engineer and the EngLeads hear it came back from Pricing; the KAM hears it was sent back', () => {
    const p = plan('G3', 'rework');
    expect(p.event).toMatchObject({
      kind: 'return',
      toStageKey: 'ENG_REVIEW',
      returnedFrom: 'pricing',
    });
    const ds = resolveDeliveries(p.entries, membersOf, DECIDER);
    expect(idsOf(ds, HANDOFF_TYPES.readyForEng)).toEqual(
      expect.arrayContaining([ENG, ...members.EngLead!]),
    );
    expect(idsOf(ds, HANDOFF_TYPES.progress)).toEqual([KAM_ID]);
  });

  it('G3 re-cost (rework in place): the pricer and the PricingLead are told, the KAM sees progress', () => {
    const ds = told('G3', 'recost', { actor: members.PricingLead![0]! });
    expect(idsOf(ds, HANDOFF_TYPES.readyForQuoting)).toEqual([PRICER]);
    expect(idsOf(ds, HANDOFF_TYPES.progress)).toEqual([KAM_ID]);
  });

  it('G4 return, G5 and G6 re-quote: the next owner of the target stage and the KAM', () => {
    for (const [gate, outcome, target, type] of [
      ['G4', 'return', 'ENG_REVIEW', HANDOFF_TYPES.readyForEng],
      ['G4', 'return', 'QUOTING', HANDOFF_TYPES.readyForQuoting],
      ['G5', 'requote', 'QUOTING', HANDOFF_TYPES.readyForQuoting],
      ['G6', 'requote', 'ENG_REVIEW', HANDOFF_TYPES.readyForEng],
    ] as const) {
      const ds = told(gate, outcome, { target });
      expect(idsOf(ds, type).length, `${gate} ${target}`).toBeGreaterThan(1);
      expect(idsOf(ds, HANDOFF_TYPES.progress), `${gate} ${target}`).toEqual([KAM_ID]);
    }
  });
});

describe('holds and closures', () => {
  it('every hold tells the hold owner and the KAM (the review date is on the event)', () => {
    for (const [gate, outcome] of [
      ['G1', 'hold'],
      ['G2', 'hold'],
      ['G3', 'hold'],
      ['G4', 'hold'],
      ['G5', 'on_hold'],
      ['G6', 'hold'],
    ] as const) {
      const p = plan(gate, outcome);
      expect(p.event.holdUntil, gate).toBe('2026-12-01');
      const ds = resolveDeliveries(p.entries, membersOf, DECIDER);
      expect(
        ds.map((d) => [d.userId, d.type, d.reason]),
        gate,
      ).toEqual([
        [HOLD_OWNER, HANDOFF_TYPES.onHold, 'hold_owner'],
        [KAM_ID, HANDOFF_TYPES.onHold, 'kam'],
      ]);
    }
  });

  it('a hold owned by the KAM gives the KAM one notice, not two', () => {
    const p = planMoveNotifications({
      config: hybridConfig,
      effects: effectsFor('G1', 'hold'),
      quote: { kamUserId: HOLD_OWNER },
    });
    expect(resolveDeliveries(p.entries, membersOf, DECIDER)).toHaveLength(1);
  });

  it('every closure tells the KAM (Stop, Redirect, Decline, Lost, Expired, Not authorized, Won)', () => {
    for (const [gate, outcome, type] of [
      ['G1', 'stop', HANDOFF_TYPES.closed],
      ['G1', 'redirect', HANDOFF_TYPES.closed],
      ['G2', 'stop', HANDOFF_TYPES.closed],
      ['G3', 'stop', HANDOFF_TYPES.closed],
      ['G4', 'decline', HANDOFF_TYPES.declined],
      ['G5', 'lost', HANDOFF_TYPES.closed],
      ['G5', 'expired', HANDOFF_TYPES.closed],
      ['G6', 'stop', HANDOFF_TYPES.closed],
      ['G6', 'advance', HANDOFF_TYPES.closed],
    ] as const) {
      const ds = told(gate, outcome);
      const kam = ds.filter((d) => d.userId === KAM_ID);
      expect(kam, `${gate} ${outcome}`).toEqual([expect.objectContaining({ type })]);
    }
  });

  it('a Final Review decline also tells Pricing and the price approver', () => {
    const ds = told('G4', 'decline', { priceApproverId: APPROVER });
    expect(idsOf(ds, HANDOFF_TYPES.declined)).toEqual(
      expect.arrayContaining([KAM_ID, ...members.Pricing!, APPROVER]),
    );
  });
});

describe('one notification per person', () => {
  it('a person who is the KAM and an EngLead gets one notice for G1 Advance (the queue alert wins)', () => {
    const ds = resolveDeliveries(
      plan('G1', 'advance').entries,
      (r) => (r === 'EngLead' ? [KAM_ID, asUserId('lead-eng-2')] : []),
      DECIDER,
    );
    expect(ds.filter((d) => d.userId === KAM_ID)).toEqual([
      expect.objectContaining({ type: HANDOFF_TYPES.readyForEng }),
    ]);
  });

  it('a person who is the price approver and a pricer gets one decline notice', () => {
    const ds = resolveDeliveries(
      plan('G4', 'decline', { priceApproverId: PRICER }).entries,
      membersOf,
      DECIDER,
    );
    expect(ds.filter((d) => d.userId === PRICER)).toHaveLength(1);
  });

  it('no one appears twice in any decision of the seeded workflow', () => {
    for (const o of hybridConfig.outcomes) {
      if (o.gateKey === 'SUBMIT') continue;
      const targets = hybridConfig.transitions.find(
        (t) => t.gateKey === o.gateKey && t.outcomeKey === o.key,
      )!.targetStageKeys;
      for (const target of targets.length > 1 ? targets : [undefined]) {
        const ds = told(o.gateKey, o.key, {
          ...(target ? { target } : {}),
          backupAssigners: [BACKUP],
          priceApproverId: APPROVER,
        });
        const ids = ds.map((d) => d.userId);
        expect(new Set(ids).size, `${o.gateKey}/${o.key}`).toBe(ids.length);
      }
    }
  });
});

describe('the person who decided', () => {
  it('is never told about their own decision', () => {
    const ds = resolveDeliveries(plan('G3', 'rework').entries, membersOf, ENG);
    expect(idsOf(ds)).not.toContain(ENG);
  });

  it('the KAM who decides their own step (G5 Awarded) is not told', () => {
    expect(told('G5', 'awarded', { actor: KAM_ID })).toEqual([]);
  });

  it('is still told through a role for a queue alert (B-26: a KAM who is also the EngLead)', () => {
    const ds = resolveDeliveries(
      plan('G1', 'advance').entries,
      (r) => (r === 'EngLead' ? [DECIDER] : []),
      DECIDER,
    );
    expect(idsOf(ds, HANDOFF_TYPES.readyForEng)).toContain(DECIDER);
  });

  it('is not told through a role for a decline or a return to the KAM', () => {
    const ds = resolveDeliveries(plan('G4', 'decline').entries, () => [DECIDER], DECIDER);
    expect(idsOf(ds)).not.toContain(DECIDER);
  });
});

describe('the KAM resubmits a G3 send-back with no scope change', () => {
  it('tells the assigned pricer and the PricingLead (not the KAM)', () => {
    const entries = planResume(
      'QUOTING',
      { kamUserId: KAM_ID, assignedPricerId: PRICER },
      hybridConfig,
    );
    const ds = resolveDeliveries(entries, membersOf, KAM_ID);
    expect(idsOf(ds)).toEqual(expect.arrayContaining([PRICER, ...members.PricingLead!]));
    expect(ds.every((d) => d.type === HANDOFF_TYPES.readyForQuoting)).toBe(true);
    expect(idsOf(ds)).not.toContain(KAM_ID);
    expect(ds.find((d) => d.userId === PRICER)?.asAssignee).toBe(true);
  });
});

describe('lead review', () => {
  it('submitting tells the leads (email type) and the KAM (in-app type)', () => {
    for (const [kind, lead] of [
      ['engineering', 'EngLead'],
      ['pricing', 'PricingLead'],
    ] as const) {
      const ds = resolveDeliveries(planLeadSubmitted(kind, { kamUserId: KAM_ID }), membersOf, ENG);
      expect(idsOf(ds, HANDOFF_TYPES.submittedToLead)).toEqual(members[lead]);
      expect(idsOf(ds, HANDOFF_TYPES.leadReviewUpdate)).toEqual([KAM_ID]);
    }
  });

  it('a send-back tells the assignee and the KAM; with nobody assigned, only the KAM', () => {
    const ds = resolveDeliveries(
      planLeadReturned(PRICER, { kamUserId: KAM_ID }),
      membersOf,
      DECIDER,
    );
    expect(ds.map((d) => [d.userId, d.type])).toEqual([
      [PRICER, HANDOFF_TYPES.returnedByLead],
      [KAM_ID, HANDOFF_TYPES.leadReviewUpdate],
    ]);
    expect(
      resolveDeliveries(planLeadReturned(null, { kamUserId: KAM_ID }), membersOf, DECIDER).map(
        (d) => d.userId,
      ),
    ).toEqual([KAM_ID]);
  });
});

describe('comments', () => {
  const quote = { kamUserId: KAM_ID, assignedEngineerId: ENG, assignedPricerId: PRICER };
  const AUTHOR = asUserId('user-author');
  const EARLIER = asUserId('user-earlier');

  it('in Engineering: the KAM, the assigned engineer, the EngLeads and earlier commenters', () => {
    const ds = resolveDeliveries(
      planCommentRecipients({
        stageKey: 'ENG_REVIEW',
        quote,
        previousCommenters: [EARLIER, AUTHOR],
      }),
      membersOf,
      AUTHOR,
      new Set([AUTHOR]),
    );
    expect(idsOf(ds).sort()).toEqual([KAM_ID, ENG, ...members.EngLead!, EARLIER].sort());
    expect(ds.every((d) => d.type === 'comment.posted')).toBe(true);
  });

  it('in Quoting: the assigned pricer and the PricingLead, not the engineer', () => {
    const ds = resolveDeliveries(
      planCommentRecipients({ stageKey: 'QUOTING', quote, previousCommenters: [] }),
      membersOf,
      AUTHOR,
    );
    expect(idsOf(ds).sort()).toEqual([KAM_ID, PRICER, ...members.PricingLead!].sort());
  });

  it('never the author, and not a mentioned user (who gets the mention instead)', () => {
    const entries = planCommentRecipients({
      stageKey: 'ENG_REVIEW',
      quote,
      previousCommenters: [EARLIER],
    });
    const ds = resolveDeliveries(entries, membersOf, KAM_ID, new Set([KAM_ID, ENG]));
    expect(idsOf(ds)).not.toContain(KAM_ID);
    expect(idsOf(ds)).not.toContain(ENG);
    expect(idsOf(ds)).toContain(EARLIER);
  });

  it('a person who is the KAM and an earlier commenter is told once', () => {
    const ds = resolveDeliveries(
      planCommentRecipients({ stageKey: 'INTAKE', quote, previousCommenters: [KAM_ID, KAM_ID] }),
      membersOf,
      AUTHOR,
    );
    expect(idsOf(ds)).toEqual([KAM_ID]);
  });
});

describe('stage facts come from the permission matrix', () => {
  it('names the deciders of each stage', () => {
    expect(stageLeadRoles('ENG_REVIEW')).toEqual(rolesWithPermission('gate.G2.decide'));
    expect(stageLeadRoles('QUOTING')).toEqual(rolesWithPermission('gate.G3.submit'));
    expect(stageLeadRoles('FINAL_REVIEW')).toEqual(rolesWithPermission('gate.G4.decide'));
    expect(stageLeadRoles('INTAKE')).toEqual([]);
  });

  it('lists the roles a plan reaches once', () => {
    expect(rolesIn(plan('G4', 'decline').entries).sort()).toEqual(['Pricing']);
  });
});

describe('FB-08 (T-007): the payment-terms exception', () => {
  it('the request goes to whoever decides it (the pricing lead)', () => {
    expect(planTermsExceptionRequested()).toEqual([
      {
        type: HANDOFF_TYPES.termsExceptionRequested,
        recipient: { kind: 'role', role: 'PricingLead' },
        reason: 'next_owner',
      },
    ]);
  });

  it('the decision goes to whoever entered the terms and to the KAM', () => {
    const quote = makeQuote('QUOTING');
    expect(planTermsExceptionDecided(ENG, quote).map((e) => e.recipient)).toEqual([
      { kind: 'user', userId: ENG },
      { kind: 'user', userId: KAM_ID },
    ]);
    expect(planTermsExceptionDecided(null, quote)).toHaveLength(1);
  });
});
