import {
  AssignmentResponse,
  EngineeringDetail,
  EngQueueResponse,
  GateDecisionResponse,
  IntakeDraft,
  MeResponse,
  NotificationListResponse,
  QuoteDetail,
  SfOpportunityDetail,
  StageTimesResponse,
  SubmitIntakeResponse,
  type EngQueueItem,
  type IntakeDraftData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import type { Role } from '@ccq/domain';
import { and, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * B-10: the engineering queue (order, aging, filters, alerts, assignment, acceptance), the
 * Engineering Review and capacity evidence (who may edit, commercial redaction, rescoring) and the
 * G2 outcomes through the generic gate route.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
// Monday 2026-10-26, 10:00 US Central. Tests move the clock forward only.
let clock = new Date('2026-10-26T15:00:00Z');
const DAY = 86_400_000;

let free: string[] = [];
/** Quotes this file created, oldest first: closed again (in SQL) to free their opportunity. */
const created: string[] = [];
async function nextFree(): Promise<string> {
  const id = free.shift();
  if (id) return id;
  // The fixture has ~20 open opportunities without a quote: recycle the oldest quote of an earlier test.
  const old = created.shift();
  if (!old) throw new Error('test ran out of free opportunities');
  const [row] = await db.db.execute<{ id: string }>(sql`
    update quote set stage_key = 'DECLINED', status = 'closed', outcome = 'declined', closed_at = now()
    where quote_number = ${old} returning sf_opportunity_id as id`);
  return row!.id;
}
const ids: Partial<Record<string, string>> = {};

const as = (role: Role, scope?: 'all' | 'owner') => asRole(app, role, scope);

async function userId(role: Role, scope: 'all' | 'owner' = 'all'): Promise<string> {
  const key = `${role}:${scope}`;
  if (!ids[key]) {
    const res = await as(role, scope).get('/api/v1/me');
    ids[key] = MeResponse.parse(res.json()).user.id;
  }
  return ids[key];
}

async function prefill(sfOpportunityId: string, over: IntakeDraftData = {}) {
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
    neckFinish: '38-400',
    packagingType: 'BULK',
    estAnnualVolume: 750_000,
    estAnnualRevenue: 150_000,
    expectedCloseDate: '2026-12-15',
    containerSize: '16 oz',
    standardDescription: '16 oz Bottle, HDPE',
    drawingStatus: 'HAVE_DRAWING',
    ...over,
  };
}

/** A quote the SalesLeader advanced into Engineering Review (at the current clock). */
async function inQueue(over: IntakeDraftData = {}): Promise<string> {
  const res = await as('KAM').post('/api/v1/quotes/drafts', {
    data: await prefill(await nextFree(), over),
  });
  expect(res.statusCode, res.body).toBe(201);
  const draft = IntakeDraft.parse(res.json());
  const sub = await as('KAM').post(`/api/v1/quotes/drafts/${draft.id}/submit`);
  expect(sub.statusCode, sub.body).toBe(201);
  const { quoteNumber } = SubmitIntakeResponse.parse(sub.json());
  created.push(quoteNumber);
  const adv = await decide(quoteNumber, 'G1', { outcomeKey: 'advance' }, 'SalesLeader');
  expect(adv.statusCode, adv.body).toBe(201);
  return quoteNumber;
}

const decide = (qn: string, gate: string, body: Record<string, unknown>, role: Role = 'EngLead') =>
  as(role).post(`/api/v1/quotes/${qn}/gates/${gate}/decisions`, body);

async function queue(role: Role = 'EngLead', qs = '', scope?: 'all' | 'owner') {
  const res = await as(role, scope).get(`/api/v1/queue/engineering${qs}`);
  expect(res.statusCode, res.body).toBe(200);
  return EngQueueResponse.parse(res.json());
}

const find = (q: EngQueueResponse, qn: string) => q.items.find((i) => i.quoteNumber === qn);

async function detail(qn: string, role: Role = 'EngLead', scope?: 'all' | 'owner') {
  const res = await as(role, scope).get(`/api/v1/quotes/${qn}`);
  expect(res.statusCode, res.body).toBe(200);
  return QuoteDetail.parse(res.json());
}

async function assign(
  qn: string,
  engineerId: string,
  role: Role = 'EngLead',
  scope?: 'all' | 'owner',
) {
  return as(role, scope).post(`/api/v1/quotes/${qn}/assignment`, { engineerId });
}

const errorPaths = (res: { json: () => unknown }) =>
  ((res.json() as { errors?: { path: string }[] }).errors ?? []).map((e) => e.path).sort();
const errorCodes = (res: { json: () => unknown }) =>
  ((res.json() as { errors?: { code: string }[] }).errors ?? []).map((e) => e.code).sort();

const setSetting = (key: string, value: unknown) =>
  db.db.execute(
    sql`update app_setting set value = ${JSON.stringify(value)}::jsonb where key = ${key}`,
  );

const SOLUTION = {
  processType: 'EBM',
  machineType: 'EBM_SHUTTLE',
  plantCode: 'PLANT_01',
  cavitation: 8,
  cycleTimeS: 14.5,
  toolingNotes: 'New 8-cavity mold, hot runner not needed',
  downstreamEquipmentNotes: 'Leak tester, compressed air drop',
  technicalConceptNotes: 'Shuttle EBM with in-mold labelling',
};
const capacityRow = async (over: Record<string, unknown> = {}) => ({
  site: 'PLANT_01',
  lineAsset: 'Line 4',
  assumedEffectivenessPct: 70,
  cycleTimeS: 14.5,
  utilizationPct: 62,
  bufferPct: 10,
  analysisDate: '2026-10-26',
  analystId: await userId('Engineer'),
  notes: 'Demonstrated OEE on line 4 over 13 weeks',
  ...over,
});

beforeAll(async () => {
  const fresh = await freshSfDatabase('engineering');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url }), { db, now: () => clock });
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

describe('the queue', () => {
  it('lists every open ENG_REVIEW quote, in the default order: pinned → tier → score → oldest', async () => {
    const q = await queue();
    const open = await db.db.execute<{ n: number }>(
      sql`select count(*)::int as n from quote where stage_key = 'ENG_REVIEW' and status <> 'closed'`,
    );
    expect(q.total).toBe(open[0]!.n);
    expect(q.items).toHaveLength(q.total);
    expect(q.stage).toEqual({ key: 'ENG_REVIEW', label: 'Engineering Review' });

    const rank = (t: string | null) => {
      const i = ['CRITICAL', 'HIGH', 'STANDARD', 'LOW'].indexOf(t ?? '');
      return i === -1 ? 4 : i;
    };
    const key = (i: EngQueueItem) => [
      i.pinned ? i.queuePosition! : Number.MAX_SAFE_INTEGER,
      rank(i.priority.tier),
      -(i.priority.score ?? -1),
      Date.parse(i.enteredQueueAt!),
    ];
    for (let n = 1; n < q.items.length; n++) {
      const [a, b] = [key(q.items[n - 1]!), key(q.items[n]!)];
      const cmp = a.findIndex((v, k) => v !== b[k]);
      if (cmp !== -1)
        expect(
          a[cmp]!,
          `${q.items[n - 1]!.quoteNumber} before ${q.items[n]!.quoteNumber}`,
        ).toBeLessThan(b[cmp]!);
    }
  });

  it('a pinned quote (queue_position override) comes first', async () => {
    const qn = await inQueue({ estAnnualVolume: 50_000, estAnnualRevenue: 5_000 });
    const pin = await as('EngLead').post(`/api/v1/quotes/${qn}/overrides`, {
      field: 'queue_position',
      requestedValue: 1,
      justification: 'Customer line-down; Jim asked for this first',
    });
    expect(pin.statusCode, pin.body).toBe(201);
    const q = await queue();
    expect(q.items[0]).toMatchObject({ quoteNumber: qn, pinned: true, queuePosition: 1 });
    expect(q.canPin).toBe(true);
  });

  it('ages in business days with a frozen clock; header counts cover the whole queue', async () => {
    const qn = await inQueue(); // Monday
    const at = async (days: number) => {
      clock = new Date(clock.getTime() + days * DAY);
      return find(await queue(), qn)!;
    };
    expect(await at(0)).toMatchObject({ businessDaysInQueue: 0, agingBucket: 'fresh' });
    expect(await at(3)).toMatchObject({ businessDaysInQueue: 3, agingBucket: 'aging' }); // Thursday
    const old = await at(11); // Monday + 14 calendar days = 10 business days
    expect(old).toMatchObject({ businessDaysInQueue: 10, agingBucket: 'aging' });
    expect(await at(1)).toMatchObject({ businessDaysInQueue: 11, agingBucket: 'old' });

    const q = await queue();
    expect(q.aging.labels).toEqual({ fresh: '< 3 days', aging: '3–10 days', old: '> 10 days' });
    const counts = { fresh: 0, aging: 0, old: 0 };
    for (const i of q.items) counts[i.agingBucket] += 1;
    expect(q.aging.counts).toEqual(counts);
    // The buckets are config (eng_queue_aging_days), not an SLA.
    await setSetting('eng_queue_aging_days', { aging: 5, old: 20 });
    expect(find(await queue(), qn)!.agingBucket).toBe('aging');
    await setSetting('eng_queue_aging_days', { aging: 3, old: 10 });
  });

  it('filters by tier, engineer, unassigned, age, bucket, product family and search', async () => {
    const qn = await inQueue({ productFamily: 'JAR' });
    const all = await queue();
    const item = find(all, qn)!;
    expect(item.queueStatus).toBe('unassigned');
    expect(item.completeness.map((c) => c.code)).not.toContain('DRAWING_MISSING');
    const only = async (qs: string) => (await queue('EngLead', qs)).items.map((i) => i.quoteNumber);
    expect(await only('?productFamily=JAR')).toContain(qn);
    expect(await only('?productFamily=BOTTLE')).not.toContain(qn);
    expect(await only('?engineer=unassigned')).toContain(qn);
    expect(await only(`?q=${qn.toLowerCase()}`)).toEqual([qn]);
    expect(await only(`?tier=${item.priority.tier}`)).toContain(qn);
    expect(await only('?agedOver=0')).not.toContain(qn);
    expect(await only('?bucket=fresh')).toContain(qn);
    expect(await only('?bucket=old')).not.toContain(qn);
    const filtered = await queue('EngLead', '?productFamily=JAR');
    expect(filtered.total).toBe(all.total); // counts and total are before filters
    expect((await as('EngLead').get('/api/v1/queue/engineering?bucket=nope')).statusCode).toBe(400);
  });

  it('flags what Engineering may have to chase (completeness warnings)', async () => {
    const qn = await inQueue({ drawingStatus: 'COMING', neckFinish: null });
    const codes = find(await queue(), qn)!.completeness.map((c) => `${c.code}:${c.field}`);
    expect(codes).toContain('DRAWING_MISSING:drawing_status');
    expect(codes).toContain('ENRICH:neck_finish');
  });

  it('who sees it: EngLead the whole queue and the picker; Engineer read-only; Leadership read; others 403', async () => {
    const lead = await queue('EngLead');
    expect(lead).toMatchObject({ canAssign: true, canDecide: true });
    expect(lead.engineers.map((e) => e.roles).flat()).toEqual(
      expect.arrayContaining(['Engineer', 'EngLead']),
    );
    const engineer = await queue('Engineer');
    expect(engineer).toMatchObject({
      canAssign: false,
      canDecide: false,
      canPin: false,
      engineers: [],
    });
    expect(engineer.total).toBe(lead.total);
    const leadership = await queue('Leadership');
    expect(leadership).toMatchObject({ canAssign: false, canDecide: false, total: lead.total });
    for (const role of ['KAM', 'SalesLeader', 'Pricing', 'Approver'] as Role[]) {
      expect((await as(role).get('/api/v1/queue/engineering')).statusCode, role).toBe(403);
    }
    // An owner-scoped Engineer sees only their assignments (RLS).
    const owner = await queue('Engineer', '', 'owner');
    const me = await userId('Engineer', 'owner');
    expect(owner.items.every((i) => i.assignedEngineerId === me)).toBe(true);
  });
});

describe('arrival alert (P0, in-app)', () => {
  it('every EngLead and backup assigner is notified when a quote enters ENG_REVIEW', async () => {
    const backup = await userId('Engineer');
    await setSetting('eng_queue_backup_assigner_user_ids', [backup]);
    const qn = await inQueue();
    const quote = (await detail(qn)).id;
    const rows = await db.db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.quoteId, quote),
          eq(schema.notification.type, 'quote.ready_for_eng_review'),
        ),
      );
    const leads = await db.db.execute<{ id: string }>(sql`
      select u.id from app_user u join user_role r on r.user_id = u.id where r.role = 'EngLead' and u.active`);
    expect(rows.map((r) => r.userId).sort()).toEqual([...leads.map((l) => l.id), backup].sort());
    expect(rows.every((r) => r.channel === 'in_app')).toBe(true);

    const feed = NotificationListResponse.parse(
      (await as('EngLead').get('/api/v1/notifications')).json(),
    );
    expect(feed.unread).toBeGreaterThan(0);
    expect(feed.items[0]).toMatchObject({
      type: 'quote.ready_for_eng_review',
      quoteNumber: qn,
      title: `${qn} is in the engineering queue`,
    });
    const read = await as('EngLead').post('/api/v1/notifications/read');
    expect(read.json()).toMatchObject({ marked: feed.unread });
    expect(
      NotificationListResponse.parse((await as('EngLead').get('/api/v1/notifications')).json())
        .unread,
    ).toBe(0);
    await setSetting('eng_queue_backup_assigner_user_ids', []);
  });

  it('the no-G1 path alerts too (g1_enabled = false)', async () => {
    await db.db.execute(
      sql`update gate_definition set enabled = (key = 'SUBMIT') where key in ('G1', 'SUBMIT')`,
    );
    try {
      const res = await as('KAM').post('/api/v1/quotes/drafts', {
        data: await prefill(await nextFree()),
      });
      const draft = IntakeDraft.parse(res.json());
      const sub = SubmitIntakeResponse.parse(
        (await as('KAM').post(`/api/v1/quotes/drafts/${draft.id}/submit`)).json(),
      );
      expect(sub.routedTo).toBe('ENG_REVIEW');
      const n = await db.db
        .select()
        .from(schema.notification)
        .where(
          and(
            eq(schema.notification.quoteId, sub.quoteId),
            eq(schema.notification.type, 'quote.ready_for_eng_review'),
          ),
        );
      expect(n.length).toBeGreaterThan(0);
    } finally {
      await db.db.execute(
        sql`update gate_definition set enabled = (key = 'G1') where key in ('G1', 'SUBMIT')`,
      );
    }
  });
});

describe('assignment', () => {
  it('records the engineer, the time, an activity event and an audit row, and notifies the engineer', async () => {
    const qn = await inQueue();
    const engineer = await userId('Engineer');
    const res = await assign(qn, engineer);
    expect(res.statusCode, res.body).toBe(200);
    expect(AssignmentResponse.parse(res.json())).toMatchObject({
      quoteNumber: qn,
      assignedEngineerId: engineer,
      assignedAt: clock.toISOString(),
      changed: true,
    });
    const d = await detail(qn);
    const quoteId = d.id;
    expect(d.engineering).toMatchObject({
      assignedEngineerId: engineer,
      acceptedAt: null,
      canAssign: true,
    });
    const [event] = await db.db
      .select()
      .from(schema.activityEvent)
      .where(
        and(
          eq(schema.activityEvent.quoteId, quoteId),
          eq(schema.activityEvent.type, 'engineer_assigned'),
        ),
      );
    expect(event!.payload).toMatchObject({ from: null, to: engineer });
    const audits = await db.db
      .select()
      .from(schema.auditEvent)
      .where(and(eq(schema.auditEvent.quoteId, quoteId), eq(schema.auditEvent.action, 'update')));
    expect(
      audits.some(
        (a) => (a.after as { assignedEngineerId?: string }).assignedEngineerId === engineer,
      ),
    ).toBe(true);
    const [note] = await db.db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.quoteId, quoteId),
          eq(schema.notification.type, 'quote.assigned'),
        ),
      );
    expect(note).toMatchObject({ userId: engineer, title: `${qn} is assigned to you` });

    const item = find(await queue(), qn)!;
    expect(item).toMatchObject({ queueStatus: 'assigned', assignedEngineerId: engineer });
    // Same engineer again: nothing recorded.
    expect(AssignmentResponse.parse((await assign(qn, engineer)).json()).changed).toBe(false);
    // Reassign
    const lead = await userId('EngLead');
    clock = new Date(clock.getTime() + 2 * 3_600_000);
    const re = AssignmentResponse.parse((await assign(qn, lead)).json());
    expect(re).toMatchObject({
      changed: true,
      assignedEngineerId: lead,
      assignedAt: clock.toISOString(),
    });
    const events = await db.db
      .select()
      .from(schema.activityEvent)
      .where(
        and(
          eq(schema.activityEvent.quoteId, quoteId),
          eq(schema.activityEvent.type, 'engineer_assigned'),
        ),
      )
      .orderBy(desc(schema.activityEvent.at));
    expect(events[0]!.payload).toMatchObject({ from: engineer, to: lead });
  });

  it('bulk assign: several quotes to one engineer, the picker shows the open count', async () => {
    const engineer = await userId('Engineer', 'owner');
    const before = (await queue()).engineers.find((e) => e.id === engineer)!.openCount;
    const qns = [await inQueue(), await inQueue(), await inQueue()];
    for (const qn of qns) expect((await assign(qn, engineer)).statusCode).toBe(200);
    const q = await queue();
    expect(q.engineers.find((e) => e.id === engineer)!.openCount).toBe(before + 3);
    expect(
      (await queue('EngLead', `?engineer=${engineer}`)).items.map((i) => i.quoteNumber),
    ).toEqual(expect.arrayContaining(qns));
    // The owner-scoped engineer now sees them as their assignments.
    const mine = await queue('Engineer', '', 'owner');
    expect(mine.mine.map((i) => i.quoteNumber)).toEqual(expect.arrayContaining(qns));
  });

  it('only queue.assign holders or a backup assigner; assignees must be engineers', async () => {
    const qn = await inQueue();
    const engineer = await userId('Engineer');
    for (const role of ['KAM', 'Engineer', 'Pricing', 'Leadership'] as Role[]) {
      expect((await assign(qn, engineer, role)).statusCode, role).toBe(403);
    }
    expect((await assign(qn, engineer, 'Admin')).statusCode).toBe(200);
    const kam = await userId('KAM');
    const bad = await assign(qn, kam);
    expect(bad.statusCode).toBe(422);
    expect(errorCodes(bad)).toEqual(['INVALID_ASSIGNEE']);
    // R-04: the backup assigner acts as EngLead for assignment.
    await setSetting('eng_queue_backup_assigner_user_ids', [engineer]);
    expect((await assign(qn, await userId('EngLead'), 'Engineer')).statusCode).toBe(200);
    expect((await queue('Engineer')).canAssign).toBe(true);
    await setSetting('eng_queue_backup_assigner_user_ids', []);
    // Out of the queue → 409.
    const g1 = await as('KAM').post('/api/v1/quotes/drafts', {
      data: await prefill(await nextFree()),
    });
    const sub = SubmitIntakeResponse.parse(
      (
        await as('KAM').post(`/api/v1/quotes/drafts/${IntakeDraft.parse(g1.json()).id}/submit`)
      ).json(),
    );
    expect((await assign(sub.quoteNumber, engineer)).statusCode).toBe(409);
  });
});

describe('accept', () => {
  it('the EngLead or the assigned engineer accepts once', async () => {
    const qn = await inQueue();
    const engineer = await userId('Engineer', 'owner');
    await assign(qn, engineer);
    expect((await as('Engineer').post(`/api/v1/quotes/${qn}/eng-review/accept`)).statusCode).toBe(
      403,
    );
    const res = await as('Engineer', 'owner').post(`/api/v1/quotes/${qn}/eng-review/accept`);
    expect(res.statusCode, res.body).toBe(200);
    expect(EngineeringDetail.parse(res.json())).toMatchObject({
      acceptedAt: clock.toISOString(),
      canAccept: false,
    });
    expect(find(await queue(), qn)!.queueStatus).toBe('accepted');
    expect((await as('EngLead').post(`/api/v1/quotes/${qn}/eng-review/accept`)).statusCode).toBe(
      409,
    );
    expect((await as('KAM').post(`/api/v1/quotes/${qn}/eng-review/accept`)).statusCode).toBe(403);
  });
});

describe('Engineering Review and capacity evidence', () => {
  it('only the EngLead or the assigned engineer edits; a KAM gets 403', async () => {
    const qn = await inQueue();
    const owner = await userId('Engineer', 'owner');
    await assign(qn, owner);
    const put = (role: Role, scope?: 'all' | 'owner') =>
      as(role, scope).put(`/api/v1/quotes/${qn}/eng-review`, { cavitation: 4 });
    expect((await put('Engineer')).statusCode).toBe(403); // not assigned to them
    expect((await put('KAM')).statusCode).toBe(403);
    expect((await put('Leadership')).statusCode).toBe(403);
    expect((await put('Engineer', 'owner')).statusCode).toBe(200);
    expect((await put('EngLead')).statusCode).toBe(200);
    const cap = (role: Role, scope?: 'all' | 'owner') =>
      as(role, scope).put(`/api/v1/quotes/${qn}/capacity-evidence`, { rows: [] });
    expect((await cap('Engineer')).statusCode).toBe(403);
    expect((await cap('KAM')).statusCode).toBe(403);
    expect((await cap('Engineer', 'owner')).statusCode).toBe(200);
    expect((await detail(qn, 'Engineer')).engineering.canEdit).toBe(false);
    expect((await detail(qn, 'Engineer', 'owner')).engineering.canEdit).toBe(true);
  });

  it('saves the solution; value-list codes are checked; changes are on the timeline without values', async () => {
    const qn = await inQueue();
    const res = await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, SOLUTION);
    expect(res.statusCode, res.body).toBe(200);
    expect(EngineeringDetail.parse(res.json()).review).toMatchObject(SOLUTION);
    const bad = await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, {
      processType: 'NOPE',
      plantCode: 'PLANT_99',
    });
    expect(bad.statusCode).toBe(422);
    expect(errorPaths(bad)).toEqual(['/plantCode', '/processType']);
    const timeline = (await as('KAM').get(`/api/v1/quotes/${qn}/timeline`)).json<{
      items: { type: string; payload: unknown }[];
    }>();
    const updated = timeline.items.find((i) => i.type === 'eng_review_updated')!;
    expect(updated.payload).toEqual({ fields: Object.keys(SOLUTION) });
  });

  it('prelim capital is commercial: KAM and Engineer never read it; saving it rescores the quote', async () => {
    const qn = await inQueue();
    const owner = await userId('Engineer', 'owner');
    await assign(qn, owner);
    const before = await detail(qn);
    expect(before.priority.unknowns).toContain('capital_exposure');

    const res = await as('Engineer', 'owner').put(`/api/v1/quotes/${qn}/eng-review`, {
      prelimCapitalUsd: 400_000,
    });
    expect(res.statusCode, res.body).toBe(200);
    const asEngineer = EngineeringDetail.parse(res.json());
    expect(asEngineer.commercialRedacted).toBe(true);
    expect('prelimCapitalUsd' in asEngineer.review).toBe(false);

    const lead = await detail(qn);
    expect(lead.engineering.review.prelimCapitalUsd).toBe(400_000);
    expect(lead.priority.unknowns).not.toContain('capital_exposure');
    const kam = await detail(qn, 'KAM');
    expect(kam.engineering.commercialRedacted).toBe(true);
    expect('prelimCapitalUsd' in kam.engineering.review).toBe(false);
    expect(JSON.stringify(kam)).not.toContain('400000');
    // Write-only: an Engineer's save without the capital keeps it.
    await as('Engineer', 'owner').put(`/api/v1/quotes/${qn}/eng-review`, { cavitation: 6 });
    expect((await detail(qn)).engineering.review.prelimCapitalUsd).toBe(400_000);
  });

  it('capacity rows: effectiveness has no default; numbers are redacted for KAM and Engineer, kept on save', async () => {
    const qn = await inQueue();
    const owner = await userId('Engineer', 'owner');
    await assign(qn, owner);
    const put = (rows: unknown[], scope: 'all' | 'owner' = 'owner') =>
      as('Engineer', scope).put(`/api/v1/quotes/${qn}/capacity-evidence`, { rows });

    const missing = await put([await capacityRow({ assumedEffectivenessPct: undefined })]);
    expect(missing.statusCode).toBe(422);
    expect(errorPaths(missing)).toEqual(['/rows/0/assumedEffectivenessPct']);
    expect((await put([await capacityRow({ utilizationPct: 120 })])).statusCode).toBe(400);
    expect(errorPaths(await put([await capacityRow({ site: 'NOWHERE' })]))).toEqual([
      '/rows/0/site',
    ]);

    const saved = EngineeringDetail.parse((await put([await capacityRow()])).json());
    expect(saved.capacityEvidence).toHaveLength(1);
    const row = saved.capacityEvidence[0]!;
    expect(row).toMatchObject({ site: 'PLANT_01', lineAsset: 'Line 4' });
    expect(row.assumedEffectivenessPct).toBeUndefined();

    // The Engineer edits the notes without resending the hidden numbers: they are kept.
    const kept = await put([
      {
        ...(await capacityRow()),
        id: row.id,
        assumedEffectivenessPct: undefined,
        cycleTimeS: undefined,
        utilizationPct: undefined,
        bufferPct: undefined,
        notes: 'Line 4 confirmed',
      },
    ]);
    expect(kept.statusCode, kept.body).toBe(200);
    const lead = (await detail(qn)).engineering.capacityEvidence;
    expect(lead).toEqual([
      expect.objectContaining({
        id: row.id,
        assumedEffectivenessPct: 70,
        cycleTimeS: 14.5,
        utilizationPct: 62,
        bufferPct: 10,
        notes: 'Line 4 confirmed',
      }),
    ]);
    const kam = (await detail(qn, 'KAM')).engineering.capacityEvidence[0]!;
    expect(kam.assumedEffectivenessPct).toBeUndefined();
    expect(kam.utilizationPct).toBeUndefined();

    // Replace the set: add one, drop the first.
    const replaced = await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
      rows: [await capacityRow({ site: 'PLANT_02', assumedEffectivenessPct: 68 })],
    });
    expect(EngineeringDetail.parse(replaced.json()).capacityEvidence).toEqual([
      expect.objectContaining({ site: 'PLANT_02', assumedEffectivenessPct: 68 }),
    ]);
  });
});

describe('G2 Feasible solution? (generic gate route)', () => {
  async function ready(over: { capacity?: boolean; solution?: boolean } = {}) {
    const qn = await inQueue();
    if (over.solution !== false)
      await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, SOLUTION);
    if (over.capacity !== false) {
      await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
        rows: [await capacityRow()],
      });
    }
    return qn;
  }

  it('Proceed needs the solution fields and at least one capacity row', async () => {
    const qn = await ready({ capacity: false, solution: false });
    const d = await detail(qn);
    expect(d.availableActions.map((a) => a.outcomeKey)).toEqual([
      'proceed',
      'proceed_with_risk',
      'capital_required',
      'hold',
      'rework',
      'stop',
    ]);
    expect(
      d.availableActions.find((a) => a.outcomeKey === 'proceed')!.missing.map((m) => m.field),
    ).toEqual([
      'process_type',
      'machine_type',
      'plant_code',
      'cavitation',
      'cycle_time_s',
      'capacity_evidence',
    ]);
    const rejected = await decide(qn, 'G2', { outcomeKey: 'proceed' });
    expect(rejected.statusCode).toBe(422);
    expect(errorPaths(rejected)).toEqual([
      '/capacity_evidence',
      '/cavitation',
      '/cycle_time_s',
      '/machine_type',
      '/plant_code',
      '/process_type',
    ]);
    await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, SOLUTION);
    expect(errorPaths(await decide(qn, 'G2', { outcomeKey: 'proceed' }))).toEqual([
      '/capacity_evidence',
    ]);
    await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
      rows: [await capacityRow()],
    });
    for (const role of ['Engineer', 'KAM', 'SalesLeader', 'Admin'] as Role[]) {
      expect((await decide(qn, 'G2', { outcomeKey: 'proceed' }, role)).statusCode, role).toBe(403);
    }
    const ok = await decide(qn, 'G2', { outcomeKey: 'proceed' });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(GateDecisionResponse.parse(ok.json()).quote).toMatchObject({
      stageKey: 'QUOTING',
      status: 'active',
    });

    // The evidence snapshot keeps the solution and capacity rows as they were at decision time.
    const [g2] = await db.db
      .select()
      .from(schema.gateDecision)
      .where(
        and(
          eq(schema.gateDecision.gateKey, 'G2'),
          eq(schema.gateDecision.quoteId, (await detail(qn)).id),
        ),
      );
    const evidence = g2!.evidence as {
      engineering: {
        solution: Record<string, unknown>;
        capacityEvidence: Record<string, unknown>[];
      };
    };
    expect(evidence.engineering.solution).toMatchObject({
      processType: 'EBM',
      plantCode: 'PLANT_01',
      cavitation: 8,
    });
    expect(evidence.engineering.capacityEvidence).toEqual([
      expect.objectContaining({ site: 'PLANT_01', assumed_effectiveness_pct: 70 }),
    ]);
    // Out of the queue: no more edits.
    expect(
      (await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, { cavitation: 2 })).statusCode,
    ).toBe(409);
  });

  it('Proceed with risk needs the same plus a risk note', async () => {
    const qn = await ready();
    const res = await decide(qn, 'G2', { outcomeKey: 'proceed_with_risk' });
    expect(errorCodes(res)).toEqual(['NOTE_REQUIRED']);
    const ok = await decide(qn, 'G2', {
      outcomeKey: 'proceed_with_risk',
      note: 'Cycle time unproven',
    });
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it('Capital required needs the capital figure and sets capital readiness to pending', async () => {
    const qn = await ready({ solution: false, capacity: false });
    expect(errorPaths(await decide(qn, 'G2', { outcomeKey: 'capital_required' }))).toEqual([
      '/prelim_capital_usd',
    ]);
    await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, { prelimCapitalUsd: 650_000 });
    const ok = await decide(qn, 'G2', { outcomeKey: 'capital_required' });
    expect(ok.statusCode, ok.body).toBe(201);
    const quote = GateDecisionResponse.parse(ok.json()).quote;
    expect(quote.stageKey).toBe('QUOTING');
    const [pricing] = await db.db
      .select()
      .from(schema.pricingRecord)
      .where(eq(schema.pricingRecord.quoteId, quote.id));
    expect(pricing!.capitalReadiness).toBe('pending');
  });

  it('Hold needs a reason and a review date', async () => {
    const qn = await ready();
    expect(errorCodes(await decide(qn, 'G2', { outcomeKey: 'hold' }))).toEqual([
      'MISSING_FIELD',
      'REASON_REQUIRED',
    ]);
    const ok = await decide(qn, 'G2', {
      outcomeKey: 'hold',
      reasonCode: 'awaiting_customer_info',
      holdUntil: '2026-12-01',
    });
    expect(GateDecisionResponse.parse(ok.json()).quote).toMatchObject({
      stageKey: 'ENG_REVIEW',
      status: 'on_hold',
      reviewDate: '2026-12-01',
    });
    expect(find(await queue(), qn)!.status).toBe('on_hold');
  });

  it('Rework (Return to KAM) needs a reason and a note; the KAM gets the banner', async () => {
    const qn = await ready();
    expect(errorCodes(await decide(qn, 'G2', { outcomeKey: 'rework' }))).toEqual([
      'NOTE_REQUIRED',
      'REASON_REQUIRED',
    ]);
    const ok = await decide(qn, 'G2', {
      outcomeKey: 'rework',
      reasonCode: 'missing_information',
      note: 'Need the neck finish drawing and the SKU split',
    });
    expect(ok.statusCode, ok.body).toBe(201);
    const kam = await detail(qn, 'KAM');
    expect(kam).toMatchObject({ stageKey: 'INTAKE', submittedAt: null });
    expect(kam.rework).toMatchObject({
      gateKey: 'G2',
      reasonLabel: 'Missing information',
      note: 'Need the neck finish drawing and the SKU split',
    });
    expect(find(await queue(), qn)).toBeUndefined();
  });

  it('Stop needs a reason and a note and closes as DECLINED', async () => {
    const qn = await ready();
    expect(errorCodes(await decide(qn, 'G2', { outcomeKey: 'stop' }))).toEqual([
      'NOTE_REQUIRED',
      'REASON_REQUIRED',
    ]);
    const ok = await decide(qn, 'G2', {
      outcomeKey: 'stop',
      reasonCode: 'not_strategic',
      note: 'No line fits',
    });
    expect(GateDecisionResponse.parse(ok.json()).quote).toMatchObject({
      stageKey: 'DECLINED',
      status: 'closed',
      outcome: 'declined',
    });
  });

  it('a quote returned to ENG_REVIEW waits for acceptance again and the EngLead is alerted', async () => {
    const qn = await ready();
    await as('EngLead').post(`/api/v1/quotes/${qn}/eng-review/accept`);
    await decide(qn, 'G2', { outcomeKey: 'proceed' });
    const id = (await detail(qn)).id;
    const before = await db.db.execute<{ n: number }>(
      sql`select count(*)::int as n from notification where quote_id = ${id} and type = 'quote.ready_for_eng_review'`,
    );
    const back = await decide(
      qn,
      'G3',
      // B-11: a G3 Rework needs a reason code.
      { outcomeKey: 'rework', reasonCode: 'missing_information', note: 'Capital excludes trimmer' },
      'Pricing',
    );
    expect(back.statusCode, back.body).toBe(201);
    const after = await db.db.execute<{ n: number }>(
      sql`select count(*)::int as n from notification where quote_id = ${id} and type = 'quote.ready_for_eng_review'`,
    );
    expect(after[0]!.n).toBeGreaterThan(before[0]!.n);
    const d = await detail(qn);
    expect(d.engineering).toMatchObject({ acceptedAt: null, inQueue: true });
    expect(d.engineering.review.processType).toBe('EBM'); // review kept
  });
});

describe('time in stage', () => {
  it('per-stage durations exclude holds', async () => {
    const qn = await inQueue();
    clock = new Date(clock.getTime() + DAY);
    await decide(qn, 'G2', {
      outcomeKey: 'hold',
      reasonCode: 'awaiting_customer_info',
      holdUntil: '2027-01-04',
    });
    clock = new Date(clock.getTime() + 2 * DAY);
    const res = await as('KAM').get(`/api/v1/quotes/${qn}/stage-times`);
    expect(res.statusCode, res.body).toBe(200);
    const body = StageTimesResponse.parse(res.json());
    const eng = body.stages.find((s) => s.stageKey === 'ENG_REVIEW')!;
    expect(eng).toMatchObject({
      label: 'Engineering Review',
      current: true,
      visits: 1,
      elapsedMs: 3 * DAY,
      heldMs: 2 * DAY,
      activeMs: DAY,
    });
    expect(body.stages[0]!.stageKey).toBe('INTAKE');
    expect(find(await queue(), qn)!.activeMsInStage).toBe(DAY);
    expect((await as('KAM').get('/api/v1/quotes/CCQ-2099-99999/stage-times')).statusCode).toBe(404);
  });
});
