import {
  AdminSettingsResponse,
  AssignmentResponse,
  EngQueueResponse,
  GateDecisionResponse,
  IntakeDraft,
  MeResponse,
  PublicConfigResponse,
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
 * FB-16 (W13-12 … W13-21): Engineering & Capacity. The plant-filtered "Process & machine type" pick and
 * the derived process type, the pack-out rule, the Production Scheduler as the second assignee who owns
 * capacity, the block that returns the work to the engineer, the lead's send-back to either person, and
 * the lead's capacity approval inside the G2 decision.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-11-14T15:00:00Z');
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
const signOff = (qn: string, body: Record<string, unknown>, role: Role = 'ProductionScheduler') =>
  as(role).put(`/api/v1/quotes/${qn}/capacity-signoff`, body);
const submit = (qn: string, role: Role = 'Engineer') =>
  as(role).post(`/api/v1/quotes/${qn}/eng-review/submit`);
const sendBack = (qn: string, body: unknown, role: Role = 'EngLead') =>
  as(role).post(`/api/v1/quotes/${qn}/eng-review/send-back`, body);
const decide = (qn: string, body: Record<string, unknown>, role: Role = 'EngLead') =>
  as(role).post(`/api/v1/quotes/${qn}/gates/G2/decisions`, body);

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

const g2Decisions = async (qn: string) =>
  (
    await db.db
      .select({ id: schema.gateDecision.id })
      .from(schema.gateDecision)
      .innerJoin(schema.quote, eq(schema.quote.id, schema.gateDecision.quoteId))
      .where(and(eq(schema.quote.quoteNumber, qn), eq(schema.gateDecision.gateKey, 'G2')))
  ).length;

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
    changeReason: 'FB-16 integration test',
    value,
  });
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('fb16_engineering_capacity');
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

describe('FB-16 A: plant first, one "Process & machine type" pick (W13-12, W13-13)', () => {
  it('the public config carries the map, the two-step machine types and the pack-out rule', async () => {
    const res = await as('Engineer').get('/api/v1/config/public');
    ok(res);
    const { settings } = PublicConfigResponse.parse(res.json());
    expect(settings.machine_type_process_map).toMatchObject({ EBM: 'EBM', 'INJ-CAP': 'IMM' });
    expect(settings.two_step_plant_machine_types).toEqual({
      preform: ['INJ-PREFORM'],
      blow: ['RHB', 'ISBM'],
    });
    expect(settings.pack_out_rule).toEqual({
      requireOneOf: false,
      notTogether: [['unitsPerBag', 'unitsPerCase']],
    });
  });

  it('refuses a machine type the plant does not run, with a field error; derives the process type', async () => {
    const qn = await inEngineering();
    ok(await assign(qn, { engineerId: await userId('Engineer') }));
    // Aurora runs EBM only.
    const bad = await putReview(qn, { plantCode: 'AURORA', machineType: 'ISBM' });
    ok(bad, 422);
    expect(errorPaths(bad)).toEqual(['/machineType']);
    expect(errors(bad)[0]!.message).toBe('Aurora does not run ISBM; pick again');
    // Nothing was saved.
    expect((await detail(qn)).engineering.review).toMatchObject({
      plantCode: null,
      machineType: null,
    });

    // A plant-compatible pick: the process type follows the machine type, whatever the caller sent.
    ok(await putReview(qn, { plantCode: 'BETHLEHEM', machineType: 'ISBM', processType: 'EBM' }));
    const eng = (await detail(qn)).engineering;
    expect(eng.review).toMatchObject({
      plantCode: 'BETHLEHEM',
      machineType: 'ISBM',
      processType: 'ISBM',
    });
    expect(eng.processPairLegacy).toBe(false);

    // Changing the plant to one that does not run the saved machine type is refused the same way;
    // sending the plant with the machine type cleared is how the tab does it.
    const moved = await putReview(qn, { plantCode: 'AURORA' });
    ok(moved, 422);
    expect(errorPaths(moved)).toEqual(['/machineType']);
    ok(await putReview(qn, { plantCode: 'AURORA', machineType: null }));
    expect((await detail(qn)).engineering.review).toMatchObject({
      plantCode: 'AURORA',
      machineType: null,
      processType: null,
    });
  });

  it('an old quote keeps a pair the map would not produce until someone picks again', async () => {
    const qn = await inEngineering();
    ok(await assign(qn, { engineerId: await userId('Engineer') }));
    ok(await putReview(qn, { plantCode: 'BOXMORE', machineType: 'INJ-CAP' }));
    // As a quote saved before FB-16 holds it: the machine type with a process the map would not give.
    await db.db.execute(sql`
      update eng_review set process_type = 'EBM'
      where quote_id = (select id from quote where quote_number = ${qn})`);
    const before = (await detail(qn)).engineering;
    expect(before.review).toMatchObject({ machineType: 'INJ-CAP', processType: 'EBM' });
    expect(before.processPairLegacy).toBe(true);
    // Saving something else leaves the stored pair alone.
    ok(await putReview(qn, { cavitation: 4 }));
    expect((await detail(qn)).engineering.review.processType).toBe('EBM');
    // Picking again takes the new rules.
    ok(await putReview(qn, { machineType: 'EBM' }));
    const after = (await detail(qn)).engineering;
    expect(after.review).toMatchObject({ machineType: 'EBM', processType: 'EBM' });
    expect(after.processPairLegacy).toBe(false);
  });

  it('the Admin cannot save a map or a two-step list that names an unknown code', async () => {
    const map = await patchSetting('machine_type_process_map', { EBM: 'EBM', NOPE: 'EBM' });
    ok(map, 422);
    const process = await patchSetting('machine_type_process_map', { EBM: 'NOT_A_PROCESS' });
    ok(process, 422);
    const twoStep = await patchSetting('two_step_plant_machine_types', {
      preform: ['INJ-PREFORM'],
      blow: ['NOPE'],
    });
    ok(twoStep, 422);
  });
});

describe('FB-16 B: pack-out (W13-14)', () => {
  it('bag and case are never saved together; "one of bag / tray / case" is required only when switched on', async () => {
    const qn = await inEngineering();
    ok(await assign(qn, { engineerId: await userId('Engineer') }));
    const both = await putReview(qn, { unitsPerBag: 50, unitsPerCase: 200 });
    ok(both, 422);
    expect(errorPaths(both)).toEqual(['/unitsPerCase']);
    expect(errors(both)[0]!.message).toBe('Fill in units per bag or units per case, not both');
    // Bag with tray, or case alone, is fine.
    ok(await putReview(qn, { unitsPerBag: 50, unitsPerTray: 12 }));
    ok(await putReview(qn, { unitsPerBag: null, unitsPerCase: 200 }));
    ok(await putReview(qn, { unitsPerCase: null, unitsPerTray: null, unitsPerPallet: 4000 }));

    // Seeded off: G2 Advance does not ask for a pack-out count.
    const off = (await detail(qn)).availableActions.find((a) => a.outcomeKey === 'proceed')!;
    expect(off.missing.map((m) => m.field)).not.toContain('pack_out_units');

    // Switched on (W13-W7, when Engineering confirms): pallet alone is not enough to move forward.
    ok(
      await patchSetting('pack_out_rule', {
        requireOneOf: true,
        notTogether: [['unitsPerBag', 'unitsPerCase']],
      }),
    );
    try {
      const on = (await detail(qn)).availableActions.find((a) => a.outcomeKey === 'proceed')!;
      expect(on.missing.map((m) => m.field)).toContain('pack_out_units');
      const refused = await decide(qn, { outcomeKey: 'proceed', capacityApproved: true });
      ok(refused, 422);
      expect(errorPaths(refused)).toContain('/pack_out_units');
      // Not a forward outcome: a hold is never held up by the pack-out.
      const hold = (await detail(qn)).availableActions.find((a) => a.outcomeKey === 'hold');
      expect(hold?.missing.map((m) => m.field) ?? []).not.toContain('pack_out_units');
      ok(await putReview(qn, { unitsPerTray: 12 }));
      const filled = (await detail(qn)).availableActions.find((a) => a.outcomeKey === 'proceed')!;
      expect(filled.missing.map((m) => m.field)).not.toContain('pack_out_units');
    } finally {
      ok(
        await patchSetting('pack_out_rule', {
          requireOneOf: false,
          notTogether: [['unitsPerBag', 'unitsPerCase']],
        }),
      );
    }
  });
});

describe('FB-16 C: the Production Scheduler owns capacity (W13-15, W13-17)', () => {
  it('the lead assigns a scheduler next to the engineer; only a Production Scheduler can be picked', async () => {
    const qn = await inEngineering();
    const scheduler = await userId('ProductionScheduler');
    const engineer = await userId('Engineer');

    // The queue offers the schedulers to whoever may assign.
    expect((await queue('EngLead')).schedulers.map((s) => s.id)).toContain(scheduler);
    expect((await queue('Engineer')).schedulers).toEqual([]);

    // Not a scheduler: refused, and the engineer is not assigned either (both are checked first).
    const wrong = await assign(qn, { engineerId: engineer, schedulerId: engineer });
    ok(wrong, 422);
    expect(errorPaths(wrong)).toEqual(['/schedulerId']);
    expect((await detail(qn)).engineering.assignedEngineerId).toBeNull();
    // Only the people who assign the engineer.
    for (const role of ['Engineer', 'ProductionScheduler', 'KAM'] as Role[]) {
      const res = await assign(qn, { engineerId: engineer, schedulerId: scheduler }, role);
      expect(res.statusCode, role).toBe(403);
    }

    const res = await assign(qn, { engineerId: engineer, schedulerId: scheduler });
    ok(res);
    expect(AssignmentResponse.parse(res.json())).toMatchObject({
      assignedSchedulerId: scheduler,
      schedulerChanged: true,
    });
    const eng = (await detail(qn)).engineering;
    expect(eng).toMatchObject({ assignedEngineerId: engineer, assignedSchedulerId: scheduler });
    expect(eng.assignedSchedulerName).toBeTruthy();
    expect(await told(qn, 'quote.capacity_assigned', scheduler)).toBe(1);
    expect(await told(qn, 'quote.capacity_assigned', scheduler, 'email')).toBe(1);
    expect(await eventTypes(qn)).toContain('scheduler_assigned');

    // The same pick again changes nothing and tells nobody; leaving the field out keeps the scheduler.
    ok(await assign(qn, { engineerId: engineer, schedulerId: scheduler }));
    ok(await assign(qn, { engineerId: engineer }));
    expect((await detail(qn)).engineering.assignedSchedulerId).toBe(scheduler);
    expect(await told(qn, 'quote.capacity_assigned', scheduler)).toBe(1);

    // It is in the scheduler's "mine", with where capacity stands.
    const mine = (await queue('ProductionScheduler')).mine.find((i) => i.quoteNumber === qn)!;
    expect(mine).toMatchObject({ assignedSchedulerId: scheduler, capacitySignoffStatus: null });

    // null clears the scheduler.
    ok(await assign(qn, { engineerId: engineer, schedulerId: null }));
    expect((await detail(qn)).engineering.assignedSchedulerId).toBeNull();
    expect((await queue('ProductionScheduler')).mine.map((i) => i.quoteNumber)).not.toContain(qn);
  });

  it('the scheduler edits and signs capacity on their own quote only, and never the solution', async () => {
    const qn = await withBoth();
    const other = await inEngineering();
    ok(await assign(other, { engineerId: await userId('Engineer') }));

    // The solution stays the engineer's.
    expect((await putReview(qn, SOLUTION, 'ProductionScheduler')).statusCode).toBe(403);
    ok(await putReview(qn, SOLUTION));

    const view = (await detail(qn, 'ProductionScheduler')).engineering;
    expect(view).toMatchObject({ canEdit: false, canEditCapacity: true, canSignOffCapacity: true });
    ok(await putRows(qn, [await row()]));
    expect((await detail(qn)).engineering.capacityEvidence).toHaveLength(1);
    // The engineer can still edit the rows (the lead's and engineer's access is unchanged).
    ok(await putRows(qn, [await row({ lineAsset: 'Line 5' })], 'Engineer'));

    // A quote the scheduler is not assigned to: readable, not editable.
    const notMine = (await detail(other, 'ProductionScheduler')).engineering;
    expect(notMine).toMatchObject({ canEditCapacity: false, canSignOffCapacity: false });
    expect((await putRows(other, [await row()])).statusCode).toBe(403);
    expect((await signOff(other, { status: 'approved' })).statusCode).toBe(403);
    // The engineer does not sign capacity off.
    expect((await signOff(qn, { status: 'approved' }, 'Engineer')).statusCode).toBe(403);

    ok(await signOff(qn, { status: 'approved' }));
    const signed = (await detail(qn)).engineering;
    expect(signed.capacitySignoff.status).toBe('approved');
    const mine = (await queue('ProductionScheduler')).mine.find((i) => i.quoteNumber === qn);
    expect(mine).toMatchObject({ capacitySignoffStatus: 'approved' });
  });

  it('tells the scheduler once, the first time the solution has the plant and the machine type', async () => {
    const qn = await withBoth();
    const scheduler = await userId('ProductionScheduler');
    expect(await told(qn, 'quote.capacity_ready', scheduler)).toBe(0);
    ok(await putReview(qn, { plantCode: 'AURORA' }));
    expect(await told(qn, 'quote.capacity_ready', scheduler)).toBe(0);
    ok(await putReview(qn, { machineType: 'EBM' }));
    expect(await told(qn, 'quote.capacity_ready', scheduler)).toBe(1);
    expect(await told(qn, 'quote.capacity_ready', scheduler, 'email')).toBe(1);
    // A later change in the same stay does not page again.
    ok(await putReview(qn, { cavitation: 8 }));
    ok(await putReview(qn, { plantCode: 'GREENSBORO' }));
    expect(await told(qn, 'quote.capacity_ready', scheduler)).toBe(1);

    // Assigned after the solution was saved: the assignment notice says so, and there is no second one.
    const late = await inEngineering();
    ok(await assign(late, { engineerId: await userId('Engineer') }));
    ok(await putReview(late, SOLUTION));
    ok(await assign(late, { engineerId: await userId('Engineer'), schedulerId: scheduler }));
    expect(await told(late, 'quote.capacity_assigned', scheduler)).toBe(1);
    ok(await putReview(late, { cavitation: 6 }));
    expect(await told(late, 'quote.capacity_ready', scheduler)).toBe(0);
  });

  it('a block needs a note and goes straight back to the engineer; the engineer, the lead and the KAM are told', async () => {
    const qn = await withBoth();
    const engineer = await userId('Engineer');
    const lead = await userId('EngLead');
    const kam = (
      await db.db
        .select({ kam: schema.quote.kamUserId })
        .from(schema.quote)
        .where(eq(schema.quote.quoteNumber, qn))
    )[0]!.kam;
    ok(await putReview(qn, SOLUTION));
    ok(await putRows(qn, [await row()]));
    ok(await as('Engineer').post(`/api/v1/quotes/${qn}/eng-review/accept`));
    ok(await submit(qn));
    // FB-22 (N17-14): with a scheduler assigned, the review is with the lead once both parts are in.
    ok(await as('ProductionScheduler').post(`/api/v1/quotes/${qn}/eng-review/submit-capacity`));
    expect((await detail(qn)).engineering.leadReview.status).toBe('submitted');

    expect((await signOff(qn, { status: 'blocked' })).statusCode).toBe(422);
    const kamToldBefore = await told(qn, 'quote.lead_review_update', kam);
    tick();
    ok(await signOff(qn, { status: 'blocked', note: 'Line 4 is full until March' }));

    const d = await detail(qn, 'Engineer');
    expect(d.stageKey).toBe('ENG_REVIEW');
    expect(d.status).toBe('active');
    expect(d.engineering.capacitySignoff).toMatchObject({
      status: 'blocked',
      note: 'Line 4 is full until March',
    });
    expect(d.engineering.leadReview).toMatchObject({
      status: 'returned',
      returnNote: 'Capacity blocked: Line 4 is full until March',
    });
    expect(d.engineering.leadReview.returnedToName).toBeTruthy();
    // Unlocked again for the engineer; FB-22: the scheduler's capacity part is reopened too.
    expect(d.engineering.canEdit).toBe(true);
    expect(d.engineering.leadReview.parts?.scheduler?.in).toBe(false);

    expect(await told(qn, 'quote.capacity_blocked', engineer)).toBe(1);
    expect(await told(qn, 'quote.capacity_blocked', engineer, 'email')).toBe(1);
    expect(await told(qn, 'quote.capacity_blocked', lead)).toBe(1);
    expect(await told(qn, 'quote.lead_review_update', kam)).toBe(kamToldBefore + 1);
    // The KAM's note is in-app only, like every lead-review update.
    expect(await told(qn, 'quote.lead_review_update', kam, 'email')).toBe(0);
    // No gate decision was recorded.
    expect(await g2Decisions(qn)).toBe(0);

    // Blocking again changes the note but does not return it (or page anyone) a second time.
    ok(await signOff(qn, { status: 'blocked', note: 'Still full' }));
    expect(await told(qn, 'quote.capacity_blocked', engineer)).toBe(1);

    // The lead cannot wave a block through in the decision.
    const g2 = await decide(qn, { outcomeKey: 'proceed', capacityApproved: true });
    ok(g2, 422);
    expect(errorPaths(g2)).toContain('/capacityApproved');

    // The engineer reworks it; the scheduler approves; the engineer submits again.
    ok(await putReview(qn, { cavitation: 6 }));
    ok(await signOff(qn, { status: 'approved' }));
    ok(await submit(qn));
  });
});

describe('FB-16 D: the lead sends back to either person (W13-19)', () => {
  it('offers both, records who it went to, and tells only that person', async () => {
    const qn = await withBoth();
    const scheduler = await userId('ProductionScheduler');
    const engineer = await userId('Engineer');
    ok(await putReview(qn, SOLUTION));
    ok(await putRows(qn, [await row()]));
    ok(await as('Engineer').post(`/api/v1/quotes/${qn}/eng-review/accept`));
    ok(await submit(qn));

    const targets = (await detail(qn)).engineering.leadReview.returnTargets ?? [];
    expect(targets.map((t) => t.target)).toEqual(['assignee', 'scheduler']);

    expect((await sendBack(qn, { note: 'x', to: 'nobody' })).statusCode).toBe(400);
    ok(await sendBack(qn, { note: 'Check the effectiveness on line 4', to: 'scheduler' }));
    const back = (await detail(qn)).engineering.leadReview;
    expect(back).toMatchObject({
      status: 'returned',
      returnNote: 'Check the effectiveness on line 4',
    });
    expect(back.returnedToName).toBe((await detail(qn)).engineering.assignedSchedulerName);
    expect(await told(qn, 'quote.returned_by_lead', scheduler)).toBe(1);
    expect(await told(qn, 'quote.returned_by_lead', engineer)).toBe(0);
    // The scheduler works the rows and (FB-22) submits capacity again; the engineer's part stayed in.
    ok(await putRows(qn, [await row({ assumedEffectivenessPct: 65 })]));
    ok(await as('ProductionScheduler').post(`/api/v1/quotes/${qn}/eng-review/submit-capacity`));

    // The default is still the engineer.
    ok(await sendBack(qn, { note: 'Check the cavitation' }));
    expect(await told(qn, 'quote.returned_by_lead', engineer)).toBe(1);
    expect(await told(qn, 'quote.returned_by_lead', scheduler)).toBe(1);

    // With no scheduler on the quote there is one target, and "scheduler" is refused.
    const solo = await inEngineering();
    ok(await assign(solo, { engineerId: engineer }));
    ok(await putReview(solo, SOLUTION));
    ok(await putRows(solo, [await row({ analystId: engineer })], 'Engineer'));
    ok(await as('Engineer').post(`/api/v1/quotes/${solo}/eng-review/accept`));
    ok(await submit(solo));
    const only = (await detail(solo)).engineering.leadReview.returnTargets ?? [];
    expect(only.map((t) => t.target)).toEqual(['assignee']);
    const refused = await sendBack(solo, { note: 'x', to: 'scheduler' });
    ok(refused, 422);
    expect(errorPaths(refused)).toEqual(['/to']);
  });
});

describe('FB-16 E: the lead approves capacity in the G2 decision (W13-18)', () => {
  it('G2 Advance with "Capacity approved" signs it off and moves the quote in one step', async () => {
    const qn = await inEngineering();
    ok(await assign(qn, { engineerId: await userId('Engineer') }));
    ok(await putReview(qn, SOLUTION));
    ok(await putRows(qn, [await row({ analystId: await userId('Engineer') })], 'Engineer'));

    const proceed = (await detail(qn)).availableActions.find((a) => a.outcomeKey === 'proceed')!;
    expect(proceed.capacityApproval).toBe(true);
    expect(proceed.missing.map((m) => m.field)).not.toContain('capacity_signoff_status');

    // Without the tick the sign-off is still missing.
    const without = await decide(qn, { outcomeKey: 'proceed' });
    ok(without, 422);
    expect(errorPaths(without)).toContain('/capacity_signoff_status');

    tick();
    const res = await decide(qn, { outcomeKey: 'proceed', capacityApproved: true });
    ok(res, 201);
    expect(GateDecisionResponse.parse(res.json()).quote.stageKey).toBe('QUOTING');
    expect((await detail(qn)).engineering.capacitySignoff.status).toBe('approved');
    expect(await eventTypes(qn)).toContain('capacity_signoff');
    expect(await g2Decisions(qn)).toBe(1);
  });

  it('once capacity is signed the tick is not offered, and sending it is refused', async () => {
    const qn = await withBoth();
    ok(await putReview(qn, SOLUTION));
    ok(await putRows(qn, [await row()]));
    ok(await signOff(qn, { status: 'approved' }));
    const proceed = (await detail(qn)).availableActions.find((a) => a.outcomeKey === 'proceed')!;
    expect(proceed.capacityApproval).toBe(false);
    const twice = await decide(qn, { outcomeKey: 'proceed', capacityApproved: true });
    ok(twice, 422);
    expect(errorPaths(twice)).toContain('/capacityApproved');
    ok(await decide(qn, { outcomeKey: 'proceed' }), 201);
  });
});

describe('FB-16 F: one stage, "Engineering & Capacity"', () => {
  it('the stage is renamed for everyone; its key is unchanged', async () => {
    const res = await as('KAM').get('/api/v1/config/public');
    ok(res);
    const { stages } = PublicConfigResponse.parse(res.json());
    expect(stages.find((s) => s.key === 'ENG_REVIEW')?.label).toBe('Engineering & Capacity');
    expect(stages.map((s) => s.label)).not.toContain('Engineering Review');
  });
});
