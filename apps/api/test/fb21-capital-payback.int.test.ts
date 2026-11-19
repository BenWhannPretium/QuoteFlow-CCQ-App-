import {
  IntakeDraft,
  MeResponse,
  QuoteDetail,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import type { Role } from '@ccq/domain';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prepareBom, uploadModel } from './model-helpers';
import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * FB-21 (N17-19 to N17-23, N18-15, Ben's decisions of 2026-11-18): Quoting.
 *
 * Part A: capital readiness starts on "pending" when Engineering says capital is needed and on "not
 * required" when it does not (app_setting `capital_readiness_default`); pending never blocks G3, "not
 * approved" does.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-11-18T15:00:00Z');
const HOUR = 3_600_000;
const tick = (ms = HOUR) => {
  clock = new Date(clock.getTime() + ms);
};

let free: string[] = [];
const as = (role: Role) => asRole(app, role);
const ids: Partial<Record<Role, string>> = {};
async function userId(role: Role): Promise<string> {
  ids[role] ??= MeResponse.parse((await as(role).get('/api/v1/me')).json()).user.id;
  return ids[role];
}
const decide = (qn: string, gate: string, body: Record<string, unknown>, role: Role) =>
  as(role).post(`/api/v1/quotes/${qn}/gates/${gate}/decisions`, body);
const ok = (res: { statusCode: number; body: string }, status = 201) =>
  expect(res.statusCode, res.body).toBe(status);

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
    ...over,
  };
}

/** A synthetic quote Engineering cleared into Quoting with this preliminary capital (USD). */
async function inQuoting(prelimCapitalUsd: number) {
  const id = free.shift();
  if (!id) throw new Error('test ran out of free opportunities');
  const res = await as('KAM').post('/api/v1/quotes/drafts', { data: await prefill(id) });
  ok(res);
  const sub = await as('KAM').post(
    `/api/v1/quotes/drafts/${IntakeDraft.parse(res.json()).id}/submit`,
  );
  ok(sub);
  const { quoteNumber: qn } = SubmitIntakeResponse.parse(sub.json());
  ok(await decide(qn, 'G1', { outcomeKey: 'advance' }, 'SalesLeader'));
  await engineered(qn, prelimCapitalUsd);
  ok(await decide(qn, 'G2', { outcomeKey: 'proceed' }, 'EngLead'));
  tick();
  return qn;
}

/** Engineering's review, capacity row and sign-off; the equipment BOM when capital is needed. */
async function engineered(qn: string, prelimCapitalUsd: number) {
  ok(
    await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, {
      processType: 'EBM',
      machineType: 'EBM',
      plantCode: 'AURORA',
      cavitation: 8,
      cycleTimeS: 14.5,
      prelimCapitalUsd,
    }),
    200,
  );
  ok(
    await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
      rows: [
        {
          site: 'AURORA',
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
  if (prelimCapitalUsd > 0) await prepareBom(app, qn);
}

async function detail(qn: string, role: Role = 'Pricing') {
  const res = await as(role).get(`/api/v1/quotes/${qn}`);
  ok(res, 200);
  return QuoteDetail.parse(res.json());
}
const quoteId = async (qn: string) =>
  (await db.db.select().from(schema.quote).where(eq(schema.quote.quoteNumber, qn)))[0]!.id;

/** The readiness audit rows of a quote's pricing records, oldest first. */
async function readinessAudits(qn: string) {
  const rows = await db.db
    .select({
      actorId: schema.auditEvent.actorId,
      before: schema.auditEvent.before,
      after: schema.auditEvent.after,
    })
    .from(schema.auditEvent)
    .where(
      and(
        eq(schema.auditEvent.quoteId, await quoteId(qn)),
        eq(schema.auditEvent.entity, 'pricing_record'),
      ),
    )
    .orderBy(schema.auditEvent.at);
  return rows.filter((r) => (r.after as { source?: string } | null)?.source !== undefined);
}

/** The pricer's part: costing model, attested costing and the price approval named. No capital PUT. */
async function priced(qn: string) {
  ok(await uploadModel(app, qn, 'cost_model', 'Pricing'));
  ok(
    await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
      approvedBy: await userId('Pricing'),
      approvedAt: new Date(clock.getTime() - HOUR).toISOString(),
      costingCompleted: true,
    }),
    200,
  );
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('fb21_quoting');
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
  expect(free.length).toBeGreaterThanOrEqual(8);
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('Part A (N17-19, N17-20): capital readiness pending is normal and never blocks', () => {
  it('a $20,000 quote starts on "pending", audited, and the lead advances G3 with no note', async () => {
    const qn = await inQuoting(20_000);
    const d = await detail(qn);
    expect(d.quoting.capitalNeeded).toBe(true);
    expect(d.quoting.pricingRecord?.capitalReadiness).toBe('pending');
    expect(d.quoting.pricingRecord?.capitalPendingJustification).toBeNull();
    // The default is the G2 decider's change, audited with where it came from.
    const audits = await readinessAudits(qn);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: await userId('EngLead'),
      before: { capitalReadiness: null },
      after: {
        capitalReadiness: 'pending',
        source: 'capital_readiness_default',
        capitalNeeded: true,
      },
    });

    await priced(qn);
    // Part B: no one asked Finance for a payback model, so none is needed either.
    const g3 = await decide(qn, 'G3', { outcomeKey: 'submit' }, 'PricingLead');
    ok(g3);
    expect((await detail(qn)).stageKey).toBe('FINAL_REVIEW');
  });

  it('a $0 quote starts on "not required" (audited); the pricer can still change it', async () => {
    const qn = await inQuoting(0);
    const d = await detail(qn);
    expect(d.quoting.capitalNeeded).toBe(false);
    expect(d.quoting.pricingRecord?.capitalReadiness).toBe('not_required');
    expect((await readinessAudits(qn)).map((a) => a.after)).toEqual([
      {
        capitalReadiness: 'not_required',
        source: 'capital_readiness_default',
        capitalNeeded: false,
        quoteVersion: 1,
      },
    ]);
    ok(
      await as('Pricing').put(`/api/v1/quotes/${qn}/capital-readiness`, {
        capitalReadiness: 'pending',
      }),
      200,
    );
    expect((await detail(qn)).quoting.pricingRecord?.capitalReadiness).toBe('pending');
  });

  it('"not approved" cannot advance (plain words); the lead can stop it or change readiness', async () => {
    const qn = await inQuoting(20_000);
    await priced(qn);
    ok(
      await as('Pricing').put(`/api/v1/quotes/${qn}/capital-readiness`, {
        capitalReadiness: 'not_approved',
      }),
      200,
    );
    const refused = await decide(qn, 'G3', { outcomeKey: 'submit' }, 'PricingLead');
    expect(refused.statusCode).toBe(422);
    expect(refused.body).toContain('capital_not_approved');
    expect(refused.body).toContain(
      'Capital is marked not approved: stop the quote, or change capital readiness',
    );
    expect((await detail(qn)).stageKey).toBe('QUOTING');
    // Pending again: it goes ahead.
    ok(
      await as('PricingLead').put(`/api/v1/quotes/${qn}/capital-readiness`, {
        capitalReadiness: 'pending',
      }),
      200,
    );
    ok(await decide(qn, 'G3', { outcomeKey: 'submit' }, 'PricingLead'));
  });

  it('"Not required" is still refused while Engineering says capital is needed', async () => {
    const qn = await inQuoting(20_000);
    const res = await as('Pricing').put(`/api/v1/quotes/${qn}/capital-readiness`, {
      capitalReadiness: 'not_required',
    });
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('Engineering said capital is needed');
  });

  it('back from Engineering (a new version): the new record starts on the default again', async () => {
    const qn = await inQuoting(0);
    ok(
      await decide(
        qn,
        'G3',
        { outcomeKey: 'rework', note: 'Re-check the mold', reasonCode: await reworkReason() },
        'PricingLead',
      ),
    );
    await engineered(qn, 45_000);
    ok(await decide(qn, 'G2', { outcomeKey: 'proceed' }, 'EngLead'));
    const d = await detail(qn);
    expect(d.version).toBe(2);
    expect(d.quoting.pricingRecord?.capitalReadiness).toBe('pending');
    expect((await readinessAudits(qn)).map((a) => a.after)).toMatchObject([
      { capitalReadiness: 'not_required', quoteVersion: 1 },
      { capitalReadiness: 'pending', quoteVersion: 2 },
    ]);
  });
});

/** Any active rework reason code (send-backs need one since FB-17). */
async function reworkReason(): Promise<string> {
  const rows = await db.db.execute<{ code: string }>(sql`
    select code from reason_code where context = 'rework' and active order by code limit 1`);
  return rows[0]!.code;
}

// ── Part B (N17-21, N17-22): payback only when someone asks Finance ─────────────────────────────

/** Notifications of a type on a quote: who, by channel. */
async function notified(qn: string, type: string, channel: 'in_app' | 'email' = 'in_app') {
  const rows = await db.db
    .select({ userId: schema.notification.userId })
    .from(schema.notification)
    .where(
      and(
        eq(schema.notification.quoteId, await quoteId(qn)),
        eq(schema.notification.type, type),
        eq(schema.notification.channel, channel),
      ),
    );
  return rows.map((r) => r.userId).sort();
}
async function usersWithRole(role: string) {
  const rows = await db.db.execute<{ id: string }>(sql`
    select distinct u.id from app_user u join user_role r on r.user_id = u.id
    where r.role = ${role} and u.active`);
  return rows.map((r) => r.id).sort();
}
const assignPricer = async (qn: string, role: Role) =>
  ok(
    await as('PricingLead').post(`/api/v1/quotes/${qn}/pricing-assignment`, {
      pricerId: await userId(role),
    }),
    200,
  );
const ask = (qn: string, role: Role, note?: string) =>
  as(role).post(`/api/v1/quotes/${qn}/quoting/payback-request`, note === undefined ? {} : { note });
const withdraw = (qn: string, role: Role, reason: string) =>
  as(role).post(`/api/v1/quotes/${qn}/quoting/payback-request/withdraw`, { reason });
const steps = async (qn: string, role: Role = 'Pricing') => (await detail(qn, role)).quoting.steps;

describe('Part B (N17-21, N17-22): a payback model only when someone asks Finance', () => {
  beforeAll(async () => {
    // Provision every persona that is told or named (Finance, both leads).
    for (const role of ['Finance', 'PricingLead', 'Pricing', 'Admin'] as Role[]) await userId(role);
  });

  it('no request: Finance is not told on a costing upload, the step says "Not requested", G3 needs no payback', async () => {
    const qn = await inQuoting(20_000);
    await priced(qn);
    expect(await notified(qn, 'quote.ready_for_roi')).toEqual([]);
    const s = await steps(qn);
    expect(s.roi).toMatchObject({
      status: 'not_requested',
      required: false,
      request: { status: 'none' },
      // The roi_required_when hint: capital is flagged likely ($20,000).
      hint: 'Finance’s payback model may be useful here: Capital is flagged likely',
    });
    expect(s.roi.notRequiredText).toMatch(/^Not requested/);
    expect([s.current, s.price.status]).toEqual(['price', 'waiting']);
    ok(await decide(qn, 'G3', { outcomeKey: 'submit' }, 'PricingLead'));
  });

  it('the assigned pricer asks; Finance is told; G3 waits for an upload after the request; the pricer and every lead are told', async () => {
    const qn = await inQuoting(20_000);
    await assignPricer(qn, 'Pricing');
    // Costing comes first.
    const early = await ask(qn, 'Pricing');
    expect(early.statusCode).toBe(409);
    expect(early.body).toContain('Upload the costing model first');
    await priced(qn);
    expect((await steps(qn)).roi.canRequest).toBe(true);
    ok(await ask(qn, 'Pricing', 'Board pack on Friday (synthetic)'), 200);
    const finance = await usersWithRole('Finance');
    expect(finance.length).toBeGreaterThan(0);
    expect(await notified(qn, 'quote.ready_for_roi')).toEqual(finance);
    expect(await notified(qn, 'quote.ready_for_roi', 'email')).toEqual(finance);
    let s = await steps(qn);
    expect(s.roi).toMatchObject({
      status: 'waiting',
      required: true,
      canRequest: false,
      canWithdraw: true,
      request: { status: 'open', note: 'Board pack on Friday (synthetic)' },
    });
    expect(s.roi.request.requestedByName).toBeTruthy();
    expect([s.current, s.price.status]).toEqual(['roi', 'blocked']);
    // One open request at a time.
    expect((await ask(qn, 'PricingLead')).statusCode).toBe(409);
    // G3 waits for Finance.
    const blocked = await decide(qn, 'G3', { outcomeKey: 'submit' }, 'PricingLead');
    expect(blocked.statusCode).toBe(422);
    expect(blocked.body).toContain('roi_required,payback_received');

    tick();
    ok(await uploadModel(app, qn, 'roi_model', 'Finance'));
    const leads = await usersWithRole('PricingLead');
    expect(await notified(qn, 'quote.roi_uploaded')).toEqual(
      [...new Set([...leads, await userId('Pricing')])].sort(),
    );
    s = await steps(qn);
    expect(s.roi).toMatchObject({ status: 'done', request: { status: 'received' } });
    ok(await decide(qn, 'G3', { outcomeKey: 'submit' }, 'PricingLead'));

    // Timeline and audit.
    const events = await db.db
      .select({ payload: schema.activityEvent.payload })
      .from(schema.activityEvent)
      .where(
        and(
          eq(schema.activityEvent.quoteId, await quoteId(qn)),
          eq(schema.activityEvent.type, 'payback_requested'),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ note: 'Board pack on Friday (synthetic)' });
    const audits = await db.db
      .select({ after: schema.auditEvent.after })
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.quoteId, await quoteId(qn)),
          eq(schema.auditEvent.entity, 'pricing_record'),
        ),
      );
    expect(
      audits.some((a) => (a.after as { paybackRequest?: unknown } | null)?.paybackRequest),
    ).toBe(true);
  });

  it('a lead who asks is told once on the upload; a pricer not assigned cannot ask', async () => {
    const qn = await inQuoting(20_000);
    await priced(qn);
    // Nobody is assigned: the plain pricer is refused at the quote (the gate lets Pricing through).
    expect((await ask(qn, 'Pricing')).statusCode).toBe(403);
    ok(await ask(qn, 'PricingLead'), 200);
    tick();
    ok(await uploadModel(app, qn, 'roi_model', 'Finance'));
    expect(await notified(qn, 'quote.roi_uploaded')).toEqual(await usersWithRole('PricingLead'));
  });

  it('withdrawn: Finance is told to stop and G3 no longer needs the payback model', async () => {
    const qn = await inQuoting(20_000);
    await assignPricer(qn, 'Pricing');
    await priced(qn);
    ok(await ask(qn, 'Pricing'), 200);
    expect((await withdraw(qn, 'Pricing', '  ')).statusCode).toBe(400);
    expect((await withdraw(qn, 'Finance', 'x')).statusCode).toBe(403);
    ok(await withdraw(qn, 'Pricing', 'Customer dropped the capital ask (synthetic)'), 200);
    expect(await notified(qn, 'quote.payback_request_withdrawn')).toEqual(
      await usersWithRole('Finance'),
    );
    const s = await steps(qn);
    expect(s.roi).toMatchObject({
      status: 'not_requested',
      required: false,
      canRequest: true,
      canWithdraw: false,
      request: {
        status: 'withdrawn',
        withdrawReason: 'Customer dropped the capital ask (synthetic)',
      },
    });
    expect((await withdraw(qn, 'Pricing', 'again')).statusCode).toBe(409);
    ok(await decide(qn, 'G3', { outcomeKey: 'submit' }, 'PricingLead'));
  });

  it('a payback model uploaded with no request tells the pricing leads only', async () => {
    const qn = await inQuoting(20_000);
    await assignPricer(qn, 'Pricing');
    await priced(qn);
    ok(await uploadModel(app, qn, 'roi_model', 'Finance'));
    expect(await notified(qn, 'quote.roi_uploaded')).toEqual(await usersWithRole('PricingLead'));
    expect((await steps(qn)).roi.status).toBe('done');
  });
});

// ── Part C (N17-23): the pricer's hand-off to the pricing lead ───────────────────────────────────

/** The G3 Advance rule before FB-21 (migration 0031), to reproduce what the demo saw. */
const G3_RULES_BEFORE_FB21 = JSON.parse(
  '[{"anyOf":[{"allOf":[{"field":"pricing_record.price_approved_by","op":"present"},{"field":"pricing_record.price_approved_at","op":"present"}]},{"field":"pass_through_eligible","op":"equals","value":true}]},{"field":"pricing_record.costing_completed","op":"equals","value":true},{"field":"pricing_record.capital_readiness","op":"present"},{"anyOf":[{"field":"pricing_record.capital_readiness","op":"oneOf","value":["not_required","pre_approved","not_approved"]},{"field":"pricing_record.capital_pending_justification","op":"present"}]},{"anyOf":[{"field":"capital_likely","op":"equals","value":false},{"field":"pricing_record.capital_readiness","op":"oneOf","value":["not_required","pre_approved"]}]},{"anyOf":[{"field":"cost_model_on_file","op":"equals","value":true},{"field":"pricing_record.cost_model_requirement","op":"equals","value":"grandfathered"}]},{"anyOf":[{"field":"roi_required","op":"equals","value":false},{"field":"roi_model_on_file","op":"equals","value":true}]}]',
) as unknown[];

describe('Part C (N17-23): the pricer submits to the pricing lead', () => {
  it('reproduction: before FB-21 the pricer’s submit was held back by pending capital; now it is offered', async () => {
    const qn = await inQuoting(20_000);
    await assignPricer(qn, 'Pricing');
    await priced(qn);
    const current = await db.db.execute<{ required_fields: unknown }>(sql`
      select required_fields from gate_outcome_definition where gate_key = 'G3' and key = 'submit'`);
    const saved = JSON.stringify(current[0]!.required_fields);
    await db.db.execute(sql`
      update gate_outcome_definition set required_fields = ${JSON.stringify(G3_RULES_BEFORE_FB21)}::jsonb
      where gate_key = 'G3' and key = 'submit'`);
    try {
      const before = (await detail(qn)).quoting.leadReview;
      // The button existed (canSubmit) but was hidden behind two capital items, listed only at the
      // bottom of the tab.
      expect(before.canSubmit).toBe(true);
      expect((before.submitMissing ?? []).map((m) => m.field).sort()).toEqual([
        'capital_likely,pricing_record.capital_readiness',
        'pricing_record.capital_readiness,pricing_record.capital_pending_justification',
      ]);
    } finally {
      await db.db.execute(sql`
        update gate_outcome_definition set required_fields = ${saved}::jsonb
        where gate_key = 'G3' and key = 'submit'`);
    }
    const after = (await detail(qn)).quoting.leadReview;
    expect([after.canSubmit, after.submitMissing]).toEqual([true, []]);
  });

  it('the pricer submits; every pricing lead is told in-app and by email; the pricer is locked', async () => {
    const qn = await inQuoting(20_000);
    await assignPricer(qn, 'Pricing');
    await priced(qn);
    ok(await as('Pricing').post(`/api/v1/quotes/${qn}/quoting/submit`), 200);
    const leads = await usersWithRole('PricingLead');
    expect(await notified(qn, 'quote.submitted_to_lead')).toEqual(leads);
    expect(await notified(qn, 'quote.submitted_to_lead', 'email')).toEqual(leads);
    const d = await detail(qn);
    expect(d.quoting.leadReview).toMatchObject({ status: 'submitted', canSubmit: false });
    expect(d.quoting.canEdit).toBe(false);
    // The lead decides on pending capital, no note.
    ok(await decide(qn, 'G3', { outcomeKey: 'submit' }, 'PricingLead'));
  });

  it('Ben, 2026-11-18: a pricing lead assigned to themselves does the work and approves it (G3)', async () => {
    const qn = await inQuoting(20_000);
    await assignPricer(qn, 'PricingLead');
    const before = (await detail(qn, 'PricingLead')).quoting;
    expect(before.assignedPricerId).toBe(await userId('PricingLead'));
    // A lead has nobody to submit to: no submit, no "only the assigned pricer" line.
    expect(before.leadReview).toMatchObject({ canSubmit: false, submitBlockedReason: null });
    ok(await uploadModel(app, qn, 'cost_model', 'PricingLead'));
    ok(
      await as('PricingLead').put(`/api/v1/quotes/${qn}/pricing-record`, {
        approvedBy: await userId('PricingLead'),
        approvedAt: new Date(clock.getTime() - HOUR).toISOString(),
        costingCompleted: true,
      }),
      200,
    );
    const g3 = (await detail(qn, 'PricingLead')).availableActions.find(
      (a) => a.gateKey === 'G3' && a.outcomeKey === 'submit',
    );
    expect(g3?.missing).toEqual([]);
    ok(await decide(qn, 'G3', { outcomeKey: 'submit' }, 'PricingLead'));
    expect((await detail(qn, 'PricingLead')).stageKey).toBe('FINAL_REVIEW');
  });
});
