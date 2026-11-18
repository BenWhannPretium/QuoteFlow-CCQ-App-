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
    // Until Part B: a capital quote may still need Finance's payback model; it never needs a note.
    ok(await uploadModel(app, qn, 'roi_model', 'Finance'));
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
    ok(await uploadModel(app, qn, 'roi_model', 'Finance'));
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
