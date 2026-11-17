import { describe, expect, it } from 'vitest';

import { nextStep, partyOfRoles, type NextStepFacts, type NextStepWork } from './index';
import type { Role } from '../types/roles';
import { buildHybridConfig, hybridConfig } from '../workflow/seeds/hybrid';

const KAM = { id: 'user-kam', name: 'Dana Whitfield' };
const NO_WORK: NextStepWork = {
  assigneeId: null,
  assigneeName: null,
  submittedAt: null,
  canAssign: false,
  canWork: false,
  canReview: false,
};

function facts(
  stageKey: string,
  reader: { id?: string; roles: Role[] },
  over: Partial<NextStepFacts> = {},
): NextStepFacts {
  return {
    stageKey,
    status: 'active',
    readerId: reader.id ?? 'user-reader',
    readerRoles: reader.roles,
    kam: KAM,
    reworkSince: null,
    hold: null,
    work: { engineering: NO_WORK, pricing: NO_WORK },
    payback: { waiting: false, canUpload: false },
    decidableGateKeys: [],
    ...over,
  };
}

const step = (...args: Parameters<typeof facts>) => nextStep(hybridConfig, facts(...args));

describe('partyOfRoles', () => {
  it('names the first role that a quote can wait on', () => {
    expect(partyOfRoles(['KAM', 'SalesLeader'])).toBe('kam');
    expect(partyOfRoles(['EngLead'])).toBe('engineering_lead');
    expect(partyOfRoles(['ProductionScheduler'])).toBe('engineering');
    // Admin acts for support: a quote never waits on Admin.
    expect(partyOfRoles(['Admin', 'PricingLead'])).toBe('pricing_lead');
    expect(partyOfRoles(['Admin'])).toBe('nobody');
  });
});

describe('nextStep: closed and on hold', () => {
  it('a closed quote waits on nobody and names no gate', () => {
    expect(step('DECLINED', { roles: ['SalesLeader'] }, { status: 'closed' })).toEqual({
      waitingOn: 'nobody',
      personName: null,
      state: 'closed',
      since: null,
      gateKey: null,
      place: null,
      yourMove: false,
      hold: null,
    });
  });

  it('a hold carries its date, owner and reason, and waits on whoever decides the gate', () => {
    const hold = { reviewDate: '2026-12-01', ownerName: 'Avery Stone', reasonLabel: 'Awaiting' };
    const s = step(
      'ENG_REVIEW',
      { roles: ['EngLead'] },
      { status: 'on_hold', hold, decidableGateKeys: ['G2'] },
    );
    expect(s).toMatchObject({
      state: 'on_hold',
      waitingOn: 'engineering_lead',
      gateKey: 'G2',
      hold,
      yourMove: false,
    });
    // A customer-stage hold ends with the KAM's decision, never "the customer's".
    expect(step('CUSTOMER_DECISION', { roles: ['KAM'] }, { status: 'on_hold' })).toMatchObject({
      waitingOn: 'kam',
      hold: { reviewDate: null, ownerName: null, reasonLabel: null },
    });
  });
});

describe('nextStep: rework', () => {
  const rework = { reworkSince: '2026-11-12T21:04:00.000Z' };

  it('is the KAM’s own move', () => {
    expect(step('INTAKE', { id: KAM.id, roles: ['KAM'] }, rework)).toMatchObject({
      waitingOn: 'kam',
      personName: 'Dana Whitfield',
      state: 'rework',
      since: rework.reworkSince,
      place: 'intake',
      yourMove: true,
    });
  });

  it('is nobody else’s move: not another KAM’s, not the sales leader’s', () => {
    expect(step('INTAKE', { roles: ['KAM'] }, rework).yourMove).toBe(false);
    expect(step('INTAKE', { roles: ['SalesLeader'] }, rework)).toMatchObject({
      state: 'rework',
      waitingOn: 'kam',
      yourMove: false,
    });
  });
});

describe('nextStep: Engineering and Quoting (lead review)', () => {
  const engineer: NextStepWork = { ...NO_WORK, assigneeId: 'user-eng', assigneeName: 'V. Carroll' };

  it('unassigned: waits on the lead, whose move it is when the server lets them assign', () => {
    const work = { engineering: { ...NO_WORK, canAssign: true }, pricing: NO_WORK };
    expect(step('ENG_REVIEW', { roles: ['EngLead'] }, { work })).toMatchObject({
      waitingOn: 'engineering_lead',
      personName: null,
      state: 'unassigned',
      gateKey: 'G2',
      place: 'engineering',
      yourMove: true,
    });
    // An Admin may assign too, but the quote does not wait on Admin.
    expect(step('ENG_REVIEW', { roles: ['Admin'] }, { work }).yourMove).toBe(false);
    // A lead the server would refuse (no assign right on this quote) is not told it is their move.
    expect(step('ENG_REVIEW', { roles: ['EngLead'] }).yourMove).toBe(false);
  });

  it('assigned: waits on the engineer by name; their move while they can edit', () => {
    const work = { engineering: { ...engineer, canWork: true }, pricing: NO_WORK };
    expect(step('ENG_REVIEW', { id: 'user-eng', roles: ['Engineer'] }, { work })).toMatchObject({
      waitingOn: 'engineering',
      personName: 'V. Carroll',
      state: 'in_progress',
      place: 'engineering',
      yourMove: true,
    });
    // The lead can edit at any time, but it is the engineer's move.
    expect(step('ENG_REVIEW', { roles: ['EngLead'] }, { work }).yourMove).toBe(false);
  });

  it('submitted: waits on the lead since the submit', () => {
    const submittedAt = '2026-11-13T15:00:00.000Z';
    const work = {
      engineering: { ...engineer, submittedAt, canReview: true },
      pricing: NO_WORK,
    };
    expect(step('ENG_REVIEW', { roles: ['EngLead'] }, { work })).toMatchObject({
      waitingOn: 'engineering_lead',
      personName: null,
      state: 'with_lead',
      since: submittedAt,
      yourMove: true,
    });
    const forEngineer = {
      engineering: { ...engineer, submittedAt, canReview: false },
      pricing: NO_WORK,
    };
    expect(
      step('ENG_REVIEW', { id: 'user-eng', roles: ['Engineer'] }, { work: forEngineer }).yourMove,
    ).toBe(false);
  });

  it('Quoting mirrors it with the pricer and the pricing lead', () => {
    const pricer = { ...NO_WORK, assigneeId: 'user-pricer', assigneeName: 'Kyle Arnold' };
    expect(step('QUOTING', { roles: ['PricingLead'] })).toMatchObject({
      waitingOn: 'pricing_lead',
      state: 'unassigned',
      gateKey: 'G3',
      place: 'quoting',
    });
    expect(
      step(
        'QUOTING',
        { id: 'user-pricer', roles: ['Pricing'] },
        { work: { engineering: NO_WORK, pricing: { ...pricer, canWork: true } } },
      ),
    ).toMatchObject({
      waitingOn: 'pricing',
      personName: 'Kyle Arnold',
      state: 'in_progress',
      yourMove: true,
    });
  });

  it('Quoting waits on Finance while the payback step is the one waiting', () => {
    const payback = { waiting: true, canUpload: true };
    expect(step('QUOTING', { roles: ['Finance'] }, { payback })).toMatchObject({
      waitingOn: 'finance',
      state: 'in_progress',
      place: 'quoting',
      yourMove: true,
    });
    // The pricing lead may upload it as a fallback, but it is Finance's step.
    expect(step('QUOTING', { roles: ['PricingLead'] }, { payback }).yourMove).toBe(false);
  });
});

describe('nextStep: gates decided in a dialog', () => {
  it('a submitted intake waits on the sales leader at G1', () => {
    expect(step('INTAKE', { roles: ['SalesLeader'] }, { decidableGateKeys: ['G1'] })).toMatchObject(
      {
        waitingOn: 'sales_leader',
        personName: null,
        state: 'at_gate',
        gateKey: 'G1',
        place: 'decision',
        yourMove: true,
      },
    );
    // Offered nothing (the KAM of the quote, or every outcome blocked): not their move.
    expect(step('INTAKE', { roles: ['SalesLeader'] }).yourMove).toBe(false);
    expect(step('INTAKE', { roles: ['KAM'] }, { decidableGateKeys: ['G1'] }).yourMove).toBe(false);
  });

  it('Final Review waits on the approver', () => {
    expect(
      step('FINAL_REVIEW', { roles: ['Approver'] }, { decidableGateKeys: ['G4'] }),
    ).toMatchObject({ waitingOn: 'approver', state: 'at_gate', gateKey: 'G4', yourMove: true });
    expect(step('FINAL_REVIEW', { roles: ['Pricing'] })).toMatchObject({
      waitingOn: 'approver',
      yourMove: false,
    });
  });

  it('Customer Decision waits on the customer, whoever records the answer', () => {
    expect(
      step('CUSTOMER_DECISION', { id: KAM.id, roles: ['KAM'] }, { decidableGateKeys: ['G5'] }),
    ).toMatchObject({
      waitingOn: 'customer',
      personName: null,
      state: 'at_gate',
      gateKey: 'G5',
      yourMove: false,
    });
  });

  it('Commit & Hand Off waits on the quote’s KAM by name', () => {
    const decidable = { decidableGateKeys: ['G6'] };
    expect(step('COMMIT_HANDOFF', { id: KAM.id, roles: ['KAM'] }, decidable)).toMatchObject({
      waitingOn: 'kam',
      personName: 'Dana Whitfield',
      state: 'at_gate',
      gateKey: 'G6',
      yourMove: true,
    });
    // A sales leader may decide G6 too, but the quote waits on its KAM.
    expect(step('COMMIT_HANDOFF', { roles: ['SalesLeader'] }, decidable).yourMove).toBe(false);
  });

  it('reads the gate from the config: with G1 switched off, Intake waits on the KAM’s submit', () => {
    const noG1 = buildHybridConfig({ g1Enabled: false });
    expect(nextStep(noG1, facts('INTAKE', { roles: ['SalesLeader'] }))).toMatchObject({
      waitingOn: 'kam',
      gateKey: 'SUBMIT',
      state: 'at_gate',
    });
  });
});
