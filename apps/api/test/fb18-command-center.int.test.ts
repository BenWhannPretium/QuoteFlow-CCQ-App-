import {
  DASHBOARD_ROLES,
  DashboardResponse,
  EngQueueResponse,
  FinalReviewQueueResponse,
  GateQueueResponse,
  IntakeDraft,
  MeResponse,
  PricingQueueResponse,
  QuoteDetail,
  QuoteListResponse,
  ReviewSummary,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type DashQuote,
  type DashboardRole,
  type IntakeDraftData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import { holdsPermission, type Role } from '@ccq/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { DASHBOARD_PERMISSION } from '../src/services/dashboards';
import { testConfig } from '../src/test-utils';

/**
 * FB-18, the server side of the Command Center:
 * - W13-26: a quote on hold comes first in its stage on the dashboards, with the hold's reason, owner
 *   and review date, and the hold goes when the hold ends.
 * - W13-29: merging Analytics into the Command Center changed no permission. Every role opens exactly
 *   the dashboards and analytics routes its permissions allow (PostAward is P2 and has no persona).
 * - W13-31: every quote summary (the queues, the pipeline, the review summary) carries the Salesforce
 *   link once an Admin sets the URL, and null before that.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
const clock = new Date('2026-11-03T15:00:00Z');
const as = (role: Role) => asRole(app, role);

/** The roles that have a dev persona (the matrix test's list). */
const ROLES: Role[] = [
  'KAM',
  'SalesLeader',
  'EngLead',
  'Engineer',
  'ProductionScheduler',
  'Pricing',
  'PricingLead',
  'Finance',
  'Approver',
  'Leadership',
  'Admin',
];

let free: string[] = [];
const nextFree = () => {
  const id = free.shift();
  if (!id) throw new Error('test ran out of free opportunities');
  return id;
};

const me = async (role: Role) => MeResponse.parse((await as(role).get('/api/v1/me')).json()).user;

async function dashboard(role: Role, which: DashboardRole) {
  const res = await as(role).get(`/api/v1/dashboards/${which}`);
  expect(res.statusCode, res.body).toBe(200);
  return DashboardResponse.parse(res.json());
}

/** A KAM-submitted quote waiting for G1 (the intake of gates.int.test.ts). */
async function submitted(): Promise<SubmitIntakeResponse> {
  const sfOpportunityId = nextFree();
  const read = await as('KAM').get(`/api/v1/salesforce/opportunities/${sfOpportunityId}`);
  expect(read.statusCode, read.body).toBe(200);
  const sf = SfOpportunityDetail.parse(read.json());
  const shipTo = sf.account?.shipTo ?? {
    line1: '1 Test St',
    city: 'Testville',
    state: 'MO',
    postal: '63101',
    country: 'US',
  };
  const data: IntakeDraftData = {
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
  const created = await as('KAM').post('/api/v1/quotes/drafts', { data });
  expect(created.statusCode, created.body).toBe(201);
  const draft = IntakeDraft.parse(created.json());
  const res = await as('KAM').post(`/api/v1/quotes/drafts/${draft.id}/submit`);
  expect(res.statusCode, res.body).toBe(201);
  const body = SubmitIntakeResponse.parse(res.json());
  expect(body.routedTo).toBe('G1');
  return body;
}

const decideG1 = (quoteNumber: string, body: Record<string, unknown>) =>
  as('SalesLeader').post(`/api/v1/quotes/${quoteNumber}/gates/G1/decisions`, body);

/** Every quote a stage board lists, in the order it lists them. */
const boardQuotes = (d: { pipeline: { stages: { quotes: DashQuote[] }[] } }) =>
  d.pipeline.stages.flatMap((s) => s.quotes);

beforeAll(async () => {
  const fresh = await freshSfDatabase('fb18');
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
  expect(free.length).toBeGreaterThanOrEqual(2);
}, 120_000);
afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('W13-26: a quote on hold on the Command Center dashboards', () => {
  let held: SubmitIntakeResponse;
  let ownerName: string;

  beforeAll(async () => {
    held = await submitted();
    const owner = await me('SalesLeader');
    ownerName = owner.displayName;
    const res = await decideG1(held.quoteNumber, {
      outcomeKey: 'hold',
      reasonCode: 'awaiting_customer_info',
      note: 'Customer is confirming the volume',
      holdUntil: '2026-12-12',
      holdOwnerId: owner.id,
    });
    expect(res.statusCode, res.body).toBe(201);
    // Make it the oldest quote in its stage, so "on hold first, then the oldest" puts it at the top of
    // the stage whatever the synthetic seed holds.
    await db.db.execute(sql`
      update stage_history set entered_at = '2020-01-01T00:00:00Z'
      where quote_id = ${held.quoteId} and exited_at is null`);
  });

  it('heads its stage on the KAM’s board, with the reason, the owner and the review date', async () => {
    const d = await dashboard('KAM', 'KAM');
    if (d.role !== 'KAM') throw new Error('wrong dashboard');
    const intake = d.pipeline.stages.find((s) => s.stageKey === 'INTAKE');
    expect(intake?.quotes[0]).toMatchObject({
      quoteNumber: held.quoteNumber,
      status: 'on_hold',
      hold: {
        reasonLabel: 'Awaiting customer information',
        ownerName,
        reviewDate: '2026-12-12',
      },
    });
  });

  it('heads its stage on the sales leader’s team board too', async () => {
    const d = await dashboard('SalesLeader', 'SalesLeader');
    if (d.role !== 'SalesLeader') throw new Error('wrong dashboard');
    const intake = d.pipeline.stages.find((s) => s.stageKey === 'INTAKE');
    expect(intake?.quotes[0]).toMatchObject({
      quoteNumber: held.quoteNumber,
      hold: { ownerName, reviewDate: '2026-12-12' },
    });
    // It is on hold, so it is not waiting for the qualification decision.
    expect(d.toQualify.items.map((q) => q.quoteNumber)).not.toContain(held.quoteNumber);
  });

  it('lists quotes on hold first in every stage, and only they carry a hold', async () => {
    const kam = await dashboard('KAM', 'KAM');
    const leader = await dashboard('SalesLeader', 'SalesLeader');
    if (kam.role !== 'KAM' || leader.role !== 'SalesLeader') throw new Error('wrong dashboard');
    for (const d of [kam, leader]) {
      for (const stage of d.pipeline.stages) {
        const onHold = stage.quotes.map((q) => q.status === 'on_hold');
        const heldFirst = [...onHold].sort((a, b) => Number(b) - Number(a));
        expect(onHold, `${d.role} ${stage.stageKey}`).toEqual(heldFirst);
      }
      for (const q of boardQuotes(d)) {
        expect(q.hold !== null, `${d.role} ${q.quoteNumber}`).toBe(q.status === 'on_hold');
      }
    }
  });

  it('says about each hold what the quote row says: the owner and the review date', async () => {
    const d = await dashboard('SalesLeader', 'SalesLeader');
    if (d.role !== 'SalesLeader') throw new Error('wrong dashboard');
    const heldQuotes = boardQuotes(d).filter((q) => q.hold !== null);
    expect(heldQuotes.length).toBeGreaterThan(0);
    for (const q of heldQuotes) {
      const [row] = await db.db.execute<{ owner: string | null; review: string | null }>(sql`
        select u.display_name as owner, to_char(q.review_date, 'YYYY-MM-DD') as review
        from quote q left join app_user u on u.id = q.hold_owner_id
        where q.quote_number = ${q.quoteNumber}`);
      expect(q.hold, q.quoteNumber).toMatchObject({
        ownerName: row!.owner,
        reviewDate: row!.review,
      });
    }
  });

  it('marks a proposal on hold on the proposal lists, and no other', async () => {
    const d = await dashboard('SalesLeader', 'SalesLeader');
    if (d.role !== 'SalesLeader') throw new Error('wrong dashboard');
    for (const p of d.lackingOutcomes.items) {
      const [row] = await db.db.execute<{ status: string }>(
        sql`select status from quote where quote_number = ${p.quoteNumber}`,
      );
      expect(p.hold !== null, p.quoteNumber).toBe(row!.status === 'on_hold');
    }
  });

  it('is scoped like the quote: another KAM’s Command Center never names it', async () => {
    const res = await asRole(app, 'KAM', 'owner').get('/api/v1/dashboards/KAM');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain(held.quoteNumber);
  });

  it('carries no hold once a decision ends the hold', async () => {
    const res = await decideG1(held.quoteNumber, { outcomeKey: 'advance' });
    expect(res.statusCode, res.body).toBe(201);
    const [row] = await db.db
      .select({ status: schema.quote.status, holdOwnerId: schema.quote.holdOwnerId })
      .from(schema.quote)
      .where(eq(schema.quote.id, held.quoteId));
    expect(row).toMatchObject({ status: 'active', holdOwnerId: null });
    const d = await dashboard('KAM', 'KAM');
    if (d.role !== 'KAM') throw new Error('wrong dashboard');
    const listed = boardQuotes(d).filter((q) => q.quoteNumber === held.quoteNumber);
    for (const q of listed) expect(q).toMatchObject({ status: 'active', hold: null });
    const intake = d.pipeline.stages.find((s) => s.stageKey === 'INTAKE');
    expect(intake?.quotes.map((q) => q.quoteNumber)).not.toContain(held.quoteNumber);
  });
});

describe('W13-29: the Command Center changed no permission', () => {
  it.each(ROLES)('%s opens exactly the dashboards its permissions allow', async (role) => {
    for (const which of DASHBOARD_ROLES) {
      const allowed = holdsPermission({ roles: [role] }, DASHBOARD_PERMISSION[which]);
      const res = await as(role).get(`/api/v1/dashboards/${which}`);
      const said = `${role} → ${which}: ${res.body.slice(0, 200)}`;
      expect(res.statusCode, said).toBe(allowed ? 200 : 403);
      if (!allowed) expect(res.json()).toMatchObject({ code: 'dashboard_forbidden' });
    }
  });

  it.each(ROLES)('%s reads the analytics routes only with analytics.read', async (role) => {
    const allowed = holdsPermission({ roles: [role] }, 'analytics.read');
    for (const path of ['pipeline', 'outcomes', 'cycle-time', 'filters']) {
      const res = await as(role).get(`/api/v1/analytics/${path}`);
      expect(res.statusCode, `${role} ${path}`).toBe(allowed ? 200 : 403);
    }
  });

  it('analytics.read is still held by the same seven roles', () => {
    const holders = ROLES.filter((role) => holdsPermission({ roles: [role] }, 'analytics.read'));
    expect(holders).toEqual([
      'SalesLeader',
      'EngLead',
      'Pricing',
      'PricingLead',
      'Approver',
      'Leadership',
      'Admin',
    ]);
  });
});

describe('W13-31: the Salesforce link on every quote summary', () => {
  const INSTANCE = 'https://ccq-test.lightning.force.com';
  interface Linked {
    quoteNumber: string;
    sfOpportunityId: string;
    sfOpportunityUrl: string | null;
  }

  /** Every list that names an opportunity, each read by a role that works it. */
  async function lists() {
    const get = async (role: Role, url: string) => {
      const res = await as(role).get(url);
      expect(res.statusCode, `${role} ${url}: ${res.body.slice(0, 200)}`).toBe(200);
      return res.json<unknown>();
    };
    const g1 = GateQueueResponse.parse(await get('SalesLeader', '/api/v1/gates/G1/queue'));
    const eng = EngQueueResponse.parse(await get('EngLead', '/api/v1/queue/engineering'));
    const pricing = PricingQueueResponse.parse(await get('Pricing', '/api/v1/queue/pricing'));
    const review = FinalReviewQueueResponse.parse(await get('Approver', '/api/v1/approvals'));
    const quotes = QuoteListResponse.parse(await get('SalesLeader', '/api/v1/quotes?pageSize=25'));
    const named: Record<string, Linked[]> = {
      'G1 queue': g1.items,
      'engineering queue': [...eng.items, ...eng.mine],
      'pricing queue': pricing.items,
      'Final Review queue': review.items,
      pipeline: quotes.items,
    };
    return { named, pipeline: quotes.items, finalReview: review.items };
  }

  const setInstanceUrl = async (value: string) => {
    const [setting] = await db.db
      .select()
      .from(schema.appSetting)
      .where(eq(schema.appSetting.key, 'salesforce_instance_url'));
    return as('Admin').patch('/api/v1/admin/config/settings/salesforce_instance_url', {
      version: setting!.version,
      changeReason: 'FB-18 test: set the Salesforce instance URL',
      value,
    });
  };

  it('is null on every list while the URL is not set', async () => {
    const all = await lists();
    expect(all.pipeline.length).toBeGreaterThan(5);
    for (const [name, items] of Object.entries(all.named)) {
      for (const item of items) {
        expect(item.sfOpportunityId, `${name} ${item.quoteNumber}`).toBeTruthy();
        expect(item.sfOpportunityUrl, `${name} ${item.quoteNumber}`).toBeNull();
      }
    }
  });

  it('is the Lightning record of each row’s own opportunity once an Admin sets the URL', async () => {
    const set = await setInstanceUrl(`${INSTANCE}/`);
    expect(set.statusCode, set.body).toBe(200);
    const all = await lists();
    for (const [name, items] of Object.entries(all.named)) {
      for (const item of items) {
        const link = `${INSTANCE}/lightning/r/Opportunity/${item.sfOpportunityId}/view`;
        expect(item.sfOpportunityUrl, `${name} ${item.quoteNumber}`).toBe(link);
      }
    }
    // The quote page reads the same field.
    const listed = all.pipeline[0]!;
    const detail = await as('SalesLeader').get(`/api/v1/quotes/${listed.quoteNumber}`);
    expect(detail.statusCode, detail.body).toBe(200);
    expect(QuoteDetail.parse(detail.json()).sfOpportunityUrl).toBe(listed.sfOpportunityUrl);
    // So does the Final Review screen, for a quote that is in Final Review.
    const waiting = all.finalReview[0];
    if (waiting) {
      const res = await as('Approver').get(`/api/v1/quotes/${waiting.quoteNumber}/review-summary`);
      expect(res.statusCode, res.body).toBe(200);
      expect(ReviewSummary.parse(res.json()).quote.sfOpportunityUrl).toBe(waiting.sfOpportunityUrl);
    }
  });
});
