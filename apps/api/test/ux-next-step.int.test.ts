import {
  IntakeDraft,
  MeResponse,
  QuoteDetail,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
} from '@ccq/contracts';
import type { DbClient } from '@ccq/db';
import type { Role } from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmCapitalTerms, prepareModels } from './model-helpers';
import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * UX-002: `QuoteDetail.nextStep`, "whose move is it", read through the quote route as each role while
 * one quote moves through the workflow. Every state the line on the quote page can show is reached by
 * the real routes, and `yourMove` is checked for the role that must act and for one that must not.
 * UX-003 reads the same response: on a reworked quote the sales leader is offered G1, but every outcome
 * lists the missing resubmission, so nothing is decidable.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
const clock = new Date('2026-11-17T15:00:00Z');

let free: string[] = [];
const nextFree = () => {
  const id = free.shift();
  if (!id) throw new Error('test ran out of free opportunities');
  return id;
};

const as = (role: Role) => asRole(app, role);
const userIdOf = async (role: Role) =>
  MeResponse.parse((await as(role).get('/api/v1/me')).json()).user;

async function prefill(sfOpportunityId: string): Promise<IntakeDraftData> {
  const res = await as('KAM').get(`/api/v1/salesforce/opportunities/${sfOpportunityId}`);
  expect(res.statusCode, res.body).toBe(200);
  const sf = SfOpportunityDetail.parse(res.json());
  const shipTo = {
    line1: '1 Test St',
    city: 'Testville',
    state: 'MO',
    postal: '63101',
    country: 'US',
  };
  return {
    sfOpportunityId,
    sfOpportunityName: sf.opportunity.name,
    customer: {
      status: 'existing',
      sfAccountId: sf.account?.id ?? sf.opportunity.accountId,
      name: sf.account?.name ?? sf.opportunity.accountName,
    },
    shipTo,
    shipToDefault: shipTo,
    requestClass: 'CCQ',
    productFamily: 'BOTTLE',
    components: ['CONTAINER'],
    market: 'FOOD',
    subMarket: 'FOOD_SNACKS',
    resin: 'HDPE',
    neckDiameter: '38',
    neckFinishType: '400',
    pcrLevel: '0',
    colorType: 'NATURAL',
    heightMm: 180,
    widthOrDiameterMm: 65,
    depthMm: 65,
    gramWeightG: 24,
    packagingType: 'BULK',
    estAnnualVolume: 750_000,
    estAnnualRevenue: 150_000,
    quoteNeededBy: '2026-12-15',
    productNeededBy: '2027-03-01',
    containerSize: '16 oz',
    standardDescription: '16 oz Bottle, HDPE',
    drawingStatus: 'HAVE_DRAWING',
  };
}

/** A KAM-submitted quote waiting for G1. */
async function submitted(): Promise<string> {
  const created = await as('KAM').post('/api/v1/quotes/drafts', {
    data: await prefill(nextFree()),
  });
  expect(created.statusCode, created.body).toBe(201);
  const res = await as('KAM').post(
    `/api/v1/quotes/drafts/${IntakeDraft.parse(created.json()).id}/submit`,
  );
  expect(res.statusCode, res.body).toBe(201);
  return SubmitIntakeResponse.parse(res.json()).quoteNumber;
}

const ok = (res: { statusCode: number; body: string }, status = 201) =>
  expect(res.statusCode, res.body).toBe(status);
const decide = (qn: string, gate: string, role: Role, body: Record<string, unknown>) =>
  as(role).post(`/api/v1/quotes/${qn}/gates/${gate}/decisions`, body);

async function detail(qn: string, role: Role) {
  const res = await as(role).get(`/api/v1/quotes/${qn}`);
  expect(res.statusCode, res.body).toBe(200);
  return QuoteDetail.parse(res.json());
}
const step = async (qn: string, role: Role) => (await detail(qn, role)).nextStep;

beforeAll(async () => {
  const fresh = await freshSfDatabase('ux_next_step');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url }), { db, now: () => clock });
  await app.ready();
  const rows = await db.db.execute<{ id: string }>(sql`
    select s.sf_opportunity_id as id from sf_opportunity_snapshot s
    where not s.is_closed and s.account_id is not null
      and not exists (select 1 from quote q where q.sf_opportunity_id = s.sf_opportunity_id and q.status <> 'closed')
    order by s.sf_opportunity_id`);
  free = rows.map((r) => r.id);
  expect(free.length).toBeGreaterThanOrEqual(3);
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('QuoteDetail.nextStep', () => {
  it('a submitted intake waits on the sales leader; sent back, it waits on its KAM', async () => {
    const qn = await submitted();
    const kam = await userIdOf('KAM');

    expect(await step(qn, 'SalesLeader')).toEqual({
      waitingOn: 'sales_leader',
      personName: null,
      state: 'at_gate',
      since: null,
      gateKey: 'G1',
      place: 'decision',
      yourMove: true,
      hold: null,
    });
    expect(await step(qn, 'KAM')).toMatchObject({ waitingOn: 'sales_leader', yourMove: false });

    ok(
      await decide(qn, 'G1', 'SalesLeader', {
        outcomeKey: 'rework',
        reasonCode: 'missing_information',
        note: 'Add the target neck finish',
      }),
    );

    // Back with the KAM for rework: their own move, by name, since the send-back.
    const forKam = await detail(qn, 'KAM');
    expect(forKam.rework).not.toBeNull();
    expect(forKam.nextStep).toEqual({
      waitingOn: 'kam',
      personName: kam.displayName,
      state: 'rework',
      since: forKam.rework!.decidedAt,
      gateKey: 'G1',
      place: 'intake',
      yourMove: true,
      hold: null,
    });

    // UX-003: the sales leader is still offered G1, but every outcome (Advance, Send back, Hold, Stop)
    // lists the missing resubmission, so nothing can be decided and it is not their move.
    const forLeader = await detail(qn, 'SalesLeader');
    expect(forLeader.nextStep).toMatchObject({
      state: 'rework',
      waitingOn: 'kam',
      yourMove: false,
    });
    const g1 = forLeader.availableActions.filter((a) => a.gateKey === 'G1');
    expect(g1.length).toBeGreaterThan(1);
    for (const action of g1) {
      expect(
        action.missing.map((m) => m.field),
        action.outcomeKey,
      ).toContain('submitted_at');
    }
    // And the server does refuse each of them, as the line says.
    const refused = await decide(qn, 'G1', 'SalesLeader', {
      outcomeKey: 'stop',
      reasonCode: 'not_strategic',
      note: 'Not pursuing',
    });
    expect(refused.statusCode, refused.body).toBe(422);
  });

  it('on hold it carries the review date, the owner and the reason label; closed, nothing waits', async () => {
    const qn = await submitted();
    const owner = await userIdOf('SalesLeader');
    ok(
      await decide(qn, 'G1', 'SalesLeader', {
        outcomeKey: 'hold',
        reasonCode: 'awaiting_customer_info',
        note: 'Customer is confirming the volume',
        holdUntil: '2026-12-01',
        holdOwnerId: owner.id,
      }),
    );
    for (const role of ['KAM', 'SalesLeader'] as const) {
      expect(await step(qn, role), role).toEqual({
        waitingOn: 'sales_leader',
        personName: null,
        state: 'on_hold',
        since: null,
        gateKey: 'G1',
        place: null,
        yourMove: false,
        hold: {
          reviewDate: '2026-12-01',
          ownerName: owner.displayName,
          reasonLabel: 'Awaiting customer information',
        },
      });
    }

    ok(
      await decide(qn, 'G1', 'SalesLeader', {
        outcomeKey: 'stop',
        reasonCode: 'not_strategic',
        note: 'Not pursuing',
      }),
    );
    expect(await step(qn, 'SalesLeader')).toEqual({
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

  it('Engineering: unassigned, the engineer working, submitted to the lead; then Quoting and Final Review', async () => {
    const qn = await submitted();
    ok(await decide(qn, 'G1', 'SalesLeader', { outcomeKey: 'advance' }));
    const engineer = await userIdOf('Engineer');

    // Unassigned: the engineering lead's move (assign); nobody else's.
    expect(await step(qn, 'EngLead')).toEqual({
      waitingOn: 'engineering_lead',
      personName: null,
      state: 'unassigned',
      since: null,
      gateKey: 'G2',
      place: 'engineering',
      yourMove: true,
      hold: null,
    });
    expect(await step(qn, 'Engineer')).toMatchObject({ state: 'unassigned', yourMove: false });
    expect(await step(qn, 'KAM')).toMatchObject({ state: 'unassigned', yourMove: false });

    // Assigned: the engineer's move, by name. The lead can edit, but it is not the lead's move.
    ok(
      await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, { engineerId: engineer.id }),
      200,
    );
    expect(await step(qn, 'Engineer')).toMatchObject({
      waitingOn: 'engineering',
      personName: engineer.displayName,
      state: 'in_progress',
      place: 'engineering',
      yourMove: true,
    });
    expect(await step(qn, 'EngLead')).toMatchObject({
      state: 'in_progress',
      personName: engineer.displayName,
      yourMove: false,
    });

    // The engineer does their part and submits to the lead.
    ok(
      await as('Engineer').put(`/api/v1/quotes/${qn}/eng-review`, {
        processType: 'EBM',
        machineType: 'EBM',
        plantCode: 'AURORA',
        cavitation: 8,
        cycleTimeS: 14.5,
        prelimCapitalUsd: 0,
      }),
      200,
    );
    ok(
      await as('Engineer').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
        rows: [
          {
            site: 'AURORA',
            assumedEffectivenessPct: 70,
            cycleTimeS: 14.5,
            utilizationBeforePct: 62,
            analysisDate: '2026-11-16',
            analystId: engineer.id,
          },
        ],
      }),
      200,
    );
    ok(await as('Engineer').post(`/api/v1/quotes/${qn}/eng-review/submit`), 200);
    const withLead = await detail(qn, 'EngLead');
    expect(withLead.nextStep).toEqual({
      waitingOn: 'engineering_lead',
      personName: null,
      state: 'with_lead',
      since: withLead.engineering.leadReview.submittedAt,
      gateKey: 'G2',
      place: 'engineering',
      yourMove: true,
      hold: null,
    });
    expect(withLead.nextStep!.since).not.toBeNull();
    expect(await step(qn, 'Engineer')).toMatchObject({ state: 'with_lead', yourMove: false });

    // The lead signs capacity off and advances: Quoting, with no pricer yet.
    ok(
      await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-signoff`, { status: 'approved' }),
      200,
    );
    ok(await decide(qn, 'G2', 'EngLead', { outcomeKey: 'proceed' }));
    expect(await step(qn, 'PricingLead')).toMatchObject({
      waitingOn: 'pricing_lead',
      state: 'unassigned',
      gateKey: 'G3',
      place: 'quoting',
      yourMove: true,
    });
    expect(await step(qn, 'Pricing')).toMatchObject({ state: 'unassigned', yourMove: false });

    // Priced and approved by the pricing lead: waiting at Final Review on the approver.
    const pricer = await userIdOf('Pricing');
    await prepareModels(app, qn);
    ok(
      await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
        approvedBy: pricer.id,
        erfRefs: ['ERF26-213'],
        costingCompleted: true,
      }),
      200,
    );
    ok(
      await as('Pricing').put(`/api/v1/quotes/${qn}/capital-readiness`, {
        capitalReadiness: 'pre_approved',
      }),
      200,
    );
    ok(await decide(qn, 'G3', 'PricingLead', { outcomeKey: 'submit' }));
    ok(
      await as('KAM').put(`/api/v1/quotes/${qn}/terms`, {
        termsPaymentTermsCode: 'NET_30',
        termsToolingCommitment: false,
        checked: true,
      }),
      200,
    );
    await confirmCapitalTerms(app, qn);
    expect(await step(qn, 'Approver')).toEqual({
      waitingOn: 'approver',
      personName: null,
      state: 'at_gate',
      since: null,
      gateKey: 'G4',
      place: 'decision',
      yourMove: true,
      hold: null,
    });
    expect(await step(qn, 'KAM')).toMatchObject({
      waitingOn: 'approver',
      state: 'at_gate',
      yourMove: false,
    });

    // Released: waiting on the customer; the KAM records the answer, but it is the customer's move.
    ok(await decide(qn, 'G4', 'Approver', { outcomeKey: 'approve' }));
    expect(await step(qn, 'KAM')).toMatchObject({
      waitingOn: 'customer',
      state: 'at_gate',
      gateKey: 'G5',
      yourMove: false,
    });
  });
});
