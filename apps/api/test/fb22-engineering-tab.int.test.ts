import {
  AdminSettingsResponse,
  DEV_USER_HEADER,
  EngQueueResponse,
  GateDecisionResponse,
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

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * FB-22 (N17-11 to N17-14, N17-16; record D2): the Engineering tab. The engineer and the production
 * scheduler each submit their part to the engineering lead, who is told per `eng_lead_notify_when` (seed:
 * once both are in); per-part locks and send-backs; the machine platform; Technical concept and Supply chain
 * no longer written; "New" in the queue; and an engineering lead who is the assigned engineer decides G2 on
 * their own work.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-11-19T15:00:00Z');
const tick = (ms = 3_600_000) => {
  clock = new Date(clock.getTime() + ms);
};

let free: string[] = [];
const as = (role: Role) => asRole(app, role);
const ids: Partial<Record<Role, string>> = {};
async function userId(role: Role): Promise<string> {
  ids[role] ??= MeResponse.parse((await as(role).get('/api/v1/me')).json()).user.id;
  return ids[role];
}
const ok = (res: { statusCode: number; body: string }, status = 200) =>
  expect(res.statusCode, res.body).toBe(status);
const errors = (res: { json: () => unknown }) =>
  (res.json() as { errors?: { path: string; code: string; message: string }[] }).errors ?? [];
const errorPaths = (res: { json: () => unknown }) =>
  errors(res)
    .map((e) => e.path)
    .sort();
const putReview = (qn: string, body: Record<string, unknown>, role: Role = 'Engineer') =>
  as(role).put(`/api/v1/quotes/${qn}/eng-review`, body);
const putRows = (qn: string, rows: unknown[], role: Role = 'ProductionScheduler') =>
  as(role).put(`/api/v1/quotes/${qn}/capacity-evidence`, { rows });
const submit = (qn: string, role: Role = 'Engineer') =>
  as(role).post(`/api/v1/quotes/${qn}/eng-review/submit`);
const sendBack = (qn: string, body: unknown, role: Role = 'EngLead') =>
  as(role).post(`/api/v1/quotes/${qn}/eng-review/send-back`, body);

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

/** A quote that cleared G1 and waits in Engineering & Capacity, unassigned. */
async function inEngineering() {
  const id = free.shift();
  if (!id) throw new Error('test ran out of free opportunities');
  const res = await as('KAM').post('/api/v1/quotes/drafts', { data: await prefill(id) });
  ok(res, 201);
  const sub = await as('KAM').post(
    `/api/v1/quotes/drafts/${IntakeDraft.parse(res.json()).id}/submit`,
  );
  ok(sub, 201);
  const { quoteNumber: qn } = SubmitIntakeResponse.parse(sub.json());
  ok(
    await as('SalesLeader').post(`/api/v1/quotes/${qn}/gates/G1/decisions`, {
      outcomeKey: 'advance',
    }),
    201,
  );
  return qn;
}

const assign = (qn: string, body: Record<string, unknown>, role: Role = 'EngLead') =>
  as(role).post(`/api/v1/quotes/${qn}/assignment`, body);

/** In Engineering with the engineer and the production scheduler both assigned. */
async function withBoth() {
  const qn = await inEngineering();
  ok(
    await assign(qn, {
      engineerId: await userId('Engineer'),
      schedulerId: await userId('ProductionScheduler'),
    }),
  );
  return qn;
}

const detail = async (qn: string, role: Role = 'EngLead') => {
  const res = await as(role).get(`/api/v1/quotes/${qn}`);
  ok(res);
  return QuoteDetail.parse(res.json());
};
const queue = async (role: Role, query = '') => {
  const res = await as(role).get(`/api/v1/queue/engineering${query}`);
  ok(res);
  return EngQueueResponse.parse(res.json());
};

/** Notification rows on a quote of one type, for one user, on one channel. */
async function told(qn: string, type: string, to: string, channel: 'in_app' | 'email' = 'in_app') {
  const rows = await db.db
    .select({ id: schema.notification.id })
    .from(schema.notification)
    .innerJoin(schema.quote, eq(schema.quote.id, schema.notification.quoteId))
    .where(
      and(
        eq(schema.quote.quoteNumber, qn),
        eq(schema.notification.type, type),
        eq(schema.notification.userId, to),
        eq(schema.notification.channel, channel),
      ),
    );
  return rows.length;
}
const eventTypes = async (qn: string) =>
  (
    await db.db
      .select({ type: schema.activityEvent.type })
      .from(schema.activityEvent)
      .innerJoin(schema.quote, eq(schema.quote.id, schema.activityEvent.quoteId))
      .where(eq(schema.quote.quoteNumber, qn))
  ).map((e) => e.type);

// Aurora runs EBM only (the plant location list), so EBM at Aurora is a pair every check accepts.
const SOLUTION = {
  plantCode: 'AURORA',
  machineType: 'EBM',
  cavitation: 8,
  cycleTimeS: 14.5,
  // FB-17 (W13-22): G2 needs a preliminary capital figure; $0 means no capital is needed.
  prelimCapitalUsd: 0,
};
const row = async (over: Record<string, unknown> = {}) => ({
  site: 'AURORA',
  lineAsset: 'Line 4',
  assumedEffectivenessPct: 70,
  cycleTimeS: 14.5,
  utilizationBeforePct: 62,
  analysisDate: '2026-11-14',
  analystId: await userId('ProductionScheduler'),
  ...over,
});

async function patchSetting(key: string, value: unknown) {
  const list = await as('Admin').get('/api/v1/admin/config/settings');
  ok(list);
  const current = AdminSettingsResponse.parse(list.json()).items.find((s) => s.key === key)!;
  return as('Admin').patch(`/api/v1/admin/config/settings/${key}`, {
    version: current.version,
    changeReason: 'FB-22 integration test',
    value,
  });
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('fb22_engineering_tab');
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
  expect(free.length).toBeGreaterThanOrEqual(12);
}, 120_000);
afterAll(async () => {
  await app.close();
});

/** The persona who holds EngLead and Engineer (D2), signed in by its dev key. */
const LEAD_ENGINEER = 'eng-lead-engineer';
const asLeadEngineer = {
  get: (url: string) =>
    app.inject({ method: 'GET', url, headers: { [DEV_USER_HEADER]: LEAD_ENGINEER } }),
  post: (url: string, payload?: unknown) =>
    app.inject({
      method: 'POST',
      url,
      headers: { [DEV_USER_HEADER]: LEAD_ENGINEER },
      ...(payload === undefined ? {} : { payload: payload as object }),
    }),
  put: (url: string, payload: unknown) =>
    app.inject({
      method: 'PUT',
      url,
      headers: { [DEV_USER_HEADER]: LEAD_ENGINEER },
      payload: payload as object,
    }),
};
let leadEngineerId: string;

const submitCapacity = (qn: string, role: Role = 'ProductionScheduler') =>
  as(role).post(`/api/v1/quotes/${qn}/eng-review/submit-capacity`);
const accept = (qn: string, role: Role = 'Engineer') =>
  as(role).post(`/api/v1/quotes/${qn}/eng-review/accept`);

/** Both assigned, the solution saved, one capacity row, the review started. */
async function workedByBoth() {
  const qn = await withBoth();
  ok(await accept(qn));
  ok(await putReview(qn, SOLUTION));
  ok(await putRows(qn, [await row()]));
  return qn;
}

describe('FB-22 A: the engineer and the production scheduler each submit their part (N17-14)', () => {
  beforeAll(async () => {
    // The seed: the lead is told once both parts are in.
    expect(
      AdminSettingsResponse.parse(
        (await as('Admin').get('/api/v1/admin/config/settings')).json(),
      ).items.find((s) => s.key === 'eng_lead_notify_when')?.value,
    ).toBe('both_parts');
  });

  it('only the scheduler assigned to the quote submits capacity; it is checked against the capacity rules', async () => {
    const qn = await withBoth();
    ok(await accept(qn));
    ok(await putReview(qn, SOLUTION));
    // No row yet: the capacity rules say what is missing.
    const early = await submitCapacity(qn);
    ok(early, 422);
    expect(errorPaths(early)).toContain('/capacity_evidence');
    expect(
      (await detail(qn, 'ProductionScheduler')).engineering.leadReview.capacitySubmitMissing?.map(
        (m) => m.field,
      ),
    ).toContain('capacity_evidence');
    ok(await putRows(qn, [await row()]));
    expect(
      (await detail(qn, 'ProductionScheduler')).engineering.leadReview.capacitySubmitMissing,
    ).toEqual([]);
    // Not the engineer (who holds capacity.edit on the quote), not the lead, not a KAM.
    ok(await submitCapacity(qn, 'Engineer'), 403);
    ok(await submitCapacity(qn, 'EngLead'), 403);
    ok(await submitCapacity(qn, 'KAM'), 403);
    ok(await submitCapacity(qn));
    ok(await submitCapacity(qn), 409);
    expect(await eventTypes(qn)).toContain('lead_review_submitted');
    const audit = await db.db
      .select({ after: schema.auditEvent.after })
      .from(schema.auditEvent)
      .innerJoin(schema.quote, eq(schema.quote.id, schema.auditEvent.quoteId))
      .where(eq(schema.quote.quoteNumber, qn));
    expect(audit.some((a) => JSON.stringify(a.after).includes('capacitySubmittedAt'))).toBe(true);
  });

  it('with a scheduler assigned, the engineer submits without the capacity rows', async () => {
    const qn = await withBoth();
    ok(await accept(qn));
    ok(await putReview(qn, SOLUTION));
    const lr = (await detail(qn, 'Engineer')).engineering.leadReview;
    expect(lr.submitMissing).toEqual([]);
    ok(await submit(qn));
  });

  it('the lead is told once both parts are in; each submission tells the other person', async () => {
    const qn = await workedByBoth();
    const [lead, engineer, scheduler, kam] = await Promise.all([
      userId('EngLead'),
      userId('Engineer'),
      userId('ProductionScheduler'),
      userId('KAM'),
    ]);
    ok(await submit(qn));
    expect(await told(qn, 'quote.submitted_to_lead', lead)).toBe(0);
    expect(await told(qn, 'quote.part_submitted', scheduler)).toBe(1);
    expect(await told(qn, 'quote.lead_review_update', kam)).toBe(0);
    let lr = (await detail(qn)).engineering.leadReview;
    expect(lr.status).toBe('none');
    expect(lr.parts).toMatchObject({ engineer: { in: true }, scheduler: { in: false } });
    let item = (await queue('EngLead')).items.find((i) => i.quoteNumber === qn)!;
    expect(item.leadReview).toBe('none');

    tick();
    ok(await submitCapacity(qn));
    expect(await told(qn, 'quote.submitted_to_lead', lead)).toBe(1);
    expect(await told(qn, 'quote.submitted_to_lead', lead, 'email')).toBe(1);
    expect(await told(qn, 'quote.part_submitted', engineer)).toBe(1);
    expect(await told(qn, 'quote.lead_review_update', kam)).toBe(1);
    lr = (await detail(qn)).engineering.leadReview;
    expect(lr.status).toBe('submitted');
    expect(lr.parts).toMatchObject({ engineer: { in: true }, scheduler: { in: true } });
    item = (await queue('EngLead', '?review=ready')).items.find((i) => i.quoteNumber === qn)!;
    expect(item.leadReview).toBe('submitted');
    expect(item.submittedAt).toBe(clock.toISOString());
  });

  it('with no scheduler assigned the engineer’s submission tells the lead at once', async () => {
    const qn = await inEngineering();
    const engineer = await userId('Engineer');
    ok(await assign(qn, { engineerId: engineer }));
    ok(await accept(qn));
    ok(await putReview(qn, SOLUTION));
    ok(await putRows(qn, [await row({ analystId: engineer })], 'Engineer'));
    ok(await submit(qn));
    expect(await told(qn, 'quote.submitted_to_lead', await userId('EngLead'))).toBe(1);
    expect((await detail(qn)).engineering.leadReview).toMatchObject({
      status: 'submitted',
      parts: { scheduler: null },
    });
  });

  it('each_part: the lead is told on each submission, and the quote is ready only when both are in', async () => {
    ok(await patchSetting('eng_lead_notify_when', 'each_part'));
    try {
      const qn = await workedByBoth();
      const lead = await userId('EngLead');
      ok(await submitCapacity(qn));
      expect(await told(qn, 'quote.submitted_to_lead', lead)).toBe(1);
      expect((await detail(qn)).engineering.leadReview.status).toBe('none');
      ok(await submit(qn));
      expect(await told(qn, 'quote.submitted_to_lead', lead)).toBe(2);
      expect((await detail(qn)).engineering.leadReview.status).toBe('submitted');
    } finally {
      ok(await patchSetting('eng_lead_notify_when', 'both_parts'));
    }
  });

  it('locks per part: the scheduler’s submission locks the rows, the engineer’s the solution', async () => {
    const qn = await workedByBoth();
    ok(await submitCapacity(qn));
    // The rows: locked for the scheduler and the engineer, open to the lead.
    ok(await putRows(qn, [await row({ lineAsset: 'Line 5' })]), 409);
    ok(await putRows(qn, [await row({ lineAsset: 'Line 5' })], 'Engineer'), 409);
    ok(await putRows(qn, [await row({ lineAsset: 'Line 5' })], 'EngLead'));
    // The engineer's own part is still open until they submit it.
    ok(await putReview(qn, { cavitation: 6 }));
    ok(await submit(qn));
    ok(await putReview(qn, { cavitation: 4 }), 409);
    ok(await putReview(qn, { cavitation: 4 }, 'EngLead'));
  });

  it('a send-back clears only the chosen person’s part', async () => {
    const qn = await workedByBoth();
    ok(await submit(qn));
    ok(await submitCapacity(qn));
    ok(await sendBack(qn, { note: 'Recheck the effectiveness on line 4', to: 'scheduler' }));
    let lr = (await detail(qn)).engineering.leadReview;
    expect(lr.status).toBe('returned');
    expect(lr.parts).toMatchObject({ engineer: { in: true }, scheduler: { in: false } });
    // The scheduler edits again; the engineer is still locked.
    ok(await putRows(qn, [await row({ assumedEffectivenessPct: 65 })]));
    ok(await putReview(qn, { cavitation: 6 }), 409);
    tick();
    ok(await submitCapacity(qn));
    expect((await detail(qn)).engineering.leadReview.status).toBe('submitted');

    ok(await sendBack(qn, { note: 'Check the cavitation' }));
    lr = (await detail(qn)).engineering.leadReview;
    expect(lr.parts).toMatchObject({ engineer: { in: false }, scheduler: { in: true } });
    ok(await putReview(qn, { cavitation: 6 }));
    ok(await putRows(qn, [await row({ assumedEffectivenessPct: 60 })]), 409);
  });

  it('a new production scheduler starts the capacity part afresh', async () => {
    const qn = await workedByBoth();
    ok(await submitCapacity(qn));
    ok(await assign(qn, { engineerId: await userId('Engineer'), schedulerId: null }));
    expect((await detail(qn)).engineering.leadReview.parts?.scheduler).toBeNull();
    ok(
      await assign(qn, {
        engineerId: await userId('Engineer'),
        schedulerId: await userId('ProductionScheduler'),
      }),
    );
    expect((await detail(qn)).engineering.leadReview.parts?.scheduler?.in).toBe(false);
  });
});

describe('FB-22 C: Technical concept and Supply chain are not asked; the machine platform is (N17-12, N17-13)', () => {
  it('saves the platform (80 at most) and refuses the two retired fields', async () => {
    const qn = await withBoth();
    ok(await putReview(qn, { machinePlatform: '  Bekum H-155 line 3 ' }));
    expect((await detail(qn)).engineering.review.machinePlatform).toBe('Bekum H-155 line 3');
    ok(await putReview(qn, { machinePlatform: 'x'.repeat(81) }), 400);
    ok(await putReview(qn, { technicalConceptNotes: 'x' }), 400);
    ok(await putReview(qn, { supplyChainNotes: 'x' }), 400);
    ok(await putReview(qn, { machinePlatform: null }));
    expect((await detail(qn)).engineering.review.machinePlatform).toBeNull();
  });
});

describe('FB-22 D: "New" in the engineering queue (N17-16)', () => {
  it('new to the engineer until Start review, to the scheduler until a capacity row; "New to me" filters', async () => {
    const qn = await withBoth();
    const find = async (role: Role, query = '') =>
      (await queue(role, query)).items.find((i) => i.quoteNumber === qn);
    expect((await find('Engineer'))?.newToMe).toBe(true);
    expect((await find('ProductionScheduler'))?.newToMe).toBe(true);
    expect((await find('EngLead'))?.newToMe).toBe(false);
    expect(await find('Engineer', '?newToMe=true')).toBeDefined();
    expect(await find('EngLead', '?newToMe=true')).toBeUndefined();

    ok(await accept(qn));
    expect((await find('Engineer'))?.newToMe).toBe(false);
    expect(await find('Engineer', '?newToMe=true')).toBeUndefined();
    expect((await find('ProductionScheduler'))?.newToMe).toBe(true);
    ok(await putReview(qn, SOLUTION));
    ok(await putRows(qn, [await row()]));
    expect((await find('ProductionScheduler'))?.newToMe).toBe(false);
  });
});

describe('FB-22 E (D2): an engineering lead decides G2 on their own work', () => {
  beforeAll(async () => {
    const me = MeResponse.parse((await asLeadEngineer.get('/api/v1/me')).json());
    expect(me.roles).toEqual(expect.arrayContaining(['EngLead', 'Engineer']));
    leadEngineerId = me.user.id;
  });

  it('assigned as the engineer, with no scheduler: no submit to anyone, and G2 is theirs to decide', async () => {
    const qn = await inEngineering();
    ok(await assign(qn, { engineerId: leadEngineerId }));
    ok(await asLeadEngineer.post(`/api/v1/quotes/${qn}/eng-review/accept`));
    ok(await asLeadEngineer.put(`/api/v1/quotes/${qn}/eng-review`, SOLUTION));
    ok(
      await asLeadEngineer.put(`/api/v1/quotes/${qn}/capacity-evidence`, {
        rows: [await row({ analystId: leadEngineerId })],
      }),
    );
    const d = QuoteDetail.parse((await asLeadEngineer.get(`/api/v1/quotes/${qn}`)).json());
    expect(d.engineering.leadReview).toMatchObject({
      canSubmit: false,
      submitBlockedReason: null,
      parts: { engineer: { ownerIsLead: true, in: true }, scheduler: null },
    });
    const proceed = d.availableActions.find(
      (a) => a.gateKey === 'G2' && a.outcomeKey === 'proceed',
    );
    expect(proceed?.missing).toEqual([]);
    const res = await asLeadEngineer.post(`/api/v1/quotes/${qn}/gates/G2/decisions`, {
      outcomeKey: 'proceed',
      capacityApproved: true,
    });
    ok(res, 201);
    expect(GateDecisionResponse.parse(res.json()).quote.stageKey).toBe('QUOTING');
  });

  it('with a scheduler: the lead is told when the scheduler submits, then decides', async () => {
    const qn = await inEngineering();
    ok(
      await assign(qn, {
        engineerId: leadEngineerId,
        schedulerId: await userId('ProductionScheduler'),
      }),
    );
    ok(await asLeadEngineer.post(`/api/v1/quotes/${qn}/eng-review/accept`));
    ok(await asLeadEngineer.put(`/api/v1/quotes/${qn}/eng-review`, SOLUTION));
    ok(await putRows(qn, [await row()]));
    ok(await submitCapacity(qn));
    // Told as a lead (not a second time as the engineer), and the quote is ready for review.
    expect(await told(qn, 'quote.submitted_to_lead', leadEngineerId)).toBe(1);
    expect(await told(qn, 'quote.part_submitted', leadEngineerId)).toBe(0);
    expect(await told(qn, 'quote.submitted_to_lead', await userId('EngLead'))).toBe(1);
    const d = QuoteDetail.parse((await asLeadEngineer.get(`/api/v1/quotes/${qn}`)).json());
    expect(d.engineering.leadReview.status).toBe('submitted');
    const item = (await queue('EngLead', '?review=ready')).items.find((i) => i.quoteNumber === qn);
    expect(item?.leadReview).toBe('submitted');
    ok(
      await asLeadEngineer.post(`/api/v1/quotes/${qn}/gates/G2/decisions`, {
        outcomeKey: 'proceed',
        capacityApproved: true,
      }),
      201,
    );
  });

  it('no segregation rule on G2 bars the assigned engineer (the environment’s rules are listed for Ben)', async () => {
    const rules = await db.db
      .select({ key: schema.segregationRule.ruleKey, gates: schema.segregationRule.gateKeys })
      .from(schema.segregationRule);
    expect(rules.filter((r) => (r.gates as string[]).includes('G2'))).toEqual([]);
  });
});
