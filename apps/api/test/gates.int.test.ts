import {
  GateDecisionResponse,
  GateQueueResponse,
  IntakeDraft,
  IntakeDraftListResponse,
  QuoteDetail,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import type { PlannedNotification, Role } from '@ccq/domain';
import { and, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * B-08: the generic gate-decision route driven through G1 (all five outcomes), the G1 queue, the
 * "only SalesLeader decides G1" permission check, rework round-trip, qualification warnings,
 * peer-score and commercial redaction, and the g1_enabled=false path.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
const clock = new Date('2026-10-26T15:00:00Z');
const notified: { notifications: readonly PlannedNotification[]; gateKey: string }[] = [];

let free: string[] = [];
const nextFree = () => {
  const id = free.shift();
  if (!id) throw new Error('test ran out of free opportunities');
  return id;
};

const kam = () => asRole(app, 'KAM');
const leader = () => asRole(app, 'SalesLeader');

async function prefill(
  sfOpportunityId: string,
  over: IntakeDraftData = {},
): Promise<IntakeDraftData> {
  const res = await kam().get(`/api/v1/salesforce/opportunities/${sfOpportunityId}`);
  expect(res.statusCode, res.body).toBe(200);
  const sf = SfOpportunityDetail.parse(res.json());
  const shipTo = sf.account?.shipTo ?? {
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

/** A KAM-submitted quote waiting for G1. */
async function submitted(over: IntakeDraftData = {}): Promise<SubmitIntakeResponse> {
  const created = await kam().post('/api/v1/quotes/drafts', {
    data: await prefill(nextFree(), over),
  });
  expect(created.statusCode, created.body).toBe(201);
  const draft = IntakeDraft.parse(created.json());
  const res = await kam().post(`/api/v1/quotes/drafts/${draft.id}/submit`);
  expect(res.statusCode, res.body).toBe(201);
  const body = SubmitIntakeResponse.parse(res.json());
  expect(body.routedTo).toBe('G1');
  return body;
}

const decide = (quoteNumber: string, body: Record<string, unknown>, role: Role = 'SalesLeader') =>
  asRole(app, role).post(`/api/v1/quotes/${quoteNumber}/gates/G1/decisions`, body);

const errorCodes = (res: { json: () => unknown }) =>
  ((res.json() as { errors?: { code: string }[] }).errors ?? []).map((e) => e.code).sort();

const setSetting = (key: string, value: unknown) =>
  db.db.execute(
    sql`update app_setting set value = ${JSON.stringify(value)}::jsonb where key = ${key}`,
  );

async function detail(quoteNumber: string, role: Role = 'SalesLeader') {
  const res = await asRole(app, role).get(`/api/v1/quotes/${quoteNumber}`);
  expect(res.statusCode, res.body).toBe(200);
  return QuoteDetail.parse(res.json());
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('gates');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url }), {
    db,
    now: () => clock,
    notify: (notifications, ctx) => {
      notified.push({ notifications, gateKey: ctx.gateKey });
    },
  });
  await app.ready();
  const rows = await db.db.execute<{ id: string }>(sql`
    select s.sf_opportunity_id as id from sf_opportunity_snapshot s
    where not s.is_closed and s.account_id is not null
      and not exists (select 1 from quote q where q.sf_opportunity_id = s.sf_opportunity_id and q.status <> 'closed')
    order by s.sf_opportunity_id`);
  free = rows.map((r) => r.id);
  expect(free.length).toBeGreaterThanOrEqual(10);
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('scoring and the quote read', () => {
  it('a submitted quote carries an explained, advisory score; capital is unknown until G2', async () => {
    const q = await submitted();
    const d = await detail(q.quoteNumber);
    expect(d.priority).toMatchObject({
      visible: true,
      score: q.priorityScore,
      tier: q.priorityTier,
      computedTier: q.priorityTier,
      tierOverridden: false,
      modelVersion: 1,
    });
    expect(d.priority.breakdown.map((b) => b.key)).toEqual([
      'revenue',
      'volume',
      'strategic_fit',
      'capital_exposure',
      'customer_risk',
      'product_fit',
      'timing',
    ]);
    expect(d.priority.unknowns).toEqual(['capital_exposure']);
    expect(d.priority.breakdown.find((b) => b.key === 'capital_exposure')!.explanation).toContain(
      'unknown until Engineering Review',
    );
    expect(d.priority.tierLabel).toMatch(/^(Critical|High|Standard|Low)$/);
  });

  it('every quote view is audited', async () => {
    const q = await submitted();
    await detail(q.quoteNumber, 'Leadership');
    const audits = await db.db
      .select()
      .from(schema.auditEvent)
      .where(and(eq(schema.auditEvent.quoteId, q.quoteId), eq(schema.auditEvent.action, 'view')));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorRoles).toEqual(['Leadership']);
  });

  it('the SalesLeader sees the five G1 actions with a completeness summary; others see none', async () => {
    const q = await submitted();
    const d = await detail(q.quoteNumber);
    expect(d.availableActions.map((a) => a.outcomeKey)).toEqual([
      'advance',
      'hold',
      'rework',
      'redirect',
      'stop',
    ]);
    const hold = d.availableActions.find((a) => a.outcomeKey === 'hold')!;
    expect(hold).toMatchObject({ requiresReviewDate: true, requiresReasonCode: true, missing: [] });
    expect(d.availableActions.find((a) => a.outcomeKey === 'advance')!.missing).toEqual([]);
    for (const role of ['KAM', 'EngLead', 'Pricing', 'Approver', 'Leadership', 'Admin'] as Role[]) {
      expect((await detail(q.quoteNumber, role)).availableActions).toEqual([]);
    }
  });

  it('unknown quote → 404; malformed number → 400', async () => {
    expect((await leader().get('/api/v1/quotes/CCQ-2099-99999')).statusCode).toBe(404);
    expect((await leader().get('/api/v1/quotes/nope')).statusCode).toBe(400);
  });
});

describe('the G1 queue ("To qualify")', () => {
  it('lists submitted INTAKE quotes highest score first, excluding quotes back for rework', async () => {
    const res = await leader().get('/api/v1/gates/G1/queue');
    expect(res.statusCode, res.body).toBe(200);
    const queue = GateQueueResponse.parse(res.json());
    expect(queue.gate).toMatchObject({ key: 'G1', stageKey: 'INTAKE', enabled: true });
    expect(queue.canDecide).toBe(true);
    expect(queue.items.length).toBeGreaterThan(0);
    expect(queue.items.every((i) => i.stageKey === 'INTAKE' && i.submittedAt !== null)).toBe(true);
    const scores = queue.items.map((i) => i.priority.score ?? -1);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(queue.items[0]!.requestClass).not.toBeUndefined();

    const kamView = GateQueueResponse.parse((await kam().get('/api/v1/gates/G1/queue')).json());
    expect(kamView.canDecide).toBe(false);
  });

  it('unknown gate → 404', async () => {
    expect((await leader().get('/api/v1/gates/G9/queue')).statusCode).toBe(404);
  });
});

describe('G1 decisions through the generic route', () => {
  it('only SalesLeader decides G1 (every other role gets 403)', async () => {
    const q = await submitted();
    for (const role of [
      'KAM',
      'EngLead',
      'Engineer',
      'Pricing',
      'Approver',
      'Leadership',
      'Admin',
    ] as Role[]) {
      const res = await decide(q.quoteNumber, { outcomeKey: 'advance' }, role);
      expect(res.statusCode, `${role}: ${res.body}`).toBe(403);
    }
    const ok = await decide(q.quoteNumber, { outcomeKey: 'advance' });
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it('Advance → ENG_REVIEW atomically: decision with evidence, history, activity, audit, rescore, notification', async () => {
    const q = await submitted();
    notified.length = 0;
    const res = await decide(q.quoteNumber, { outcomeKey: 'advance', note: 'Good fit' });
    expect(res.statusCode, res.body).toBe(201);
    const body = GateDecisionResponse.parse(res.json());
    expect(body.quote).toMatchObject({ stageKey: 'ENG_REVIEW', status: 'active' });
    expect(body.decision).toMatchObject({ gateKey: 'G1', outcomeKey: 'advance', note: 'Good fit' });

    const [decision] = await db.db
      .select()
      .from(schema.gateDecision)
      .where(eq(schema.gateDecision.quoteId, q.quoteId));
    const evidence = decision!.evidence as Record<string, unknown>;
    expect(evidence).toMatchObject({
      stageKey: 'INTAKE',
      priority: { score: q.priorityScore, tier: q.priorityTier, modelVersion: 1 },
      warnings: [],
      intake: { quoteNumber: q.quoteNumber, productFamily: 'BOTTLE', resin: 'HDPE' },
    });
    const history = await db.db
      .select()
      .from(schema.stageHistory)
      .where(eq(schema.stageHistory.quoteId, q.quoteId));
    expect(history.map((h) => [h.stageKey, h.exitedAt !== null])).toEqual([
      ['INTAKE', true],
      ['ENG_REVIEW', false],
    ]);
    const activity = await db.db
      .select()
      .from(schema.activityEvent)
      .where(eq(schema.activityEvent.quoteId, q.quoteId));
    expect(activity.map((a) => a.type)).toEqual(
      expect.arrayContaining(['quote_created', 'gate_decided', 'stage_changed']),
    );
    const audit = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.quoteId, q.quoteId), eq(schema.auditEvent.action, 'stage_change')),
      );
    expect(audit).toHaveLength(1);
    const [row] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, q.quoteId));
    expect(row!.priorityScoredAt).toEqual(clock);
    expect(notified).toEqual([
      {
        gateKey: 'G1',
        notifications: [
          { type: 'quote.ready_for_eng_review', recipient: { kind: 'role', role: 'EngLead' } },
        ],
      },
    ]);
    // A decided gate can't be decided again: the quote has left INTAKE.
    const again = await decide(q.quoteNumber, { outcomeKey: 'advance' });
    expect(again.statusCode).toBe(422);
    expect(errorCodes(again)).toEqual(['WRONG_STAGE']);
  });

  it('Hold needs a review date and a reason; then the quote is on hold with the date recorded', async () => {
    const q = await submitted();
    const bad = await decide(q.quoteNumber, { outcomeKey: 'hold' });
    expect(bad.statusCode).toBe(422);
    expect(errorCodes(bad)).toEqual(['MISSING_FIELD', 'REASON_REQUIRED']);

    const res = await decide(q.quoteNumber, {
      outcomeKey: 'hold',
      reasonCode: 'awaiting_customer_info',
      holdUntil: '2026-11-09',
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = GateDecisionResponse.parse(res.json());
    expect(body.quote).toMatchObject({
      stageKey: 'INTAKE',
      status: 'on_hold',
      reviewDate: '2026-11-09',
    });
    const holds = await db.db
      .select()
      .from(schema.quoteHold)
      .where(eq(schema.quoteHold.quoteId, q.quoteId));
    expect(holds).toHaveLength(1);
    // Still in the queue (on hold), and the next decision resumes it.
    const queue = GateQueueResponse.parse((await leader().get('/api/v1/gates/G1/queue')).json());
    expect(queue.items.find((i) => i.quoteNumber === q.quoteNumber)?.status).toBe('on_hold');
    const resume = await decide(q.quoteNumber, { outcomeKey: 'advance' });
    expect(resume.statusCode, resume.body).toBe(201);
  });

  it('Redirect needs a reason and closes as REDIRECTED', async () => {
    const q = await submitted({ requestClass: 'STOCK' });
    const bad = await decide(q.quoteNumber, { outcomeKey: 'redirect' });
    expect(errorCodes(bad)).toEqual(['REASON_REQUIRED']);
    const wrongContext = await decide(q.quoteNumber, {
      outcomeKey: 'redirect',
      reasonCode: 'not_strategic',
    });
    expect(errorCodes(wrongContext)).toEqual(['INVALID_REASON']);
    const res = await decide(q.quoteNumber, { outcomeKey: 'redirect', reasonCode: 'stock_item' });
    expect(res.statusCode, res.body).toBe(201);
    const [row] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, q.quoteId));
    expect(row).toMatchObject({
      stageKey: 'REDIRECTED',
      status: 'closed',
      outcome: 'redirected',
      outcomeReasonCode: 'stock_item',
    });
    expect(row!.closedAt).toEqual(clock);
  });

  it('Stop needs a reason code and a note and closes as DECLINED', async () => {
    const q = await submitted();
    const bad = await decide(q.quoteNumber, { outcomeKey: 'stop', reasonCode: 'not_strategic' });
    expect(errorCodes(bad)).toEqual(['NOTE_REQUIRED']);
    const res = await decide(q.quoteNumber, {
      outcomeKey: 'stop',
      reasonCode: 'below_minimum_threshold',
      note: 'An $18k opportunity cannot justify a new mold set',
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(GateDecisionResponse.parse(res.json()).quote).toMatchObject({
      stageKey: 'DECLINED',
      status: 'closed',
      outcome: 'declined',
    });
  });

  it('rejects unknown gates and outcomes', async () => {
    const q = await submitted();
    expect(
      (
        await leader().post(`/api/v1/quotes/${q.quoteNumber}/gates/G9/decisions`, {
          outcomeKey: 'x',
        })
      ).statusCode,
    ).toBe(404);
    const res = await decide(q.quoteNumber, { outcomeKey: 'approve' });
    expect(errorCodes(res)).toEqual(['UNKNOWN_OUTCOME']);
    expect((await decide(q.quoteNumber, {})).statusCode).toBe(400);
    expect((await decide('CCQ-2099-99999', { outcomeKey: 'advance' })).statusCode).toBe(404);
  });
});

describe('Rework: back to the KAM, fixed, resubmitted', () => {
  let q: SubmitIntakeResponse;

  it('needs a reason code and a note', async () => {
    q = await submitted({ estAnnualVolume: 60_000, estAnnualRevenue: 20_000 });
    const bad = await decide(q.quoteNumber, { outcomeKey: 'rework' });
    expect(errorCodes(bad)).toEqual(['NOTE_REQUIRED', 'REASON_REQUIRED']);
  });

  it('returns the quote to INTAKE, un-submitted, version 2, with a banner of what to fix', async () => {
    const res = await decide(q.quoteNumber, {
      outcomeKey: 'rework',
      reasonCode: 'missing_information',
      note: 'Volume looks low: confirm the annual volume by SKU',
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = GateDecisionResponse.parse(res.json());
    expect(body.quote).toMatchObject({ stageKey: 'INTAKE', version: 2, submittedAt: null });
    expect(body.quote.rework).toMatchObject({
      gateKey: 'G1',
      reasonLabel: 'Missing information',
      note: 'Volume looks low: confirm the annual volume by SKU',
    });
    // Not in the G1 queue, and G1 can't be decided until it is resubmitted.
    const queue = GateQueueResponse.parse((await leader().get('/api/v1/gates/G1/queue')).json());
    expect(queue.items.map((i) => i.quoteNumber)).not.toContain(q.quoteNumber);
    const early = await decide(q.quoteNumber, { outcomeKey: 'advance' });
    expect(errorCodes(early)).toEqual(['MISSING_FIELD']);
  });

  it("shows up in the KAM's drafts as returned; only the KAM can open the rework draft", async () => {
    const list = IntakeDraftListResponse.parse((await kam().get('/api/v1/quotes/drafts')).json());
    const returned = list.returned.find((r) => r.quoteNumber === q.quoteNumber);
    expect(returned).toMatchObject({
      gateKey: 'G1',
      reasonLabel: 'Missing information',
      draftId: null,
    });
    expect((await leader().post(`/api/v1/quotes/${q.quoteNumber}/rework`)).statusCode).toBe(403);
  });

  it('the KAM fixes it in a rework draft and resubmits the same quote; it is rescored', async () => {
    const open = await kam().post(`/api/v1/quotes/${q.quoteNumber}/rework`);
    expect(open.statusCode, open.body).toBe(200);
    const draft = IntakeDraft.parse(open.json());
    expect(draft.rework).toMatchObject({ quoteNumber: q.quoteNumber, gateKey: 'G1' });
    expect(draft.data.estAnnualVolume).toBe(60_000);
    // Idempotent: the same draft comes back.
    const again = IntakeDraft.parse(
      (await kam().post(`/api/v1/quotes/${q.quoteNumber}/rework`)).json(),
    );
    expect(again.id).toBe(draft.id);
    const list = IntakeDraftListResponse.parse((await kam().get('/api/v1/quotes/drafts')).json());
    expect(list.items.map((i) => i.id)).not.toContain(draft.id); // listed under `returned`
    expect(list.returned.find((r) => r.quoteNumber === q.quoteNumber)?.draftId).toBe(draft.id);

    await kam().patch(`/api/v1/quotes/drafts/${draft.id}`, {
      data: {
        estAnnualVolume: 3_000_000,
        estAnnualRevenue: 400_000,
        expectedCloseDate: '2026-11-10',
      },
    });
    const res = await kam().post(`/api/v1/quotes/drafts/${draft.id}/submit`);
    expect(res.statusCode, res.body).toBe(201);
    const body = SubmitIntakeResponse.parse(res.json());
    expect(body).toMatchObject({
      quoteNumber: q.quoteNumber,
      quoteId: q.quoteId,
      resubmitted: true,
      routedTo: 'G1',
    });
    expect(body.priorityScore!).toBeGreaterThan(q.priorityScore!);

    const d = await detail(q.quoteNumber);
    expect(d).toMatchObject({ version: 2, estAnnualVolume: 3_000_000, rework: null });
    expect(d.submittedAt).not.toBeNull();
    const events = await db.db
      .select()
      .from(schema.activityEvent)
      .where(eq(schema.activityEvent.quoteId, q.quoteId))
      .orderBy(desc(schema.activityEvent.at));
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['quote_resubmitted', 'priority_tier_changed']),
    );
    const tierChange = events.find((e) => e.type === 'priority_tier_changed')!;
    expect(tierChange.payload).toMatchObject({
      from: q.priorityTier,
      to: body.priorityTier,
      trigger: 'intake_resubmit',
    });
    // Back in the queue and decidable.
    expect((await decide(q.quoteNumber, { outcomeKey: 'advance' })).statusCode).toBe(201);
  });

  it('a quote that is not back for rework cannot be reworked', async () => {
    expect((await kam().post(`/api/v1/quotes/${q.quoteNumber}/rework`)).statusCode).toBe(409);
  });
});

describe('qualification warnings (D-06: warn, never block)', () => {
  it('flag a low-value quote in the queue and require a strategic exception note to advance', async () => {
    await setSetting('min_opportunity_value_warning_usd', 25_000);
    await setSetting('min_volume_warning_by_process', { '*': 100_000 });
    try {
      const q = await submitted({ estAnnualRevenue: 18_000, estAnnualVolume: 40_000 });
      const queue = GateQueueResponse.parse((await leader().get('/api/v1/gates/G1/queue')).json());
      const item = queue.items.find((i) => i.quoteNumber === q.quoteNumber)!;
      expect(item.warnings.map((w) => w.code)).toEqual(['below_min_value', 'below_min_volume']);
      expect(item.warnings[0]!.message).toContain('Below the $25,000 minimum');

      const d = await detail(q.quoteNumber);
      expect(
        d.availableActions.find((a) => a.outcomeKey === 'advance')!.requiresExceptionNote,
      ).toBe(true);
      const noNote = await decide(q.quoteNumber, { outcomeKey: 'advance' });
      expect(noNote.statusCode).toBe(422);
      expect(errorCodes(noNote)).toEqual(['NOTE_REQUIRED']);
      const ok = await decide(q.quoteNumber, {
        outcomeKey: 'advance',
        note: 'Strategic: opens the account for a larger closure program',
      });
      expect(ok.statusCode, ok.body).toBe(201);
      const evidence = GateDecisionResponse.parse(ok.json()).decision;
      expect(evidence.note).toContain('Strategic');
    } finally {
      await setSetting('min_opportunity_value_warning_usd', null);
      await setSetting('min_volume_warning_by_process', {});
    }
  });
});

describe('redaction', () => {
  it("kam_can_see_peer_scores=false hides other KAMs' scores server-side", async () => {
    const own = await submitted();
    const [peer] = await db.db.execute<{ quote_number: string }>(sql`
      select q.quote_number from quote q join app_user u on u.id = q.kam_user_id
      where u.upn not like 'kam@%' and q.stage_key = 'INTAKE' and q.submitted_at is not null limit 1`);
    await setSetting('kam_can_see_peer_scores', false);
    try {
      const peerView = await detail(peer!.quote_number, 'KAM');
      expect(peerView.priority).toMatchObject({
        visible: false,
        score: null,
        tier: null,
        breakdown: [],
      });
      expect((await detail(own.quoteNumber, 'KAM')).priority.visible).toBe(true);
      expect((await detail(peer!.quote_number, 'SalesLeader')).priority.visible).toBe(true);
      const queue = GateQueueResponse.parse((await kam().get('/api/v1/gates/G1/queue')).json());
      const hidden = queue.items.find((i) => i.quoteNumber === peer!.quote_number);
      expect(hidden?.priority.score).toBeNull();
    } finally {
      await setSetting('kam_can_see_peer_scores', true);
    }
  });

  it('the capital figure behind capital exposure is stripped for roles without commercial access', async () => {
    const [row] = await db.db.execute<{ quote_number: string }>(sql`
      select q.quote_number from quote q join eng_review e on e.quote_id = q.id
      where e.prelim_capital_usd is not null and q.stage_key = 'QUOTING' limit 1`);
    const kamItem = (await detail(row!.quote_number, 'KAM')).priority.breakdown.find(
      (b) => b.key === 'capital_exposure',
    )!;
    expect(kamItem).toMatchObject({ raw: null, sensitive: true, unknown: false });
    expect(kamItem.explanation).toContain('restricted');
    const pricingItem = (await detail(row!.quote_number, 'Pricing')).priority.breakdown.find(
      (b) => b.key === 'capital_exposure',
    )!;
    expect(pricingItem.raw).toEqual(expect.any(Number));
    expect(pricingItem.points).toBe(kamItem.points);
  });
});

describe('g1_enabled=false', () => {
  it('hides the G1 queue and refuses G1 decisions; submit goes straight to ENG_REVIEW', async () => {
    const waiting = await submitted();
    await db.db.execute(
      sql`update gate_definition set enabled = (key = 'SUBMIT') where key in ('G1', 'SUBMIT')`,
    );
    try {
      const queue = GateQueueResponse.parse((await leader().get('/api/v1/gates/G1/queue')).json());
      expect(queue).toMatchObject({ gate: { enabled: false }, canDecide: false, items: [] });
      const res = await decide(waiting.quoteNumber, { outcomeKey: 'advance' });
      expect(res.statusCode).toBe(422);
      expect(errorCodes(res)).toEqual(['GATE_DISABLED']);
      // No G1 actions; a quote already waiting can still be pushed through the SUBMIT gate.
      expect((await detail(waiting.quoteNumber)).availableActions.map((a) => a.gateKey)).toEqual([
        'SUBMIT',
      ]);

      const created = await kam().post('/api/v1/quotes/drafts', {
        data: await prefill(nextFree()),
      });
      const draft = IntakeDraft.parse(created.json());
      const sub = SubmitIntakeResponse.parse(
        (await kam().post(`/api/v1/quotes/drafts/${draft.id}/submit`)).json(),
      );
      expect(sub).toMatchObject({ stageKey: 'ENG_REVIEW', routedTo: 'ENG_REVIEW' });
      expect(sub.priorityScore).toEqual(expect.any(Number));
    } finally {
      await db.db.execute(
        sql`update gate_definition set enabled = (key = 'G1') where key in ('G1', 'SUBMIT')`,
      );
    }
  });
});
