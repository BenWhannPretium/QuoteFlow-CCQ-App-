import {
  AssignmentResponse,
  BulkReassignResponse,
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

import { prepareBom } from './model-helpers';
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
    update quote set stage_key = 'DECLINED', status = 'closed', outcome = 'declined', closed_at = now(),
      outcome_reason_code = 'other', closure_owner_id = kam_user_id
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
  machineType: 'EBM',
  plantCode: 'AURORA',
  cavitation: 8,
  cycleTimeS: 14.5,
  toolingNotes: 'New 8-cavity mold, hot runner not needed',
  technicalConceptNotes: 'Shuttle EBM with in-mold labelling',
};
const capacityRow = async (over: Record<string, unknown> = {}) => ({
  site: 'AURORA',
  lineAsset: 'Line 4',
  assumedEffectivenessPct: 70,
  cycleTimeS: 14.5,
  utilizationBeforePct: 62,
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

  it('shows the ship / fill destination and a "Mold modification" chip (F-017, F-015, T-012)', async () => {
    const qn = await inQueue({
      modifyExistingMold: true,
      existingMoldRef: 'M-10421',
      moldChangeDescription: 'finish change 28-410 → 28-400',
    });
    const item = find(await queue(), qn)!;
    expect(item).toMatchObject({ shipCity: 'Testville', shipState: 'MO', moldModification: true });
    const plainQn = await inQueue();
    expect(find(await queue(), plainQn)!.moldModification).toBe(false);
  });

  it('flags what Engineering may have to chase (completeness warnings)', async () => {
    const qn = await inQueue({ drawingStatus: 'COMING', market: null });
    const codes = find(await queue(), qn)!.completeness.map((c) => `${c.code}:${c.field}`);
    expect(codes).toContain('DRAWING_MISSING:drawing_status');
    expect(codes).toContain('ENRICH:market');
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
          eq(schema.notification.channel, 'in_app'),
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
            eq(schema.notification.channel, 'in_app'),
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
          eq(schema.notification.channel, 'in_app'),
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

  it('budgetary capital: the Engineer who enters it and the KAM both read it; saving it rescores the quote', async () => {
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
    // 2026-10-30: no role enters data it cannot see.
    expect(asEngineer.commercialRedacted).toBe(false);
    expect(asEngineer.review.prelimCapitalUsd).toBe(400_000);

    const lead = await detail(qn);
    expect(lead.engineering.review.prelimCapitalUsd).toBe(400_000);
    expect(lead.priority.unknowns).not.toContain('capital_exposure');
    const kam = await detail(qn, 'KAM');
    expect(kam.engineering.commercialRedacted).toBe(false);
    expect(kam.engineering.review.prelimCapitalUsd).toBe(400_000);
    // A save sends only the keys it changes: one without the capital keeps it.
    await as('Engineer', 'owner').put(`/api/v1/quotes/${qn}/eng-review`, { cavitation: 6 });
    expect((await detail(qn)).engineering.review.prelimCapitalUsd).toBe(400_000);
  });

  it('capacity rows: effectiveness has no default; the Engineer and the KAM see the numbers', async () => {
    const qn = await inQueue();
    const owner = await userId('Engineer', 'owner');
    await assign(qn, owner);
    const put = (rows: unknown[], scope: 'all' | 'owner' = 'owner') =>
      as('Engineer', scope).put(`/api/v1/quotes/${qn}/capacity-evidence`, { rows });

    const missing = await put([await capacityRow({ assumedEffectivenessPct: undefined })]);
    expect(missing.statusCode).toBe(422);
    expect(errorPaths(missing)).toEqual(['/rows/0/assumedEffectivenessPct']);
    expect((await put([await capacityRow({ utilizationBeforePct: 120 })])).statusCode).toBe(400);
    expect(errorPaths(await put([await capacityRow({ site: 'NOWHERE' })]))).toEqual([
      '/rows/0/site',
    ]);

    const saved = EngineeringDetail.parse((await put([await capacityRow()])).json());
    expect(saved.capacityEvidence).toHaveLength(1);
    const row = saved.capacityEvidence[0]!;
    expect(row).toMatchObject({ site: 'AURORA', lineAsset: 'Line 4' });
    // 2026-10-30: the Engineer sees the numbers they entered.
    expect(row).toMatchObject({
      assumedEffectivenessPct: 70,
      cycleTimeS: 14.5,
      utilizationBeforePct: 62,
    });

    // So they resend them on an edit, like every other role: leaving one out is an error.
    const omitted = await put([
      { ...(await capacityRow()), id: row.id, cycleTimeS: undefined, notes: 'Line 4 confirmed' },
    ]);
    expect(errorPaths(omitted)).toEqual(['/rows/0/cycleTimeS']);
    const kept = await put([{ ...(await capacityRow()), id: row.id, notes: 'Line 4 confirmed' }]);
    expect(kept.statusCode, kept.body).toBe(200);
    const lead = (await detail(qn)).engineering.capacityEvidence;
    expect(lead).toEqual([
      expect.objectContaining({
        id: row.id,
        assumedEffectivenessPct: 70,
        cycleTimeS: 14.5,
        utilizationBeforePct: 62,
        notes: 'Line 4 confirmed',
      }),
    ]);
    const kam = (await detail(qn, 'KAM')).engineering.capacityEvidence[0]!;
    expect(kam.assumedEffectivenessPct).toBe(70);
    expect(kam.utilizationBeforePct).toBe(62);

    // Replace the set: add one, drop the first.
    const replaced = await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
      rows: [await capacityRow({ site: 'BETHLEHEM', assumedEffectivenessPct: 68 })],
    });
    expect(EngineeringDetail.parse(replaced.json()).capacityEvidence).toEqual([
      expect.objectContaining({ site: 'BETHLEHEM', assumedEffectivenessPct: 68 }),
    ]);
  });
});

describe('FB-03: utilization before and after, export, CER-ready inputs (F-059, F-061, F-057)', () => {
  // 10 s x 4 cavities x 80 % x 350 days = 9 676 800 units a year. The quote's volume is half of that.
  const VOLUME = 4_838_400;
  const row = async (over: Record<string, unknown> = {}) =>
    capacityRow({ cycleTimeS: 10, assumedEffectivenessPct: 80, utilizationBeforePct: 40, ...over });

  async function setup() {
    const qn = await inQueue({ estAnnualVolume: VOLUME });
    await assign(qn, await userId('Engineer', 'owner'));
    const review = await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, { cavitation: 4 });
    expect(review.statusCode, review.body).toBe(200);
    return qn;
  }
  const saveRows = (qn: string, rows: unknown[]) =>
    as('EngLead').put(`/api/v1/quotes/${qn}/capacity-evidence`, { rows });

  it('calculates utilization after on the server: defaults to the quote volume and the basis run days', async () => {
    const qn = await setup();
    const res = await saveRows(qn, [await row()]);
    expect(res.statusCode, res.body).toBe(200);
    const eng = EngineeringDetail.parse(res.json());
    expect(eng.capacityEvidence).toEqual([
      expect.objectContaining({
        utilizationBeforePct: 40,
        allocatedAnnualVolume: VOLUME,
        scheduledRunDaysPerYear: 350,
        // 40 + 4 838 400 / 9 676 800 x 100
        utilizationAfterPct: 90,
        utilizationLevel: 'warn',
      }),
    ]);
    expect(eng.quoteAnnualVolume).toBe(VOLUME);
    expect(eng.allocationWarning).toBeNull();
    expect(eng.capacityBasis).toEqual({
      scheduledRunDaysPerYear: 350,
      warnAbovePct: 85,
      basisLabel: 'Trailing 12 months actual, trending OEE (provisional, D-021)',
    });
  });

  it('is red over 100 and amber over the warning threshold', async () => {
    const qn = await setup();
    const res = await saveRows(qn, [
      await row({ lineAsset: 'A', allocatedAnnualVolume: 9_676_800 }),
      await row({ lineAsset: 'B', allocatedAnnualVolume: 1_000_000, utilizationBeforePct: 20 }),
    ]);
    const rows = EngineeringDetail.parse(res.json()).capacityEvidence;
    expect(rows.map((r) => [r.utilizationAfterPct, r.utilizationLevel])).toEqual([
      [140, 'over'],
      [30.33, 'ok'],
    ]);
  });

  it('nobody can type utilization after, and buffer is gone from the contract', async () => {
    const qn = await setup();
    expect((await saveRows(qn, [await row({ utilizationAfterPct: 10 })])).statusCode).toBe(400);
    expect((await saveRows(qn, [await row({ bufferPct: 10 })])).statusCode).toBe(400);
    expect((await saveRows(qn, [await row({ utilizationPct: 10 })])).statusCode).toBe(400);
    expect((await saveRows(qn, [await row({ scheduledRunDaysPerYear: 400 })])).statusCode).toBe(
      400,
    );
    expect((await saveRows(qn, [await row({ allocatedAnnualVolume: -1 })])).statusCode).toBe(400);
    expect(
      errorPaths(await saveRows(qn, [await row({ utilizationBeforePct: undefined })])),
    ).toEqual(['/rows/0/utilizationBeforePct']);
  });

  it('T-030: two lines split the business; a mismatch warns but still saves', async () => {
    const qn = await setup();
    const res = await saveRows(qn, [
      await row({ site: 'AURORA', lineAsset: 'Line 1', allocatedAnnualVolume: 3_000_000 }),
      await row({
        site: 'BETHLEHEM',
        lineAsset: 'Line 2',
        allocatedAnnualVolume: 1_000_000,
        utilizationBeforePct: 20,
      }),
    ]);
    expect(res.statusCode, res.body).toBe(200);
    const eng = EngineeringDetail.parse(res.json());
    expect(
      eng.capacityEvidence.map((r) => [r.site, r.utilizationBeforePct, r.utilizationAfterPct]),
    ).toEqual([
      ['AURORA', 40, 71],
      ['BETHLEHEM', 20, 30.33],
    ]);
    expect(eng.allocationWarning).toContain('838,400 fewer than');

    const fixed = await saveRows(qn, [
      {
        ...(await row({ site: 'AURORA', lineAsset: 'Line 1', allocatedAnnualVolume: 3_000_000 })),
        id: eng.capacityEvidence[0]!.id,
      },
      {
        ...(await row({
          site: 'BETHLEHEM',
          lineAsset: 'Line 2',
          allocatedAnnualVolume: 1_838_400,
          utilizationBeforePct: 20,
        })),
        id: eng.capacityEvidence[1]!.id,
      },
    ]);
    const after = EngineeringDetail.parse(fixed.json());
    expect(after.allocationWarning).toBeNull();
    expect(after.capacityEvidence.map((r) => r.utilizationAfterPct)).toEqual([71, 39]);
  });

  it('changing the cavitation recalculates the stored utilization after, and audits it', async () => {
    const qn = await setup();
    await saveRows(qn, [await row()]);
    const res = await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, { cavitation: 8 });
    expect(res.statusCode, res.body).toBe(200);
    // 8 cavities double the capacity: 40 + 25
    expect(EngineeringDetail.parse(res.json()).capacityEvidence[0]!.utilizationAfterPct).toBe(65);
    const quoteId = (await detail(qn)).id;
    const audits = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.quoteId, quoteId),
          eq(schema.auditEvent.entity, 'capacity_evidence'),
        ),
      );
    expect(audits.some((a) => a.changeReason?.includes('recalculated'))).toBe(true);
    // Clearing it leaves nothing to calculate with.
    const cleared = await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, {
      cavitation: null,
    });
    expect(
      EngineeringDetail.parse(cleared.json()).capacityEvidence[0]!.utilizationAfterPct,
    ).toBeNull();
  });

  it('F-057: cavitation is a whole number from 1 to 99', async () => {
    const qn = await setup();
    const put = (cavitation: number) =>
      as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, { cavitation });
    expect((await put(99)).statusCode).toBe(200);
    expect((await put(1)).statusCode).toBe(200);
    for (const bad of [0, 100, 512, 2.5, -1]) {
      expect((await put(bad)).statusCode, String(bad)).toBe(400);
    }
    // The database says the same, whatever the API does.
    await expect(
      db.db.execute(
        sql`update eng_review set cavitation = 100 where quote_id = ${(await detail(qn)).id}`,
      ),
    ).rejects.toThrow();
  });

  it('F-057: the EBM wheel cannot be picked, but a quote that has it keeps and shows it', async () => {
    const qn = await setup();
    const quoteId = (await detail(qn)).id;
    const picked = await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, {
      machineType: 'EBM_WHEEL',
    });
    expect(picked.statusCode).toBe(422);
    expect(errorPaths(picked)).toEqual(['/machineType']);
    const [list] = await db.db.execute<{ active: boolean }>(
      sql`select active from value_list where list_key = 'machine_type' and code = 'EBM_WHEEL'`,
    );
    expect(list!.active).toBe(false);

    await db.db.execute(
      sql`update eng_review set machine_type = 'EBM_WHEEL' where quote_id = ${quoteId}`,
    );
    expect((await detail(qn)).engineering.review.machineType).toBe('EBM_WHEEL');
    // Other edits on that quote still work, and a different type can replace it.
    expect(
      (await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, { cavitation: 6 })).statusCode,
    ).toBe(200);
    expect(
      (await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, { machineType: 'EBM' }))
        .statusCode,
    ).toBe(200);
  });

  it('F-023: the product facts the intake holds reach the Engineering tab', async () => {
    const qn = await setup();
    const facts = (await detail(qn)).engineering.productFacts;
    expect(facts[0]).toMatchObject({ key: 'resin', label: 'Resin' });
    expect(facts[0]!.value).toMatch(/HDPE/i);
    // FB-02: the neck and the rest of the intake's product facts are listed too (when entered).
    expect(facts.map((f) => f.key)).toContain('neck');
  });

  it('FB-09: an "Other" resin, PCR level and additive show their customer-specified values', async () => {
    const qn = await setup();
    await db.db.execute(
      sql`update quote set resin = 'OTHER', resin_grade = 'Eastman Tritan TX1001',
          pcr_level = 'OTHER', pcr_level_other = '35% PCR', additive = 'OTHER',
          additives = 'Customer nucleating agent' where quote_number = ${qn}`,
    );
    const facts = Object.fromEntries(
      (await detail(qn)).engineering.productFacts.map((f) => [f.key, f.value]),
    );
    expect(facts.resin).toBe('Eastman Tritan TX1001');
    expect(facts.pcr).toBe('35% PCR');
    expect(facts.additives).toBe('Customer nucleating agent');
    // A listed additive shows its label, with the optional note after it.
    await db.db.execute(
      sql`update quote set additive = 'UV', additives = 'UV-531' where quote_number = ${qn}`,
    );
    expect(
      (await detail(qn)).engineering.productFacts.find((f) => f.key === 'additives')?.value,
    ).toBe('UV · UV-531');
  });

  it('FB-09: a quote with a retired resin still shows it, marked "(no longer offered)"', async () => {
    const qn = await setup();
    await db.db.execute(
      sql`insert into value_list (id, list_key, code, label, sort, active, meta, provisional)
          values (gen_random_uuid(), 'resin', 'PCR_HDPE', 'PCR-HDPE', 910, false, '{}'::jsonb, true)
          on conflict (list_key, code) do nothing`,
    );
    await db.db.execute(sql`update quote set resin = 'PCR_HDPE' where quote_number = ${qn}`);
    expect((await detail(qn)).engineering.productFacts[0]?.value).toBe(
      'PCR-HDPE (no longer offered)',
    );
  });

  describe('F-061: GET /quotes/:qn/capacity-evidence.csv', () => {
    it('lists every row with the calculated utilization, the basis, the quote number and the time; audited', async () => {
      const qn = await setup();
      await saveRows(qn, [
        await row({ lineAsset: 'Line 1', allocatedAnnualVolume: 3_000_000 }),
        await row({
          site: 'BETHLEHEM',
          lineAsset: 'Line, "2"',
          allocatedAnnualVolume: 1_838_400,
          utilizationBeforePct: 20,
        }),
      ]);
      const res = await as('EngLead').get(`/api/v1/quotes/${qn}/capacity-evidence.csv`);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain(`${qn}-capacity-evidence.csv`);
      const lines = res.body.trim().split('\r\n');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain('"quote_number","generated_at_utc","basis"');
      expect(lines[0]).toContain('"utilization_before_pct","utilization_after_pct","status"');
      expect(lines[1]).toContain(`"${qn}"`);
      expect(lines[1]).toContain(`"${clock.toISOString()}"`);
      expect(lines[1]).toContain('"Trailing 12 months actual, trending OEE (provisional, D-021)"');
      // site, effectiveness, cycle, cavitation, run days, allocated, capacity, before, after
      expect(lines[1]).toContain('"AURORA"');
      expect(lines[1]).toContain('"9676800"');
      expect(lines[1]).toContain('"40","71"');
      expect(lines[2]).toContain('"Line, ""2"""');
      expect(lines[2]).toContain('"20","39"');

      const quoteId = (await detail(qn)).id;
      const [audit] = await db.db
        .select()
        .from(schema.auditEvent)
        .where(and(eq(schema.auditEvent.quoteId, quoteId), eq(schema.auditEvent.action, 'export')));
      expect(audit).toMatchObject({ entity: 'capacity_evidence' });
      expect(audit!.after).toMatchObject({ format: 'csv', rows: 2 });
    });

    it('flags a row that exceeds line capacity', async () => {
      const qn = await setup();
      await saveRows(qn, [await row({ allocatedAnnualVolume: 9_676_800 })]);
      const res = await as('EngLead').get(`/api/v1/quotes/${qn}/capacity-evidence.csv`);
      expect(res.body).toContain('"exceeds line capacity"');
    });

    it('is a header only when there is no evidence yet, and still audited', async () => {
      const qn = await setup();
      const res = await as('EngLead').get(`/api/v1/quotes/${qn}/capacity-evidence.csv`);
      expect(res.statusCode).toBe(200);
      expect(res.body.trim().split('\r\n')).toHaveLength(1);
    });

    it('every role that can read the quote can download it; an unknown quote is 404', async () => {
      const qn = await setup();
      await saveRows(qn, [await row()]);
      const roles: Role[] = [
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
      for (const role of roles) {
        const res = await as(role).get(`/api/v1/quotes/${qn}/capacity-evidence.csv`);
        expect(res.statusCode, role).toBe(200);
      }
      const missing = await as('EngLead').get(
        '/api/v1/quotes/CCQ-2099-99999/capacity-evidence.csv',
      );
      expect(missing.statusCode).toBe(404);
    });

    it('is not available anonymously', async () => {
      const qn = await setup();
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/quotes/${qn}/capacity-evidence.csv`,
      });
      expect(res.statusCode).toBe(401);
    });
  });
});

describe('G2 Feasible solution? (generic gate route)', () => {
  async function ready(over: { capacity?: boolean; solution?: boolean; signoff?: boolean } = {}) {
    const qn = await inQueue();
    if (over.solution !== false)
      await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, SOLUTION);
    if (over.capacity !== false) {
      await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
        rows: [await capacityRow()],
      });
    }
    // B-26: the capacity owner's sign-off (seeded to the EngLead).
    if (over.signoff !== false && over.capacity !== false) {
      await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-signoff`, { status: 'approved' });
    }
    return qn;
  }

  it('DR-engineering-02: 0% effectiveness is refused, and Advance waits for utilization after', async () => {
    const ok = (res: { statusCode: number; body: string }) =>
      expect(res.statusCode, res.body).toBe(200);
    const quoteRow = async (n: string) =>
      (await db.db.select().from(schema.quote).where(eq(schema.quote.quoteNumber, n)))[0]!;
    const qn = await ready({ capacity: false });
    // 0% means no capacity at all: refused, with the limit named.
    const zero = await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
      rows: [await capacityRow({ assumedEffectivenessPct: 0 })],
    });
    expect(zero.statusCode).toBe(400);
    expect(zero.body).toContain('Enter an assumed effectiveness above 0%, up to 100%');
    // A row saved before the check (0%, utilization after blank) blocks every Advance.
    ok(
      await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
        rows: [await capacityRow()],
      }),
    );
    await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-signoff`, { status: 'approved' });
    const q = await quoteRow(qn);
    await db.db.execute(
      sql`update capacity_evidence set assumed_effectiveness_pct = 0, utilization_after_pct = null where quote_id = ${q.id}`,
    );
    for (const outcomeKey of ['proceed', 'proceed_with_risk']) {
      const res = await decide(qn, 'G2', { outcomeKey, note: 'Risk accepted' });
      expect(res.statusCode, outcomeKey).toBe(422);
      expect(errorPaths(res), outcomeKey).toEqual(['/capacity_utilization_missing']);
    }
    // Fixing the row (a real effectiveness) recalculates it, and Advance goes through.
    ok(
      await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
        rows: [await capacityRow()],
      }),
    );
    const advanced = await decide(qn, 'G2', { outcomeKey: 'proceed' });
    expect(advanced.statusCode, advanced.body).toBe(201);
  });

  it('Proceed needs the solution fields and at least one capacity row', async () => {
    const qn = await ready({ capacity: false, solution: false });
    const d = await detail(qn);
    expect(d.availableActions.map((a) => a.outcomeKey)).toEqual([
      'proceed',
      'proceed_with_risk',
      'capital_required',
      'hold',
      'rework',
      'redirect',
      'stop',
    ]);
    // B-26: every option carries its definition.
    expect(d.availableActions.every((a) => (a.helpText ?? '').length > 20)).toBe(true);
    expect(
      d.availableActions.find((a) => a.outcomeKey === 'proceed')!.missing.map((m) => m.field),
    ).toEqual([
      'process_type',
      'machine_type',
      'plant_code',
      'cavitation',
      'cycle_time_s',
      'capacity_evidence',
      'capacity_signoff_status',
    ]);
    const rejected = await decide(qn, 'G2', { outcomeKey: 'proceed' });
    expect(rejected.statusCode).toBe(422);
    expect(errorPaths(rejected)).toEqual([
      '/capacity_evidence',
      '/capacity_signoff_status',
      '/cavitation',
      '/cycle_time_s',
      '/machine_type',
      '/plant_code',
      '/process_type',
    ]);
    await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, SOLUTION);
    expect(errorPaths(await decide(qn, 'G2', { outcomeKey: 'proceed' }))).toEqual([
      '/capacity_evidence',
      '/capacity_signoff_status',
    ]);
    await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
      rows: [await capacityRow()],
    });
    expect(errorPaths(await decide(qn, 'G2', { outcomeKey: 'proceed' }))).toEqual([
      '/capacity_signoff_status',
    ]);
    await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-signoff`, { status: 'approved' });
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
      plantCode: 'AURORA',
      cavitation: 8,
    });
    expect(evidence.engineering.capacityEvidence).toEqual([
      expect.objectContaining({ site: 'AURORA', assumed_effectiveness_pct: 70 }),
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

  it('Capital required needs the capital figure, a note (F-027) and the equipment BOM (F-058), and sets capital readiness to pending', async () => {
    const qn = await ready({ solution: false, capacity: false });
    expect(errorPaths(await decide(qn, 'G2', { outcomeKey: 'capital_required' }))).toEqual([
      '/capacity_signoff_status',
      '/equipment_bom_on_file',
      '/note',
      '/prelim_capital_usd',
    ]);
    await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, { prelimCapitalUsd: 650_000 });
    await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-signoff`, { status: 'approved' });
    // FB-06 (F-058): and the equipment BOM on file.
    expect(errorPaths(await decide(qn, 'G2', { outcomeKey: 'capital_required' }))).toEqual([
      '/equipment_bom_on_file',
      '/note',
    ]);
    await prepareBom(app, qn);
    const ok = await decide(qn, 'G2', {
      outcomeKey: 'capital_required',
      note: 'A second cavity set is needed',
    });
    expect(ok.statusCode, ok.body).toBe(201);
    const quote = GateDecisionResponse.parse(ok.json()).quote;
    expect(quote.stageKey).toBe('QUOTING');
    const [pricing] = await db.db
      .select()
      .from(schema.pricingRecord)
      .where(eq(schema.pricingRecord.quoteId, quote.id));
    expect(pricing!.capitalReadiness).toBe('pending');
  });

  it('Hold needs a reason, a note (F-027), a review date and an owner (B-26)', async () => {
    const qn = await ready();
    expect(errorCodes(await decide(qn, 'G2', { outcomeKey: 'hold' }))).toEqual([
      'MISSING_FIELD',
      'MISSING_FIELD',
      'NOTE_REQUIRED',
      'REASON_REQUIRED',
    ]);
    const ok = await decide(qn, 'G2', {
      outcomeKey: 'hold',
      reasonCode: 'awaiting_customer_info',
      note: 'Waiting on the customer drawing',
      holdUntil: '2026-12-01',
      holdOwnerId: await userId('EngLead'),
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
      sql`select count(*)::int as n from notification where quote_id = ${id} and type = 'quote.ready_for_eng_review' and channel = 'in_app'`,
    );
    const back = await decide(
      qn,
      'G3',
      // B-11: a G3 Rework needs a reason code.
      { outcomeKey: 'rework', reasonCode: 'missing_information', note: 'Capital excludes trimmer' },
      'PricingLead',
    );
    expect(back.statusCode, back.body).toBe(201);
    const after = await db.db.execute<{ n: number }>(
      sql`select count(*)::int as n from notification where quote_id = ${id} and type = 'quote.ready_for_eng_review' and channel = 'in_app'`,
    );
    expect(after[0]!.n).toBeGreaterThan(before[0]!.n);
    const d = await detail(qn);
    expect(d.engineering).toMatchObject({ acceptedAt: null, inQueue: true });
    expect(d.engineering.review.processType).toBe('EBM'); // review kept
    // B-26: the capacity owner looks again on every stay in the queue.
    expect(d.engineering.capacitySignoff).toMatchObject({ status: null, byName: null });
  });

  it('B-26: Redirect (alternative platform / site) needs a note and keeps the quote in the queue', async () => {
    const qn = await ready();
    expect(errorCodes(await decide(qn, 'G2', { outcomeKey: 'redirect' }))).toEqual([
      'NOTE_REQUIRED',
    ]);
    const ok = await decide(qn, 'G2', { outcomeKey: 'redirect', note: 'Try the IBM line' });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(GateDecisionResponse.parse(ok.json()).quote).toMatchObject({
      stageKey: 'ENG_REVIEW',
      status: 'active',
    });
  });
});

describe('B-26: capacity sign-off (deck slide 11)', () => {
  it('the capacity owner approves or blocks; a block needs a note and stops G2 Advance', async () => {
    const qn = await inQueue();
    await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, SOLUTION);
    await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
      rows: [await capacityRow()],
    });
    const url = `/api/v1/quotes/${qn}/capacity-signoff`;
    expect((await as('EngLead').put(url, { status: 'blocked' })).statusCode).toBe(422);
    const blocked = await as('EngLead').put(url, { status: 'blocked', note: 'Line 4 is full' });
    expect(blocked.statusCode, blocked.body).toBe(200);
    expect(EngineeringDetail.parse(blocked.json()).capacitySignoff).toMatchObject({
      status: 'blocked',
      note: 'Line 4 is full',
    });
    expect(errorPaths(await decide(qn, 'G2', { outcomeKey: 'proceed' }))).toEqual([
      '/capacity_signoff_status',
    ]);
    for (const role of ['Engineer', 'KAM', 'Pricing', 'Admin'] as Role[]) {
      expect((await as(role).put(url, { status: 'approved' })).statusCode, role).toBe(403);
    }
    const approved = EngineeringDetail.parse(
      (await as('EngLead').put(url, { status: 'approved' })).json(),
    );
    expect(approved.capacitySignoff.status).toBe('approved');
    expect(approved.capacitySignoff.byName).not.toBeNull();
    expect((await decide(qn, 'G2', { outcomeKey: 'proceed' })).statusCode).toBe(201);
    // Out of the queue: 409.
    expect((await as('EngLead').put(url, { status: null })).statusCode).toBe(409);
  });

  it('the Supply Chain view is kept with the review; the two legacy equipment notes accept no new writes (FB-06)', async () => {
    const qn = await inQueue();
    const res = await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, {
      supplyChainNotes: 'Ship from BETHLEHEM saves 300 mi',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(EngineeringDetail.parse(res.json()).review).toMatchObject({
      supplyChainNotes: 'Ship from BETHLEHEM saves 300 mi',
    });
    // The BOM is an upload now: the free-text fields are deprecated and read-only.
    for (const key of ['equipmentBomNotes', 'downstreamEquipmentNotes']) {
      const refused = await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, {
        [key]: 'Chiller + leak tester',
      });
      expect(refused.statusCode, key).toBe(400);
    }
  });
});

describe("B-26: move an engineer's open work in one go (CCQ demo, Bailey)", () => {
  it('reassigns all, or the listed quotes, and tells the new engineer', async () => {
    const from = await userId('Engineer', 'owner');
    const to = await userId('Engineer');
    const a = await inQueue();
    const b = await inQueue();
    const c = await inQueue();
    for (const qn of [a, b, c]) expect((await assign(qn, from)).statusCode).toBe(200);

    const partial = await as('EngLead').post('/api/v1/queue/engineering/reassign', {
      fromUserId: from,
      toUserId: to,
      quoteNumbers: [a, 'CCQ-2099-99999'],
    });
    expect(partial.statusCode, partial.body).toBe(200);
    expect(BulkReassignResponse.parse(partial.json())).toMatchObject({
      reassigned: [a],
      skipped: [{ quoteNumber: 'CCQ-2099-99999' }],
    });

    const rest = BulkReassignResponse.parse(
      (
        await as('EngLead').post('/api/v1/queue/engineering/reassign', {
          fromUserId: from,
          toUserId: to,
        })
      ).json(),
    );
    expect(rest.reassigned).toEqual(expect.arrayContaining([b, c]));
    for (const qn of [a, b, c]) expect((await detail(qn)).engineering.assignedEngineerId).toBe(to);
    const told = await db.db.execute<{ n: number }>(
      sql`select count(*)::int as n from notification n join quote q on q.id = n.quote_id
          where n.user_id = ${to} and n.type = 'quote.assigned' and q.quote_number in (${a}, ${b}, ${c})
          and n.channel = 'in_app'`,
    );
    expect(told[0]!.n).toBe(3);
    // Only queue.assign (EngLead, Admin).
    for (const role of ['Engineer', 'KAM', 'Pricing'] as Role[]) {
      const res = await as(role).post('/api/v1/queue/engineering/reassign', {
        fromUserId: to,
        toUserId: from,
      });
      expect(res.statusCode, role).toBe(403);
    }
  });
});

describe('time in stage', () => {
  it('per-stage durations exclude holds', async () => {
    const qn = await inQueue();
    clock = new Date(clock.getTime() + DAY);
    await decide(qn, 'G2', {
      outcomeKey: 'hold',
      reasonCode: 'awaiting_customer_info',
      note: 'Waiting on the customer drawing',
      holdUntil: '2027-01-04',
      holdOwnerId: await userId('EngLead'),
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

describe('lead review (2026-10-30): the engineer submits to the engineering lead', () => {
  const submit = (qn: string, role: Role = 'Engineer') =>
    as(role).post(`/api/v1/quotes/${qn}/eng-review/submit`);
  const sendBack = (qn: string, body: unknown, role: Role = 'EngLead') =>
    as(role).post(`/api/v1/quotes/${qn}/eng-review/send-back`, body);
  const told = async (qn: string, type: string, userId: string) =>
    (
      await db.db
        .select()
        .from(schema.notification)
        .innerJoin(schema.quote, eq(schema.quote.id, schema.notification.quoteId))
        .where(
          and(
            eq(schema.quote.quoteNumber, qn),
            eq(schema.notification.type, type),
            eq(schema.notification.userId, userId),
            eq(schema.notification.channel, 'in_app'),
          ),
        )
    ).length;

  async function assignedAndAccepted() {
    const qn = await inQueue();
    expect((await assign(qn, await userId('Engineer'))).statusCode).toBe(200);
    expect((await as('Engineer').post(`/api/v1/quotes/${qn}/eng-review/accept`)).statusCode).toBe(
      200,
    );
    return qn;
  }

  it('checks the work against G2 Advance (less the capacity sign-off), then tells the lead', async () => {
    const qn = await assignedAndAccepted();
    const empty = await submit(qn);
    expect(empty.statusCode).toBe(422);
    expect(errorCodes(empty).every((c) => c === 'MISSING_FIELD')).toBe(true);

    expect((await as('Engineer').put(`/api/v1/quotes/${qn}/eng-review`, SOLUTION)).statusCode).toBe(
      200,
    );
    expect(
      (
        await as('Engineer').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
          rows: [await capacityRow()],
        })
      ).statusCode,
    ).toBe(200);
    // Not signed off yet: that is the lead's step, so it does not block the submission.
    const res = await submit(qn);
    expect(res.statusCode, res.body).toBe(200);
    const eng = EngineeringDetail.parse(res.json());
    expect(eng.leadReview).toMatchObject({ status: 'submitted', canSubmit: false });
    expect(eng.leadReview.submittedByName).toEqual(expect.any(String));
    // Locked: the engineer can no longer edit; the lead can.
    expect(eng.canEdit).toBe(false);
    const locked = await as('Engineer').put(`/api/v1/quotes/${qn}/eng-review`, { cavitation: 6 });
    expect(locked.statusCode).toBe(409);
    expect(
      (await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, { cavitation: 6 })).statusCode,
    ).toBe(200);

    // The lead is told and finds it under "Ready for my review".
    expect(await told(qn, 'quote.submitted_to_lead', await userId('EngLead'))).toBe(1);
    const ready = await queue('EngLead', '?review=ready');
    expect(ready.items.map((i) => i.quoteNumber)).toContain(qn);
    expect(ready.items.every((i) => i.leadReview === 'submitted')).toBe(true);
    expect(ready.readyForReview).toBeGreaterThanOrEqual(1);
    expect((await detail(qn)).engineering.leadReview.canSendBack).toBe(true);

    // Not twice.
    expect((await submit(qn)).statusCode).toBe(409);
  });

  it('the lead sends it back with a note; the engineer is told, edits and resubmits', async () => {
    const qn = await assignedAndAccepted();
    await as('Engineer').put(`/api/v1/quotes/${qn}/eng-review`, SOLUTION);
    await as('Engineer').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
      rows: [await capacityRow()],
    });
    expect((await submit(qn)).statusCode).toBe(200);

    expect((await sendBack(qn, { note: 'x' }, 'Engineer')).statusCode).toBe(403);
    expect((await sendBack(qn, { note: ' ' })).statusCode).toBe(400);
    const back = await sendBack(qn, { note: 'Check the cavitation against the press size' });
    expect(back.statusCode, back.body).toBe(200);
    expect(EngineeringDetail.parse(back.json()).leadReview).toMatchObject({
      status: 'returned',
      returnNote: 'Check the cavitation against the press size',
    });
    expect(await told(qn, 'quote.returned_by_lead', await userId('Engineer'))).toBe(1);
    expect((await queue('EngLead', '?review=ready')).items.map((i) => i.quoteNumber)).not.toContain(
      qn,
    );

    // Unlocked again: the engineer edits and submits a second round.
    expect(
      (await as('Engineer').put(`/api/v1/quotes/${qn}/eng-review`, { cavitation: 6 })).statusCode,
    ).toBe(200);
    expect((await submit(qn)).statusCode).toBe(200);
    // Nothing to send back twice in a row once it is back.
    expect((await sendBack(qn, { note: 'again' })).statusCode).toBe(200);
    expect((await sendBack(qn, { note: 'again' })).statusCode).toBe(409);

    // Every step is on the timeline and in the audit log.
    const events = await db.db
      .select({ type: schema.activityEvent.type })
      .from(schema.activityEvent)
      .innerJoin(schema.quote, eq(schema.quote.id, schema.activityEvent.quoteId))
      .where(eq(schema.quote.quoteNumber, qn));
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'lead_review_submitted')).toHaveLength(2);
    expect(types.filter((t) => t === 'lead_review_returned')).toHaveLength(2);
  });

  it('only the assignee submits; a reassignment starts a new round; the lead decides whenever', async () => {
    const qn = await assignedAndAccepted();
    await as('Engineer').put(`/api/v1/quotes/${qn}/eng-review`, SOLUTION);
    await as('Engineer').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
      rows: [await capacityRow()],
    });
    // The lead has nobody to submit to; another engineer is not the assignee.
    expect((await submit(qn, 'EngLead')).statusCode).toBe(403);
    // An engineer who isn't assigned can't see it at all (owner scope): 404.
    expect(
      (await as('Engineer', 'owner').post(`/api/v1/quotes/${qn}/eng-review/submit`)).statusCode,
    ).toBe(404);
    expect((await submit(qn)).statusCode).toBe(200);

    // Reassigning clears the round (like acceptance).
    expect((await assign(qn, await userId('Engineer', 'owner'))).statusCode).toBe(200);
    expect((await detail(qn)).engineering.leadReview.status).toBe('none');

    // The lead may decide G2 without a submission (they can fill anything in themselves).
    await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-signoff`, { status: 'approved' });
    const g2 = await decide(qn, 'G2', { outcomeKey: 'proceed' });
    expect(g2.statusCode, g2.body).toBe(201);
    expect(GateDecisionResponse.parse(g2.json()).quote.stageKey).toBe('QUOTING');
  });
});
