import {
  DEV_USER_HEADER,
  EngineeringDetail,
  GateDecisionResponse,
  IntakeDraft,
  IntakeDraftListResponse,
  MeResponse,
  PricingQueueResponse,
  QuoteDetail,
  QuotingDetail,
  ReviewSummary,
  SECTION_LOCKED_PROBLEM_TYPE,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  TimelineResponse,
  type IntakeDraftData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import { holdsPermission, type Permission, type Role } from '@ccq/domain';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * FB-01 workflow integrity, through the API on a real Postgres:
 * - F-001 locks: every section write route answers 409 SECTION_LOCKED to every role that may write it
 *   once its gate is decided (the others keep their 403 from the route gate), and a send-back reopens it.
 * - F-029 / F-030: Pricing sends the quote back to the KAM; the KAM's fix goes straight back to Quoting
 *   unless they say the scope changed (T-005).
 * - F-069: the Final Review approver is not blocked by fields other roles own (T-026).
 * - F-003 / F-004 / F-028: lead review and pricing assignment notify the right people (T-014–T-016).
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-11-05T15:00:00Z');
const HOUR = 3_600_000;
const tick = (ms = HOUR) => {
  clock = new Date(clock.getTime() + ms);
};

const ROLES: Role[] = [
  'KAM',
  'SalesLeader',
  'EngLead',
  'Engineer',
  'Pricing',
  'PricingLead',
  'Approver',
  'Leadership',
  'Admin',
];
const PERSONA: Record<Role, string> = {
  KAM: 'kam',
  SalesLeader: 'sales-leader',
  EngLead: 'eng-lead',
  Engineer: 'engineer',
  Pricing: 'pricing',
  PricingLead: 'pricing-lead',
  Approver: 'approver',
  Leadership: 'leadership',
  Admin: 'admin',
  PostAward: 'admin',
};

let free: string[] = [];
const created: string[] = [];
async function nextFree(): Promise<string> {
  const id = free.shift();
  if (id) return id;
  const old = created.shift();
  if (!old) throw new Error('test ran out of free opportunities');
  const [row] = await db.db.execute<{ id: string }>(sql`
    update quote set stage_key = 'DECLINED', status = 'closed', outcome = 'declined', closed_at = now(),
      outcome_reason_code = 'other', closure_owner_id = kam_user_id
    where quote_number = ${old} returning sf_opportunity_id as id`);
  return row!.id;
}

const as = (role: Role) => asRole(app, role);
const ids: Record<string, string> = {};
async function userId(role: Role): Promise<string> {
  ids[role] ??= MeResponse.parse(
    (
      await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { [DEV_USER_HEADER]: PERSONA[role] },
      })
    ).json(),
  ).user.id;
  return ids[role];
}
const ok = (res: { statusCode: number; body: string }, status = 201) =>
  expect(res.statusCode, res.body).toBe(status);
const decide = (qn: string, gate: string, body: Record<string, unknown>, by: Role) =>
  as(by).post(`/api/v1/quotes/${qn}/gates/${gate}/decisions`, body);
const errorCodes = (res: { json: () => unknown }) =>
  ((res.json() as { errors?: { code?: string }[] }).errors ?? []).map((e) => e.code).sort();
const quoteRow = async (qn: string) =>
  (await db.db.select().from(schema.quote).where(eq(schema.quote.quoteNumber, qn)))[0]!;

async function prefill(sfOpportunityId: string, over: IntakeDraftData = {}) {
  const sf = SfOpportunityDetail.parse(
    (await as('KAM').get(`/api/v1/salesforce/opportunities/${sfOpportunityId}`)).json(),
  );
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
      status: 'existing' as const,
      sfAccountId: sf.account?.id ?? sf.opportunity.accountId,
      name: sf.account?.name ?? sf.opportunity.accountName,
    },
    shipTo,
    shipToDefault: shipTo,
    requestClass: 'CCQ',
    productFamily: 'BOTTLE',
    components: ['CONTAINER'],
    market: 'FOOD',
    resin: 'HDPE',
    neckDiameter: '38',
    neckFinishType: '400',
    pcrLevel: '0',
    colorType: 'NATURAL',
    // F-016: the minimum spec, so these intakes submit without a drawing file.
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
    ...over,
  };
}

/** A submitted quote waiting at G1. */
async function submitted(): Promise<string> {
  const res = await as('KAM').post('/api/v1/quotes/drafts', {
    data: await prefill(await nextFree()),
  });
  ok(res);
  const sub = await as('KAM').post(
    `/api/v1/quotes/drafts/${IntakeDraft.parse(res.json()).id}/submit`,
  );
  ok(sub);
  const { quoteNumber } = SubmitIntakeResponse.parse(sub.json());
  created.push(quoteNumber);
  return quoteNumber;
}

/** Engineering's work, ready for G2. */
async function engineeringDone(qn: string) {
  ok(
    await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, {
      processType: 'EBM',
      machineType: 'EBM_SHUTTLE',
      plantCode: 'PLANT_01',
      cavitation: 8,
      cycleTimeS: 14.5,
      prelimCapitalUsd: 250_000,
    }),
    200,
  );
  ok(
    await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
      rows: [
        {
          site: 'PLANT_01',
          assumedEffectivenessPct: 70,
          cycleTimeS: 14.5,
          utilizationBeforePct: 62,
          analysisDate: '2026-10-26',
          analystId: await userId('Engineer'),
        },
      ],
    }),
    200,
  );
  ok(await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-signoff`, { status: 'approved' }), 200);
}

async function inEngineering(): Promise<string> {
  const qn = await submitted();
  ok(await decide(qn, 'G1', { outcomeKey: 'advance' }, 'SalesLeader'));
  return qn;
}

async function inQuoting(): Promise<string> {
  const qn = await inEngineering();
  await engineeringDone(qn);
  ok(await decide(qn, 'G2', { outcomeKey: 'proceed' }, 'EngLead'));
  tick();
  return qn;
}

/** Pricing's work, ready for G3. */
async function pricingDone(qn: string) {
  ok(
    await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
      approvedBy: await userId('Pricing'),
      approvedAt: new Date(clock.getTime() - HOUR).toISOString(),
      pricingBasisNote: 'March CDI',
      costingCompleted: true,
    }),
    200,
  );
  ok(
    await as('Pricing').put(`/api/v1/quotes/${qn}/capital-readiness`, {
      capitalReadiness: 'not_required',
    }),
    200,
  );
}

async function inFinalReview(): Promise<string> {
  const qn = await inQuoting();
  await pricingDone(qn);
  ok(await decide(qn, 'G3', { outcomeKey: 'submit' }, 'PricingLead'));
  tick();
  return qn;
}

async function inCustomerDecision(): Promise<string> {
  const qn = await inFinalReview();
  ok(await decide(qn, 'G4', { outcomeKey: 'approve' }, 'Approver'));
  tick();
  return qn;
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('workflow_integrity');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url, RATE_LIMIT_MAX: '100000' }), {
    db,
    now: () => clock,
  });
  await app.ready();
  const rows = await db.db.execute<{ id: string }>(sql`
    select s.sf_opportunity_id as id from sf_opportunity_snapshot s
    where not s.is_closed and s.account_id is not null
      and not exists (select 1 from quote q where q.sf_opportunity_id = s.sf_opportunity_id and q.status <> 'closed')
    order by s.sf_opportunity_id`);
  free = rows.map((r) => r.id);
  expect(free.length).toBeGreaterThanOrEqual(10);
  for (const role of ROLES) await userId(role);
}, 120_000);
afterAll(async () => {
  await app.close();
});

// ── F-001 ──────────────────────────────────────────────────────────────────────────────────────

interface LockedRoute {
  label: string;
  url: (qn: string) => string;
  permission: Permission;
  body: () => Promise<Record<string, unknown>> | Record<string, unknown>;
}

const ENGINEERING_ROUTES: LockedRoute[] = [
  {
    label: 'PUT eng-review',
    url: (qn) => `/api/v1/quotes/${qn}/eng-review`,
    permission: 'engReview.edit',
    body: () => ({ cavitation: 6 }),
  },
  {
    label: 'PUT capacity-evidence',
    url: (qn) => `/api/v1/quotes/${qn}/capacity-evidence`,
    permission: 'engReview.edit',
    body: () => ({ rows: [] }),
  },
  {
    label: 'PUT capacity-signoff',
    url: (qn) => `/api/v1/quotes/${qn}/capacity-signoff`,
    permission: 'capacity.signoff',
    body: () => ({ status: 'blocked', note: 'x' }),
  },
];
const PRICING_ROUTES: LockedRoute[] = [
  {
    label: 'PUT pricing-record',
    url: (qn) => `/api/v1/quotes/${qn}/pricing-record`,
    permission: 'quoting.edit',
    body: () => ({ pricingBasisNote: 'changed after approval' }),
  },
  {
    label: 'PUT capital-readiness',
    url: (qn) => `/api/v1/quotes/${qn}/capital-readiness`,
    permission: 'quoting.edit',
    body: () => ({ capitalReadiness: 'pending', capitalPendingJustification: 'x' }),
  },
];
const COMMERCIAL_ROUTES: LockedRoute[] = [
  {
    label: 'PUT terms',
    url: (qn) => `/api/v1/quotes/${qn}/terms`,
    permission: 'terms.edit',
    body: () => ({ termsMoq: '99k' }),
  },
  {
    label: 'PUT capital-flag',
    url: (qn) => `/api/v1/quotes/${qn}/capital-flag`,
    permission: 'capitalFlag.edit',
    body: () => ({ capitalLikely: true }),
  },
];

/** Every role: 409 SECTION_LOCKED naming the gate and the decider, or 403 from the route gate. */
async function expectLockedForEveryRole(qn: string, routes: LockedRoute[], gate: string) {
  for (const route of routes) {
    for (const role of ROLES) {
      const res = await as(role).put(route.url(qn), await route.body());
      if (holdsPermission({ roles: [role] }, route.permission)) {
        expect(res.statusCode, `${route.label} as ${role}: ${res.body}`).toBe(409);
        const body = res.json<Record<string, unknown>>();
        expect(res.headers['content-type']).toContain('application/problem+json');
        expect(body).toMatchObject({
          type: SECTION_LOCKED_PROBLEM_TYPE,
          code: 'SECTION_LOCKED',
          status: 409,
          lock: { locked: true, gate, decidedByName: expect.any(String) as unknown },
        });
        expect(String(body.detail)).toContain(`locked after ${gate}`);
      } else {
        expect(res.statusCode, `${route.label} as ${role}`).toBe(403);
      }
    }
  }
}

describe('F-001: a section is read-only once its gate is decided (T-001)', () => {
  it('engineering: every role is refused after G2 Advance; the tab shows the lock', async () => {
    const qn = await inQuoting();
    await expectLockedForEveryRole(qn, ENGINEERING_ROUTES, 'G2');
    const eng = QuoteDetail.parse(
      (await as('EngLead').get(`/api/v1/quotes/${qn}`)).json(),
    ).engineering;
    expect(eng).toMatchObject({
      canEdit: false,
      canSignOffCapacity: false,
      lock: { locked: true, gate: 'G2', gateLabel: 'Feasible solution?', outcomeKey: 'proceed' },
    });
    expect(eng.lock.decidedByName).toEqual(expect.any(String));
    expect(eng.lock.decidedAt).toEqual(expect.any(String));
  });

  it('pricing: every role is refused after G3 Advance', async () => {
    const qn = await inFinalReview();
    await expectLockedForEveryRole(qn, PRICING_ROUTES, 'G3');
    const quoting = QuoteDetail.parse(
      (await as('PricingLead').get(`/api/v1/quotes/${qn}`)).json(),
    ).quoting;
    expect(quoting).toMatchObject({ canEdit: false, lock: { locked: true, gate: 'G3' } });
  });

  it('terms and the capital flag stay editable until G4 Advance, then every role is refused', async () => {
    const qn = await inFinalReview();
    // Before G4: still editable (the KAM may still check the terms in Final Review).
    ok(await as('KAM').put(`/api/v1/quotes/${qn}/terms`, { termsMoq: '50k' }), 200);
    ok(await as('KAM').put(`/api/v1/quotes/${qn}/capital-flag`, { capitalLikely: false }), 200);
    ok(await decide(qn, 'G4', { outcomeKey: 'approve' }, 'Approver'));
    await expectLockedForEveryRole(qn, COMMERCIAL_ROUTES, 'G4');
    const commercial = QuoteDetail.parse(
      (await as('KAM').get(`/api/v1/quotes/${qn}`)).json(),
    ).commercial;
    expect(commercial.terms).toMatchObject({ canEdit: false, lock: { locked: true, gate: 'G4' } });
    expect(commercial.capital).toMatchObject({
      canEdit: false,
      lock: { locked: true, gate: 'G4' },
    });
    // Nothing changed.
    expect((await quoteRow(qn)).termsMoq).toBe('50k');
  });

  it('a G4 Return to Quoting reopens pricing (not engineering)', async () => {
    const qn = await inFinalReview();
    ok(
      await decide(
        qn,
        'G4',
        {
          outcomeKey: 'return',
          targetStageKey: 'QUOTING',
          note: 'Price the October resin index',
        },
        'Approver',
      ),
    );
    ok(
      await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, { pricingBasisNote: 'Oct' }),
      200,
    );
    const res = await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, { cavitation: 6 });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'SECTION_LOCKED', lock: { gate: 'G2' } });
  });

  it('a G3 Rework → Engineering reopens engineering', async () => {
    const qn = await inQuoting();
    ok(
      await decide(
        qn,
        'G3',
        { outcomeKey: 'rework', reasonCode: 'missing_information', note: 'Trimmer missing' },
        'PricingLead',
      ),
    );
    ok(await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, { cavitation: 6 }), 200);
    const eng = EngineeringDetail.parse(
      (await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, { cavitation: 7 })).json(),
    );
    expect(eng).toMatchObject({ canEdit: true, lock: { locked: false, gate: null } });
  });

  it('a G5 Re-quote reopens pricing, the terms and the capital flag', async () => {
    const qn = await inCustomerDecision();
    expect((await as('KAM').put(`/api/v1/quotes/${qn}/terms`, { termsMoq: '1' })).statusCode).toBe(
      409,
    );
    ok(
      await decide(
        qn,
        'G5',
        {
          outcomeKey: 'requote',
          reasonCode: 'volume_change',
          targetStageKey: 'QUOTING',
          note: 'Volume doubled',
        },
        'KAM',
      ),
    );
    ok(await as('KAM').put(`/api/v1/quotes/${qn}/terms`, { termsMoq: '75k' }), 200);
    ok(await as('KAM').put(`/api/v1/quotes/${qn}/capital-flag`, { capitalLikely: true }), 200);
    ok(
      await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, { pricingBasisNote: 'v2' }),
      200,
    );
  });
});

// ── F-029 / F-030 ──────────────────────────────────────────────────────────────────────────────

describe('F-029 / F-030: Pricing → KAM → straight back to Quoting (T-005)', () => {
  /** A quote in Quoting with an assigned pricer whose work is submitted to the lead. */
  async function pricedAndSubmitted() {
    const qn = await inQuoting();
    ok(
      await as('PricingLead').post(`/api/v1/quotes/${qn}/pricing-assignment`, {
        pricerId: await userId('Pricing'),
      }),
      200,
    );
    await pricingDone(qn);
    ok(await as('Pricing').post(`/api/v1/quotes/${qn}/quoting/submit`), 200);
    return qn;
  }

  const sendToKam = (qn: string, by: Role = 'PricingLead') =>
    decide(
      qn,
      'G3',
      {
        outcomeKey: 'rework_kam',
        reasonCode: 'missing_information',
        note: 'Annual volume by SKU is missing',
      },
      by,
    );

  it('the G3 decider (pricing lead) sees "Rework (back to KAM)"; a pricer cannot use it', async () => {
    const qn = await pricedAndSubmitted();
    const lead = QuoteDetail.parse((await as('PricingLead').get(`/api/v1/quotes/${qn}`)).json());
    const action = lead.availableActions.find(
      (a) => a.gateKey === 'G3' && a.outcomeKey === 'rework_kam',
    );
    expect(action).toMatchObject({
      outcomeLabel: 'Rework (back to KAM)',
      requiresNote: true,
      requiresReasonCode: true,
      targetStageKeys: ['INTAKE'],
    });
    expect(action!.reasonCodes.map((r) => r.code)).toContain('missing_information');
    const pricer = QuoteDetail.parse((await as('Pricing').get(`/api/v1/quotes/${qn}`)).json());
    expect(pricer.availableActions.some((a) => a.gateKey === 'G3')).toBe(false);
    expect((await sendToKam(qn, 'Pricing')).statusCode).toBe(403);
    // Reason and note are required.
    const bare = await decide(qn, 'G3', { outcomeKey: 'rework_kam' }, 'PricingLead');
    expect(errorCodes(bare)).toEqual(['NOTE_REQUIRED', 'REASON_REQUIRED']);
  });

  it('"No" scope change: straight back to Quoting with the same pricer, the record reopened', async () => {
    const qn = await pricedAndSubmitted();
    const pricer = await userId('Pricing');
    const sent = await sendToKam(qn);
    ok(sent);
    expect(GateDecisionResponse.parse(sent.json()).quote).toMatchObject({
      stageKey: 'INTAKE',
      version: 2,
    });
    const row = await quoteRow(qn);
    expect(row).toMatchObject({
      submittedAt: null,
      reworkOriginStageKey: 'QUOTING',
      reworkResumeAt: 'origin',
      assignedPricerId: pricer,
    });

    // The KAM is told, and finds it under "Returned to me" with the reason and the note.
    const told = await db.db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.quoteId, row.id),
          eq(schema.notification.type, 'quote.reworked'),
          eq(schema.notification.userId, await userId('KAM')),
        ),
      );
    expect(told.map((n) => n.channel).sort()).toEqual(['email', 'in_app']);
    const list = IntakeDraftListResponse.parse(
      (await as('KAM').get('/api/v1/quotes/drafts')).json(),
    );
    expect(list.returned.find((r) => r.quoteNumber === qn)).toMatchObject({
      gateKey: 'G3',
      reasonLabel: 'Missing information',
      note: 'Annual volume by SKU is missing',
      originStageKey: 'QUOTING',
      askScopeChange: true,
    });

    // The KAM's dashboard lists it under "Returned to me" too, with the gate, reason and note.
    const dash = (await as('KAM').get('/api/v1/dashboards/KAM')).json<{
      returned: { items: { quoteNumber: string; gateKey: string; reason: string; note: string }[] };
    }>();
    expect(dash.returned.items.find((i) => i.quoteNumber === qn)).toMatchObject({
      gateKey: 'G3',
      reason: 'Missing information',
      note: 'Annual volume by SKU is missing',
    });

    // The KAM fixes it. The scope question is required.
    const draft = IntakeDraft.parse((await as('KAM').post(`/api/v1/quotes/${qn}/rework`)).json());
    expect(draft.rework).toMatchObject({
      gateKey: 'G3',
      askScopeChange: true,
      originStageKey: 'QUOTING',
    });
    ok(
      await as('KAM').patch(`/api/v1/quotes/drafts/${draft.id}`, {
        data: { estAnnualVolume: 800_000 },
      }),
      200,
    );
    const unanswered = await as('KAM').post(`/api/v1/quotes/drafts/${draft.id}/submit`);
    expect(unanswered.statusCode).toBe(422);
    expect(unanswered.json()).toMatchObject({
      errors: [{ path: '/scopeChanged' }],
    });
    expect((await quoteRow(qn)).stageKey).toBe('INTAKE');

    tick();
    const res = await as('KAM').post(`/api/v1/quotes/drafts/${draft.id}/submit`, {
      scopeChanged: false,
    });
    ok(res);
    expect(SubmitIntakeResponse.parse(res.json())).toMatchObject({
      stageKey: 'QUOTING',
      routedTo: 'QUOTING',
      resubmitted: true,
      scopeChanged: false,
      resumedAt: 'QUOTING',
    });
    const after = await quoteRow(qn);
    expect(after).toMatchObject({
      stageKey: 'QUOTING',
      status: 'active',
      version: 2,
      assignedPricerId: pricer,
      pricingSubmittedAt: null,
      reworkOriginStageKey: null,
      reworkResumeAt: null,
    });
    expect(after.submittedAt).not.toBeNull();
    // No G1 or G2 decision after the send-back: Engineering was skipped.
    const decisions = await db.db
      .select()
      .from(schema.gateDecision)
      .where(eq(schema.gateDecision.quoteId, after.id))
      .orderBy(desc(schema.gateDecision.decidedAt));
    expect(decisions[0]).toMatchObject({ gateKey: 'G3', outcomeKey: 'rework_kam' });

    // The pricer edits again (unlocked), the pricing team is told it is back.
    const quoting = QuotingDetail.parse(
      (
        await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
          pricingBasisNote: 'At 800k',
        })
      ).json(),
    );
    expect(quoting).toMatchObject({
      canEdit: true,
      lock: { locked: false },
      assignedPricerId: pricer,
      leadReview: { status: 'none' },
    });
    const back = await db.db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.quoteId, after.id),
          eq(schema.notification.type, 'quote.ready_for_quoting'),
          eq(schema.notification.channel, 'in_app'),
        ),
      )
      .orderBy(desc(schema.notification.createdAt));
    expect(back[0]!.title).toBe(`${qn} is back from the KAM`);

    // Timeline and audit record the answer.
    const timeline = TimelineResponse.parse(
      (await as('KAM').get(`/api/v1/quotes/${qn}/timeline`)).json(),
    );
    const resubmitted = timeline.items.find((e) => e.type === 'quote_resubmitted');
    expect(resubmitted?.payload).toMatchObject({ scopeChanged: false, resumedAt: 'QUOTING' });
    const moved = timeline.items.find(
      (e) => e.type === 'stage_changed' && (e.payload as { resumed?: boolean }).resumed,
    );
    expect(moved?.payload).toMatchObject({ from: 'INTAKE', to: 'QUOTING', scopeChanged: false });
    const audit = await db.db
      .select()
      .from(schema.auditEvent)
      .where(and(eq(schema.auditEvent.quoteId, after.id), eq(schema.auditEvent.entity, 'quote')))
      .orderBy(desc(schema.auditEvent.at));
    expect(audit.map((a) => a.after)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'quote.resubmitted',
          scopeChanged: false,
          resumedAt: 'QUOTING',
        }),
        expect.objectContaining({ stageKey: 'QUOTING', resumedAt: 'QUOTING', scopeChanged: false }),
      ]),
    );
  });

  it('"Yes" scope change: routed as a new submission (waits at G1, then Engineering)', async () => {
    const qn = await pricedAndSubmitted();
    ok(await sendToKam(qn));
    const draft = IntakeDraft.parse((await as('KAM').post(`/api/v1/quotes/${qn}/rework`)).json());
    const res = await as('KAM').post(`/api/v1/quotes/drafts/${draft.id}/submit`, {
      scopeChanged: true,
    });
    ok(res);
    expect(SubmitIntakeResponse.parse(res.json())).toMatchObject({
      stageKey: 'INTAKE',
      routedTo: 'G1',
      scopeChanged: true,
      resumedAt: null,
    });
    expect(await quoteRow(qn)).toMatchObject({
      stageKey: 'INTAKE',
      reworkOriginStageKey: null,
      reworkResumeAt: null,
    });
    // G1 → Engineering as usual.
    ok(await decide(qn, 'G1', { outcomeKey: 'advance' }, 'SalesLeader'));
    expect((await quoteRow(qn)).stageKey).toBe('ENG_REVIEW');
  });

  it('a G2 rework is unchanged: no scope question, back through G1', async () => {
    const qn = await inEngineering();
    ok(
      await decide(
        qn,
        'G2',
        { outcomeKey: 'rework', reasonCode: 'missing_information', note: 'Drawing please' },
        'EngLead',
      ),
    );
    expect(await quoteRow(qn)).toMatchObject({
      reworkOriginStageKey: 'ENG_REVIEW',
      reworkResumeAt: 'intake',
    });
    const draft = IntakeDraft.parse((await as('KAM').post(`/api/v1/quotes/${qn}/rework`)).json());
    expect(draft.rework).toMatchObject({ askScopeChange: false });
    // Even "no scope change" does not skip anything here.
    const res = await as('KAM').post(`/api/v1/quotes/drafts/${draft.id}/submit`, {
      scopeChanged: false,
    });
    ok(res);
    expect(SubmitIntakeResponse.parse(res.json())).toMatchObject({
      routedTo: 'G1',
      scopeChanged: null,
      resumedAt: null,
    });
  });
});

// ── F-069 ──────────────────────────────────────────────────────────────────────────────────────

describe('F-069: the approver is not blocked by fields other roles own (T-026)', () => {
  const setChecks = (value: unknown) =>
    db.db.execute(
      sql`update app_setting set value = ${JSON.stringify(value)}::jsonb where key = 'g4_required_checks'`,
    );

  /** In Final Review with the terms unchecked and a Legal trigger (tooling commitment) fired. */
  async function uncheckedWithLegal() {
    const qn = await inFinalReview();
    ok(
      await as('KAM').put(`/api/v1/quotes/${qn}/terms`, {
        termsToolingCommitment: true,
        termsPaymentTerms: 'Net 30',
      }),
      200,
    );
    return qn;
  }

  it('seeds g4_required_checks = [] (provisional)', async () => {
    const [row] = await db.db
      .select()
      .from(schema.appSetting)
      .where(eq(schema.appSetting.key, 'g4_required_checks'));
    expect(row).toMatchObject({ value: [], provisional: true });
  });

  it('[]: the review screen shows terms and Legal read-only, the open checks as warnings', async () => {
    const qn = await uncheckedWithLegal();
    const res = await as('Approver').get(`/api/v1/quotes/${qn}/review-summary`);
    ok(res, 200);
    const dto = ReviewSummary.parse(res.json());
    expect(dto.termsAndLegal).toMatchObject({
      termsToolingCommitment: true,
      termsPaymentTerms: 'Net 30',
      checkedAt: null,
      legal: { required: true, reasons: [{ code: 'tooling_commitment' }], reviewedOn: null },
      requiredChecks: [],
    });
    expect(dto.warnings.filter((w) => w.link === 'commercial')).toEqual([
      expect.objectContaining({ code: 'TERMS_NOT_CHECKED', severity: 'risk' }),
      expect.objectContaining({ code: 'LEGAL_REVIEW_NOT_RECORDED', severity: 'risk' }),
    ]);
    expect(dto.canDecide).toBe(true);
    const approve = dto.availableActions.find((a) => a.outcomeKey === 'approve');
    expect(approve?.missing).toEqual([]);
  });

  it('[]: the approver approves with unchecked terms; the decision records the warnings seen', async () => {
    const qn = await uncheckedWithLegal();
    const res = await decide(
      qn,
      'G4',
      {
        outcomeKey: 'approve',
        acknowledgedWarnings: ['TERMS_NOT_CHECKED', 'LEGAL_REVIEW_NOT_RECORDED'],
      },
      'Approver',
    );
    ok(res);
    expect(GateDecisionResponse.parse(res.json()).quote.stageKey).toBe('CUSTOMER_DECISION');
    const [d] = await db.db
      .select()
      .from(schema.gateDecision)
      .where(
        and(
          eq(schema.gateDecision.quoteId, (await quoteRow(qn)).id),
          eq(schema.gateDecision.gateKey, 'G4'),
        ),
      );
    expect(d!.payload).toMatchObject({
      acknowledgedWarnings: ['TERMS_NOT_CHECKED', 'LEGAL_REVIEW_NOT_RECORDED'],
    });
    expect(
      (d!.evidence as { review: { termsAndLegal: unknown } }).review.termsAndLegal,
    ).toMatchObject({ checkedAt: null, legal: { required: true } });
  });

  it('a stale screen (a warning it did not show) is refused', async () => {
    const qn = await uncheckedWithLegal();
    const res = await decide(
      qn,
      'G4',
      { outcomeKey: 'approve', acknowledgedWarnings: ['TERMS_NOT_CHECKED'] },
      'Approver',
    );
    expect(res.statusCode).toBe(422);
    expect(errorCodes(res)).toEqual(['STALE_WARNINGS']);
    // acknowledgedWarnings is a Final Review field only.
    const qn2 = await inEngineering();
    const wrong = await decide(
      qn2,
      'G2',
      { outcomeKey: 'proceed', acknowledgedWarnings: [] },
      'EngLead',
    );
    expect(errorCodes(wrong)).toContain('INVALID_VALUE');
  });

  it("['terms_checked']: unchecked terms block the approver; Legal stays optional", async () => {
    await setChecks(['terms_checked']);
    try {
      const qn = await uncheckedWithLegal();
      const dto = ReviewSummary.parse(
        (await as('Approver').get(`/api/v1/quotes/${qn}/review-summary`)).json(),
      );
      expect(dto.termsAndLegal.requiredChecks).toEqual(['terms_checked']);
      expect(dto.warnings.filter((w) => w.link === 'commercial').map((w) => w.code)).toEqual([
        'LEGAL_REVIEW_NOT_RECORDED',
      ]);
      const blocked = await decide(qn, 'G4', { outcomeKey: 'approve' }, 'Approver');
      expect(blocked.statusCode).toBe(422);
      expect(blocked.json<{ errors: { path: string }[] }>().errors.map((e) => e.path)).toEqual([
        '/g4_terms_check_required,terms_checked_at',
      ]);
      ok(await as('KAM').put(`/api/v1/quotes/${qn}/terms`, { checked: true }), 200);
      ok(await decide(qn, 'G4', { outcomeKey: 'approve' }, 'Approver'));
    } finally {
      await setChecks([]);
    }
  });
});

// ── F-003 / F-004 / F-028 ──────────────────────────────────────────────────────────────────────

describe('lead review and pricing assignment notify (T-014, T-015, T-016)', () => {
  /** Active users holding a role (more than the persona may hold it). */
  async function usersWithRole(role: Role) {
    const rows = await db.db
      .select({ id: schema.appUser.id })
      .from(schema.userRole)
      .innerJoin(schema.appUser, eq(schema.appUser.id, schema.userRole.userId))
      .where(and(eq(schema.userRole.role, role), eq(schema.appUser.active, true)));
    return [...new Set(rows.map((r) => r.id))];
  }
  async function rows(qn: string, type: string, userIds: string[]) {
    return db.db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.quoteId, (await quoteRow(qn)).id),
          eq(schema.notification.type, type),
          inArray(schema.notification.userId, userIds),
        ),
      );
  }

  it('T-014: an engineer submits → every EngLead gets an in-app row and an email outbox row', async () => {
    const qn = await inEngineering();
    const engineer = await userId('Engineer');
    ok(await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, { engineerId: engineer }), 200);
    ok(await as('Engineer').post(`/api/v1/quotes/${qn}/eng-review/accept`), 200);
    ok(
      await as('Engineer').put(`/api/v1/quotes/${qn}/eng-review`, {
        processType: 'EBM',
        machineType: 'EBM_SHUTTLE',
        plantCode: 'PLANT_01',
        cavitation: 8,
        cycleTimeS: 14.5,
      }),
      200,
    );
    ok(
      await as('Engineer').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
        rows: [
          {
            site: 'PLANT_01',
            assumedEffectivenessPct: 70,
            cycleTimeS: 14.5,
            utilizationBeforePct: 62,
            analysisDate: '2026-10-26',
            analystId: engineer,
          },
        ],
      }),
      200,
    );
    ok(await as('Engineer').post(`/api/v1/quotes/${qn}/eng-review/submit`), 200);
    const leads = await usersWithRole('EngLead');
    expect(leads.length).toBeGreaterThanOrEqual(1);
    const sent = await rows(qn, 'quote.submitted_to_lead', leads);
    for (const lead of leads) {
      expect(
        sent
          .filter((n) => n.userId === lead)
          .map((n) => n.channel)
          .sort(),
        `EngLead ${lead}`,
      ).toEqual(['email', 'in_app']);
    }
  });

  it('T-015: the pricing lead assigns → the pricer is told and sees it in their assignments', async () => {
    const qn = await inQuoting();
    const pricer = await userId('Pricing');
    ok(
      await as('PricingLead').post(`/api/v1/quotes/${qn}/pricing-assignment`, { pricerId: pricer }),
      200,
    );
    const told = await rows(qn, 'quote.pricing_assigned', [pricer]);
    expect(told.map((n) => n.channel).sort()).toEqual(['email', 'in_app']);
    const mine = PricingQueueResponse.parse(
      (await as('Pricing').get('/api/v1/queue/pricing?pricer=me')).json(),
    );
    expect(mine.items.map((i) => i.quoteNumber)).toContain(qn);
    expect(mine.items.every((i) => i.assignedPricerId === pricer)).toBe(true);
  });

  it('T-016: a pricer submits → the pricing lead is told, and approves G3 or sends it back with a note', async () => {
    const pricer = await userId('Pricing');
    const leads = await usersWithRole('PricingLead');
    // Approve path.
    const a = await inQuoting();
    ok(
      await as('PricingLead').post(`/api/v1/quotes/${a}/pricing-assignment`, { pricerId: pricer }),
      200,
    );
    await pricingDone(a);
    ok(await as('Pricing').post(`/api/v1/quotes/${a}/quoting/submit`), 200);
    const told = await rows(a, 'quote.submitted_to_lead', leads);
    for (const lead of leads) {
      expect(
        told
          .filter((n) => n.userId === lead)
          .map((n) => n.channel)
          .sort(),
      ).toEqual(['email', 'in_app']);
    }
    expect((await decide(a, 'G3', { outcomeKey: 'submit' }, 'Pricing')).statusCode).toBe(403);
    ok(await decide(a, 'G3', { outcomeKey: 'submit' }, 'PricingLead'));
    expect((await quoteRow(a)).stageKey).toBe('FINAL_REVIEW');

    // Send-back path: a note is required; the pricer is told and edits again.
    const b = await inQuoting();
    ok(
      await as('PricingLead').post(`/api/v1/quotes/${b}/pricing-assignment`, { pricerId: pricer }),
      200,
    );
    await pricingDone(b);
    ok(await as('Pricing').post(`/api/v1/quotes/${b}/quoting/submit`), 200);
    expect(
      (await as('PricingLead').post(`/api/v1/quotes/${b}/quoting/send-back`, { note: ' ' }))
        .statusCode,
    ).toBe(400);
    ok(
      await as('PricingLead').post(`/api/v1/quotes/${b}/quoting/send-back`, {
        note: 'Use the October resin index',
      }),
      200,
    );
    expect((await rows(b, 'quote.returned_by_lead', [pricer])).length).toBeGreaterThanOrEqual(1);
    ok(
      await as('Pricing').put(`/api/v1/quotes/${b}/pricing-record`, { pricingBasisNote: 'Oct' }),
      200,
    );
  });
});
