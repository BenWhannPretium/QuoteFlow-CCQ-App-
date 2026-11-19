import {
  DEV_USER_HEADER,
  IntakeDraft,
  MeResponse,
  QuoteDetail,
  SfOpportunityDetail,
  SfWritebackPreview,
  SfWritebackRow,
  SfWritebackSummary,
  SubmitIntakeResponse,
  type IntakeDraftData,
  type IntakeItemData,
} from '@ccq/contracts';
import { createDb, schema, uuidv7, withSystemContext, type DbClient } from '@ccq/db';
import { refreshQuoteSfStatusFlags } from '@ccq/db/repos';
import {
  SF_WRITEBACK_MAP_SEED,
  addCalendarDays,
  asUserId,
  proposalCalendarDate,
  type Actor,
} from '@ccq/domain';
import { FakeSalesforceWriter, SF_WRITE_ALLOW_LIST } from '@ccq/integrations';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { confirmCapitalTerms, prepareModels } from './model-helpers';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { SfWritebackService } from '../src/services/sfWriteback';
import { testConfig } from '../src/test-utils';

/**
 * FB-29 (N19-01, N19-02): the Salesforce write-back, against a real Postgres and the FAKE writer only (no
 * session may write to a real Salesforce org). Switched off: nothing queued; dry run: recorded, never
 * sent; live: sent, retried, failed loudly, audited; never closes an opportunity another quote or an open
 * re-quote needs; a re-quote reopens only over a close QuoteFlow wrote; the Admin card and its routes.
 */
let db: DbClient;
let url: string;
let app: Awaited<ReturnType<typeof buildApp>>;
const writer = new FakeSalesforceWriter();
let clock = new Date('2026-11-02T15:00:00Z');
const HOUR = 3_600_000;
const MINUTE = 60_000;
const tick = (ms = HOUR) => {
  clock = new Date(clock.getTime() + ms);
};

const created: string[] = [];
async function nextFree(): Promise<string> {
  const [row] = await db.db.execute<{ id: string }>(sql`
    select s.sf_opportunity_id as id from sf_opportunity_snapshot s
    where not s.is_closed and s.account_id is not null
      and not exists (select 1 from quote q where q.sf_opportunity_id = s.sf_opportunity_id and q.status <> 'closed')
      and not exists (select 1 from quote_draft d where d.sf_opportunity_id = s.sf_opportunity_id and d.submitted_quote_id is null)
    order by s.sf_opportunity_id limit 1`);
  if (row) return row.id;
  const old = created.shift();
  if (!old) throw new Error('test ran out of free opportunities');
  await db.db.execute(sql`
    update quote set stage_key = 'DECLINED', status = 'closed', outcome = 'declined', closed_at = now(),
      outcome_reason_code = 'other', closure_owner_id = kam_user_id
    where quote_number = ${old} and status <> 'closed'`);
  return nextFree();
}

const persona = (key: string) => {
  const send = (method: 'GET' | 'POST' | 'PUT', path: string, payload?: unknown) =>
    app.inject({
      method,
      url: path,
      headers: { [DEV_USER_HEADER]: key },
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  return {
    get: (p: string) => send('GET', p),
    post: (p: string, body?: unknown) => send('POST', p, body),
    put: (p: string, body?: unknown) => send('PUT', p, body),
  };
};
const ids: Record<string, string> = {};
async function userId(key: string): Promise<string> {
  ids[key] ??= MeResponse.parse((await persona(key).get('/api/v1/me')).json()).user.id;
  return ids[key];
}
const decide = (qn: string, gate: string, body: Record<string, unknown>, by: string) =>
  persona(by).post(`/api/v1/quotes/${qn}/gates/${gate}/decisions`, body);
const ok = (res: { statusCode: number; body: string }, status = 201) =>
  expect(res.statusCode, res.body).toBe(status);
const today = () => proposalCalendarDate(clock);

const SHIP_TO = { line1: '1 Test St', city: 'Testville', state: 'MO', postal: '63101', country: 'US' };

async function request(sfOpportunityId: string): Promise<IntakeDraftData> {
  const sf = SfOpportunityDetail.parse(
    (await persona('kam').get(`/api/v1/salesforce/opportunities/${sfOpportunityId}`)).json(),
  );
  return {
    sfOpportunityId,
    sfOpportunityName: sf.opportunity.name,
    customer: {
      status: 'existing',
      sfAccountId: sf.account?.id ?? sf.opportunity.accountId,
      name: sf.account?.name ?? sf.opportunity.accountName,
    },
    shipTo: SHIP_TO,
    shipToDefault: SHIP_TO,
    requestClass: 'CCQ',
    market: 'FOOD',
    subMarket: 'FOOD_SNACKS',
    estAnnualRevenue: 300_000,
    quoteNeededBy: addCalendarDays(today(), 60),
    description: 'Synthetic write-back test',
    commentsForEngineering: 'Same tooling as the last quote',
  };
}

const item = (key: string): IntakeItemData => ({
  key,
  label: '16 oz bottle',
  productFamily: 'BOTTLE',
  components: ['CONTAINER'],
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
  productNeededBy: addCalendarDays(today(), 150),
  containerSize: '16 oz',
  standardDescription: '16 oz Bottle, HDPE',
  drawingStatus: 'HAVE_DRAWING',
});

async function submitDraft(data: IntakeDraftData) {
  const res = await persona('kam').post('/api/v1/quotes/drafts', { data });
  ok(res);
  const sub = await persona('kam').post(
    `/api/v1/quotes/drafts/${IntakeDraft.parse(res.json()).id}/submit`,
  );
  ok(sub);
  const { quoteNumber } = SubmitIntakeResponse.parse(sub.json());
  created.push(quoteNumber);
  return quoteNumber;
}

/** One item, all the way to Customer Decision. */
async function inCustomerDecision(sfOpportunityId?: string) {
  const qn = await submitDraft({
    ...(await request(sfOpportunityId ?? (await nextFree()))),
    items: [item(uuidv7())],
  });
  ok(await decide(qn, 'G1', { outcomeKey: 'advance' }, 'sales-leader'));
  ok(
    await persona('eng-lead').put(`/api/v1/quotes/${qn}/eng-review`, {
      processType: 'EBM',
      machineType: 'EBM',
      plantCode: 'AURORA',
      cavitation: 8,
      cycleTimeS: 14.5,
      prelimCapitalUsd: 0,
      toolingNotes: 'Reuse the mold base',
    }),
    200,
  );
  ok(
    await persona('eng-lead').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
      rows: [
        {
          site: 'AURORA',
          assumedEffectivenessPct: 70,
          cycleTimeS: 14.5,
          utilizationBeforePct: 62,
          analysisDate: '2026-10-26',
          analystId: await userId('engineer'),
        },
      ],
    }),
    200,
  );
  ok(
    await persona('eng-lead').put(`/api/v1/quotes/${qn}/capacity-signoff`, { status: 'approved' }),
    200,
  );
  ok(await decide(qn, 'G2', { outcomeKey: 'proceed' }, 'eng-lead'));
  tick();
  await prepareModels(app, qn);
  ok(
    await persona('pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
      approvedBy: await userId('pricing'),
      approvedAt: new Date(clock.getTime() - HOUR).toISOString(),
      erfRefs: ['ERF26-213'],
      costingCompleted: true,
    }),
    200,
  );
  ok(
    await persona('pricing').put(`/api/v1/quotes/${qn}/capital-readiness`, {
      capitalReadiness: 'pre_approved',
    }),
    200,
  );
  ok(await decide(qn, 'G3', { outcomeKey: 'submit' }, 'pricing-lead'));
  tick();
  ok(
    await persona('kam').put(`/api/v1/quotes/${qn}/terms`, {
      termsPaymentTermsCode: 'NET_30',
      termsToolingCommitment: false,
      checked: true,
    }),
    200,
  );
  await confirmCapitalTerms(app, qn);
  ok(await decide(qn, 'G4', { outcomeKey: 'approve' }, 'approver'));
  tick();
  return qn;
}

const quoteRow = async (qn: string) =>
  (await db.db.select().from(schema.quote).where(eq(schema.quote.quoteNumber, qn)))[0]!;
const outbox = async (qn: string) =>
  db.db
    .select()
    .from(schema.sfWritebackOutbox)
    .where(eq(schema.sfWritebackOutbox.quoteId, (await quoteRow(qn)).id))
    .orderBy(asc(schema.sfWritebackOutbox.createdAt), asc(schema.sfWritebackOutbox.id));
const writebackAudits = async (qn: string) =>
  db.db
    .select()
    .from(schema.auditEvent)
    .where(
      and(
        eq(schema.auditEvent.quoteId, (await quoteRow(qn)).id),
        eq(schema.auditEvent.entity, 'sf_writeback'),
      ),
    )
    .orderBy(asc(schema.auditEvent.at), asc(schema.auditEvent.id));
const callsFor = (opp: string) => writer.calls.filter((c) => c.sfOpportunityId === opp);
const lapse = async (qn: string) => {
  const until = (await quoteRow(qn)).validityUntil!;
  clock = new Date(`${addCalendarDays(until, 1)}T18:00:00Z`);
};
const lost = (qn: string) => decide(qn, 'G5', { outcomeKey: 'lost', reasonCode: 'price' }, 'kam');
const expired = (qn: string) =>
  decide(qn, 'G5', { outcomeKey: 'expired', reasonCode: 'no_response' }, 'kam');
const requote = (qn: string, body: Record<string, unknown>) =>
  persona('kam').post(`/api/v1/quotes/${qn}/requote`, body);
const run = () => app.sfWriteback!.runNow();

const setSetting = (key: string, value: unknown) =>
  db.db.execute(
    sql`update app_setting set value = ${JSON.stringify(value)}::jsonb where key = ${key}`,
  );
const switchTo = async (enabled: boolean, mode: 'dry_run' | 'live' = 'live') => {
  await setSetting('sf_writeback_enabled', enabled);
  await setSetting('sf_writeback_mode', mode);
};

beforeAll(async () => {
  const fresh = await freshSfDatabase('fb29_writeback');
  db = fresh.client;
  url = fresh.url;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url, RATE_LIMIT_MAX: '100000' }), {
    db,
    now: () => clock,
    salesforceWriter: writer,
  });
  await app.ready();
  for (const key of ['kam', 'sales-leader', 'eng-lead', 'engineer', 'pricing', 'admin']) {
    await userId(key);
  }
}, 120_000);
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  writer.reset();
  // Each test starts with an empty outbox (an opportunity may be reused once its quotes are closed).
  await db.db.execute(sql`delete from sf_writeback_outbox`);
  await switchTo(false, 'dry_run');
  await setSetting('sf_writeback_map', SF_WRITEBACK_MAP_SEED);
  await setSetting('sf_writeback_stage_regression', 'skip');
  await setSetting('sf_writeback_max_attempts', 5);
  await setSetting('sf_writeback_retry_minutes', [1, 5, 30, 120, 360]);
});

describe('switched off, dry run and live', () => {
  it('migration and seed: the six settings are provisional and off', async () => {
    const rows = await db.db.execute<{ key: string; value: unknown; provisional: boolean }>(sql`
      select key, value, provisional from app_setting where key like 'sf_writeback_%' order by key`);
    expect([...rows].map((r) => r.key)).toEqual([
      'sf_writeback_enabled',
      'sf_writeback_map',
      'sf_writeback_max_attempts',
      'sf_writeback_mode',
      'sf_writeback_retry_minutes',
      'sf_writeback_stage_regression',
    ]);
    expect([...rows].every((r) => r.provisional)).toBe(true);
  });

  it('off: a customer outcome queues nothing, and the KAM is still asked to update Salesforce', async () => {
    const qn = await inCustomerDecision();
    ok(await lost(qn));
    expect(await outbox(qn)).toEqual([]);
    await run();
    expect(writer.calls).toEqual([]);
    const detail = QuoteDetail.parse((await persona('kam').get(`/api/v1/quotes/${qn}`)).json());
    expect(detail.customerDecision.sfWriteback).toEqual({ on: false, latest: null });
  });

  it('dry run: the row is recorded as dry_run and the writer is never called', async () => {
    await switchTo(true, 'dry_run');
    const qn = await inCustomerDecision();
    ok(await lost(qn));
    const rows = await outbox(qn);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event: 'outcome_recorded',
      sfObject: 'Opportunity',
      sfField: 'StageName',
      value: 'Closed Lost',
      status: 'dry_run',
      closing: true,
      nextAttemptAt: null,
    });
    expect(JSON.parse(rows[0]!.payload)).toEqual({
      object: 'Opportunity',
      id: (await quoteRow(qn)).sfOpportunityId,
      fields: { StageName: 'Closed Lost' },
    });
    await run();
    expect(writer.calls).toEqual([]);
    expect(writer.stageReads).toEqual([]);
    const audit = await writebackAudits(qn);
    expect(audit.map((a) => [a.action, (a.after as { status?: string }).status])).toEqual([
      ['create', 'dry_run'],
    ]);
  });

  it('live with the fake writer: queued in the decision, sent by the worker, audited; the reminder says so', async () => {
    await switchTo(true, 'live');
    const qn = await inCustomerDecision();
    const opp = (await quoteRow(qn)).sfOpportunityId;
    writer.setStage(opp, 'Negotiating');
    ok(await lost(qn));
    expect((await outbox(qn)).map((r) => r.status)).toEqual(['pending']);
    let detail = QuoteDetail.parse((await persona('kam').get(`/api/v1/quotes/${qn}`)).json());
    expect(detail.customerDecision.sfWriteback).toMatchObject({
      on: true,
      latest: { status: 'pending', value: 'Closed Lost' },
    });

    const result = await run();
    expect(result).toMatchObject({ outcome: 'succeeded', sent: 1 });
    expect(callsFor(opp).map((c) => c.fields)).toEqual([{ StageName: 'Closed Lost' }]);
    expect(writer.stageOf(opp)).toBe('Closed Lost');
    const [row] = await outbox(qn);
    expect(row).toMatchObject({ status: 'sent', attempts: 1, lastError: null });
    expect(row!.sentAt?.getTime()).toBe(clock.getTime());
    detail = QuoteDetail.parse((await persona('kam').get(`/api/v1/quotes/${qn}`)).json());
    expect(detail.customerDecision.sfWriteback?.latest?.status).toBe('sent');

    const audit = await writebackAudits(qn);
    expect(audit.map((a) => [a.action, (a.after as { status?: string }).status])).toEqual([
      ['create', 'pending'],
      ['update', 'sent'],
    ]);
    expect(audit[1]!.actorId).toBeNull();
    // Nothing secret: field names, values and ids only.
    expect(JSON.stringify(audit)).not.toMatch(/token|secret|password/i);
  });

  it('a regression is skipped: Salesforce already shows Closed Won', async () => {
    await switchTo(true, 'live');
    const qn = await inCustomerDecision();
    const opp = (await quoteRow(qn)).sfOpportunityId;
    writer.setStage(opp, 'Closed Won - Product Shipping');
    ok(await lost(qn));
    await run();
    expect(callsFor(opp)).toEqual([]);
    expect(await outbox(qn)).toMatchObject([{ status: 'skipped', skippedReason: 'regression' }]);
  });
});

describe('failures', () => {
  it('a failing writer retries with backoff, then fails and tells every Admin once', async () => {
    await switchTo(true, 'live');
    await setSetting('sf_writeback_max_attempts', 3);
    const qn = await inCustomerDecision();
    const opp = (await quoteRow(qn)).sfOpportunityId;
    ok(await lost(qn));
    writer.failNext(
      { kind: 'error', retryable: true, code: 'SERVER_UNAVAILABLE', message: 'busy' },
      { kind: 'error', retryable: true, code: 'SERVER_UNAVAILABLE', message: 'busy' },
      { kind: 'error', retryable: true, code: 'SERVER_UNAVAILABLE', message: 'busy' },
    );
    expect(await run()).toMatchObject({ retrying: 1 });
    let [row] = await outbox(qn);
    expect(row).toMatchObject({ status: 'pending', attempts: 1 });
    expect(row!.nextAttemptAt!.getTime()).toBe(clock.getTime() + MINUTE);
    // Not due yet: nothing happens.
    expect(await run()).toMatchObject({ retrying: 0, failed: 0 });
    tick(MINUTE);
    expect(await run()).toMatchObject({ retrying: 1 });
    tick(5 * MINUTE);
    expect(await run()).toMatchObject({ failed: 1 });
    [row] = await outbox(qn);
    expect(row).toMatchObject({ status: 'failed', attempts: 3 });
    expect(row!.lastError).toMatch(/^SERVER_UNAVAILABLE/);
    expect(callsFor(opp)).toHaveLength(3);

    const admins = await db.db.execute<{ id: string }>(sql`
      select u.id from app_user u join user_role r on r.user_id = u.id
      where r.role = 'Admin' and u.active`);
    const notices = async () =>
      db.db
        .select()
        .from(schema.notification)
        .where(
          and(
            eq(schema.notification.type, 'sf_writeback.failed'),
            eq(schema.notification.dedupeKey, `sf_writeback:${row!.id}`),
          ),
        );
    expect((await notices()).map((n) => n.userId).sort()).toEqual(
      [...new Set([...admins].map((a) => a.id))].sort(),
    );
    await run();
    expect(await notices()).toHaveLength([...new Set([...admins].map((a) => a.id))].length);

    // Admin: retry (audited), it is sent; a second failure is skipped by the Admin (audited).
    const retry = await persona('admin').post(`/api/v1/admin/salesforce/writeback/${row!.id}/retry`);
    ok(retry, 200);
    expect(SfWritebackRow.parse(retry.json())).toMatchObject({ status: 'pending', attempts: 0 });
    await run();
    expect((await outbox(qn))[0]).toMatchObject({ status: 'sent' });
    const audit = await writebackAudits(qn);
    expect(audit.some((a) => (a.after as { by?: string }).by === 'admin_retry')).toBe(true);
    expect(audit.find((a) => (a.after as { by?: string }).by === 'admin_retry')!.actorId).toBe(
      await userId('admin'),
    );
    // Only a failed (or pending) row can be retried or skipped.
    const again = await persona('admin').post(`/api/v1/admin/salesforce/writeback/${row!.id}/retry`);
    expect(again.statusCode, again.body).toBe(409);
  });

  it('a refused save (a validation rule) fails at once; the Admin skips it', async () => {
    await switchTo(true, 'live');
    const qn = await inCustomerDecision();
    ok(await lost(qn));
    writer.failNext({
      kind: 'error',
      retryable: false,
      code: 'FIELD_CUSTOM_VALIDATION_EXCEPTION',
      message: 'A loss reason is required',
    });
    expect(await run()).toMatchObject({ failed: 1 });
    const [row] = await outbox(qn);
    expect(row).toMatchObject({ status: 'failed', attempts: 1 });
    const skip = await persona('admin').post(`/api/v1/admin/salesforce/writeback/${row!.id}/skip`);
    ok(skip, 200);
    expect(SfWritebackRow.parse(skip.json())).toMatchObject({
      status: 'skipped',
      skippedReason: 'admin_skip',
    });
    const audit = await writebackAudits(qn);
    expect(audit.at(-1)).toMatchObject({ action: 'update', actorId: await userId('admin') });
    expect((audit.at(-1)!.after as { by: string }).by).toBe('admin_skip');
  });

  it('an invalid map skips and audits, and the decision still succeeds', async () => {
    const qn = await inCustomerDecision();
    await switchTo(true, 'live');
    await setSetting('sf_writeback_map', {
      ...SF_WRITEBACK_MAP_SEED,
      entries: SF_WRITEBACK_MAP_SEED.entries.map((e) =>
        e.event === 'outcome_recorded' ? { ...e, sfField: 'Not_Allowed__c' } : e,
      ),
    });
    ok(await lost(qn));
    expect((await quoteRow(qn)).status).toBe('closed');
    expect(await outbox(qn)).toEqual([]);
    const audit = await writebackAudits(qn);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after).toMatchObject({ queued: false, reason: 'invalid_config' });
  });
});

describe('the decision’s transaction', () => {
  const service = () =>
    new SfWritebackService({
      allowList: SF_WRITE_ALLOW_LIST,
      writerMode: 'fake',
      liveBlockedReason: null,
      appBaseUrl: 'http://localhost:5173',
    });
  const admin = async (): Promise<Actor> => ({
    userId: asUserId(await userId('admin')),
    roles: ['Admin'],
    scope: { type: 'all' },
  });

  it('the same event twice makes one row, and a rolled-back decision leaves none', async () => {
    await switchTo(true, 'live');
    const qn = await inCustomerDecision();
    ok(await lost(qn));
    const q = await quoteRow(qn);
    const ctx = {
      quote: { id: q.id, quoteNumber: qn, sfOpportunityId: q.sfOpportunityId },
      gateKey: 'G5',
      gateStageKey: 'CUSTOMER_DECISION',
      outcomeKey: 'lost',
      enteredStageKey: 'CLOSED_LOST',
      actor: await admin(),
      meta: {},
      at: clock,
    };
    await withSystemContext(db.db, (tx) => service().onGateDecision(tx, ctx));
    await withSystemContext(db.db, (tx) => service().onGateDecision(tx, ctx));
    expect(await outbox(qn)).toHaveLength(1);

    // A second (fake) decision that rolls back: its row goes with it.
    class Rollback extends Error {}
    await withSystemContext(db.db, async (tx) => {
      await tx.insert(schema.gateDecision).values({
        quoteId: q.id,
        gateKey: 'G5',
        outcomeKey: 'lost',
        decidedBy: ctx.actor.userId,
        decidedAt: clock,
        quoteVersion: q.version,
        evidence: {},
        payload: {},
      });
      await service().onGateDecision(tx, ctx);
      expect(await tx.select().from(schema.sfWritebackOutbox).where(eq(schema.sfWritebackOutbox.quoteId, q.id))).toHaveLength(2);
      throw new Rollback();
    }).catch((err: unknown) => {
      if (!(err instanceof Rollback)) throw err;
    });
    expect(await outbox(qn)).toHaveLength(1);
  });
});

describe('never close an opportunity another quote needs; reopen what QuoteFlow closed', () => {
  it('an expiry with no other quote on the opportunity queues the closing write', async () => {
    await switchTo(true, 'live');
    const qn = await inCustomerDecision();
    await lapse(qn);
    ok(await expired(qn));
    expect(await outbox(qn)).toMatchObject([
      { event: 'outcome_recorded', value: 'Closed Lost', closing: true, status: 'pending' },
    ]);
  });

  it('a loss while another active quote is linked to the same opportunity is skipped (other_active_quote)', async () => {
    await switchTo(true, 'live');
    const first = await inCustomerDecision();
    const second = await inCustomerDecision();
    const opp = (await quoteRow(first)).sfOpportunityId;
    // Two active quotes on one opportunity (FB-19 allows it when opportunity_active_quotes = warn).
    await db.db.execute(
      sql`update quote set sf_opportunity_id = ${opp} where quote_number = ${second}`,
    );
    ok(await lost(first));
    expect(await outbox(first)).toMatchObject([
      { status: 'skipped', skippedReason: 'other_active_quote', closing: true },
    ]);
    // The last quote on the opportunity: its loss does close it.
    ok(await lost(second));
    expect(await outbox(second)).toMatchObject([{ status: 'pending', closing: true }]);
    await run();
    expect(callsFor(opp).map((c) => c.fields)).toEqual([{ StageName: 'Closed Lost' }]);
  });

  it('a linked re-quote of an expired quote enqueues no closing write; nothing is written', async () => {
    await switchTo(true, 'live');
    const qn = await inCustomerDecision();
    const opp = (await quoteRow(qn)).sfOpportunityId;
    await lapse(qn);
    ok(await requote(qn, { note: 'Customer still wants it', reasonCode: 'validity_lapsed' }), 200);
    expect((await quoteRow(qn)).status).toBe('closed');
    expect(
      (await outbox(qn)).map((r) => [r.event, r.status, r.skippedReason]),
    ).toEqual([
      ['outcome_recorded', 'skipped', 'other_active_quote'],
      ['requote_started', 'skipped', 'nothing_to_reopen'],
    ]);
    await run();
    expect(callsFor(opp)).toEqual([]);
  });

  it('a re-quote started while the closing write is still pending supersedes it: nothing is written', async () => {
    await switchTo(true, 'live');
    const qn = await inCustomerDecision();
    const opp = (await quoteRow(qn)).sfOpportunityId;
    await lapse(qn);
    ok(await expired(qn));
    ok(await requote(qn, { note: 'Try again' }), 200);
    expect((await outbox(qn)).map((r) => [r.event, r.status, r.skippedReason])).toEqual([
      ['outcome_recorded', 'skipped', 'other_active_quote'],
      ['requote_started', 'skipped', 'nothing_to_reopen'],
    ]);
    await run();
    expect(callsFor(opp)).toEqual([]);
  });

  it('a re-quote after the closing write was sent reopens the opportunity (exempt from the regression skip)', async () => {
    await switchTo(true, 'live');
    const qn = await inCustomerDecision();
    const opp = (await quoteRow(qn)).sfOpportunityId;
    writer.setStage(opp, 'Negotiating');
    await lapse(qn);
    ok(await expired(qn));
    await run();
    expect(writer.stageOf(opp)).toBe('Closed Lost');
    ok(await requote(qn, { note: 'Customer came back' }), 200);
    const reopen = (await outbox(qn)).at(-1)!;
    expect(reopen).toMatchObject({ event: 'requote_started', value: 'Quoting', reopens: true, status: 'pending' });
    await run();
    expect(writer.stageOf(opp)).toBe('Quoting');
    expect((await outbox(qn)).at(-1)).toMatchObject({ status: 'sent' });
  });

  it('a closing write that timed out but reached Salesforce ends sent on retry; a later re-quote reopens', async () => {
    await switchTo(true, 'live');
    const qn = await inCustomerDecision();
    const opp = (await quoteRow(qn)).sfOpportunityId;
    writer.setStage(opp, 'Negotiating');
    await lapse(qn);
    ok(await expired(qn));
    writer.failNext({ kind: 'timeout' });
    expect(await run()).toMatchObject({ retrying: 1 });
    expect(writer.stageOf(opp)).toBe('Closed Lost');
    tick(MINUTE);
    expect(await run()).toMatchObject({ confirmed: 1, sent: 0 });
    const [closing] = await outbox(qn);
    expect(closing).toMatchObject({ status: 'sent', skippedReason: null });
    expect(JSON.parse(closing!.response!)).toMatchObject({ confirmedExisting: true });
    const audit = await writebackAudits(qn);
    expect(audit.some((a) => (a.after as { confirmed_existing?: boolean }).confirmed_existing)).toBe(
      true,
    );
    expect(callsFor(opp)).toHaveLength(1);

    // The reopen: its own first attempt times out too, and its retry finds "Quoting": sent.
    ok(await requote(qn, { note: 'Back on' }), 200);
    writer.failNext({ kind: 'timeout' });
    expect(await run()).toMatchObject({ retrying: 1 });
    tick(MINUTE);
    expect(await run()).toMatchObject({ confirmed: 1 });
    expect((await outbox(qn)).at(-1)).toMatchObject({ event: 'requote_started', status: 'sent' });
    expect(writer.stageOf(opp)).toBe('Quoting');
  });

  it('a reopen is skipped (moved_in_salesforce, audited) when a sales person has moved the opportunity on', async () => {
    await switchTo(true, 'live');
    const qn = await inCustomerDecision();
    const opp = (await quoteRow(qn)).sfOpportunityId;
    await lapse(qn);
    ok(await expired(qn));
    await run();
    writer.setStage(opp, 'Negotiating');
    ok(await requote(qn, { note: 'Back on' }), 200);
    await run();
    expect((await outbox(qn)).at(-1)).toMatchObject({
      event: 'requote_started',
      status: 'skipped',
      skippedReason: 'moved_in_salesforce',
    });
    expect(writer.stageOf(opp)).toBe('Negotiating');
    const audit = await writebackAudits(qn);
    expect(audit.at(-1)!.after).toMatchObject({
      status: 'skipped',
      skippedReason: 'moved_in_salesforce',
      salesforceStage: 'Negotiating',
    });
  });
});

describe('the Salesforce status flag', () => {
  it('does not flag closed_lost on a quote QuoteFlow closed as lost', async () => {
    const qn = await inCustomerDecision();
    ok(await lost(qn));
    const opp = (await quoteRow(qn)).sfOpportunityId;
    await db.db.execute(sql`
      update sf_opportunity_snapshot set is_closed = true, is_won = false, sf_stage = 'Closed Lost'
      where sf_opportunity_id = ${opp}`);
    await withSystemContext(db.db, (tx) => refreshQuoteSfStatusFlags(tx, clock));
    expect((await quoteRow(qn)).sfStatusFlag).toBeNull();
    // An open quote on a closed-lost opportunity is still flagged.
    const open = await inCustomerDecision();
    const openOpp = (await quoteRow(open)).sfOpportunityId;
    await db.db.execute(sql`
      update sf_opportunity_snapshot set is_closed = true, is_won = false, sf_stage = 'Closed Lost'
      where sf_opportunity_id = ${openOpp}`);
    await withSystemContext(db.db, (tx) => refreshQuoteSfStatusFlags(tx, clock));
    expect((await quoteRow(open)).sfStatusFlag).toBe('closed_lost');
  });
});

describe('Admin → Integrations', () => {
  it('shows the switch, why nothing is written, counts and rows; switches to dry run and live', async () => {
    let res = await persona('admin').get('/api/v1/admin/salesforce/writeback');
    ok(res, 200);
    let s = SfWritebackSummary.parse(res.json());
    expect(s).toMatchObject({ enabled: false, mode: 'dry_run', writerMode: 'fake', sending: false, canManage: true });
    expect(s.statusText).toMatch(/switched off/);

    res = await persona('admin').put('/api/v1/admin/salesforce/writeback', {
      enabled: true,
      mode: 'dry_run',
      changeReason: 'Dry run on test',
    });
    ok(res, 200);
    s = SfWritebackSummary.parse(res.json());
    expect(s).toMatchObject({ enabled: true, mode: 'dry_run', sending: false });
    expect(s.statusText).toMatch(/Dry run/);
    res = await persona('admin').put('/api/v1/admin/salesforce/writeback', { mode: 'live' });
    ok(res, 200);
    expect(SfWritebackSummary.parse(res.json())).toMatchObject({ sending: true });
    const changes = await db.db
      .select()
      .from(schema.auditEvent)
      .where(and(eq(schema.auditEvent.entity, 'sf_writeback'), eq(schema.auditEvent.action, 'config_change')));
    // The switch on, then live (the mode was already dry_run: no change, no row).
    expect(changes.map((c) => (c.after as { key: string }).key)).toEqual([
      'sf_writeback_enabled',
      'sf_writeback_mode',
    ]);

    // Leadership reads; it cannot switch.
    res = await persona('leadership').get('/api/v1/admin/salesforce/writeback');
    ok(res, 200);
    expect(SfWritebackSummary.parse(res.json()).canManage).toBe(false);
    expect((await persona('leadership').put('/api/v1/admin/salesforce/writeback', { enabled: false })).statusCode).toBe(403);
  });

  it('previews a quote without queuing anything', async () => {
    await switchTo(false);
    const qn = await inCustomerDecision();
    ok(await lost(qn));
    const res = await persona('admin').get(`/api/v1/admin/salesforce/writeback/preview?quoteNumber=${qn}`);
    ok(res, 200);
    const p = SfWritebackPreview.parse(res.json());
    expect(p.writes).toMatchObject([
      { event: 'outcome_recorded', sfField: 'StageName', value: 'Closed Lost', closing: true },
    ]);
    expect(p.notes.join(' ')).toMatch(/switched off/);
    expect(await outbox(qn)).toEqual([]);
    const missing = await persona('admin').get('/api/v1/admin/salesforce/writeback/preview?quoteNumber=CCQ-2099-99999');
    expect(missing.statusCode).toBe(404);
  });

  it('refuses live, with the reason, where there is no write connection (here and in the settings console)', async () => {
    const other = createDb(url);
    const noWriter = await buildApp(testConfig({ DATABASE_URL: url, RATE_LIMIT_MAX: '100000' }), {
      db: other,
      now: () => clock,
      salesforceWriter: null,
    });
    await noWriter.ready();
    try {
      const as = { [DEV_USER_HEADER]: 'admin' };
      const res = await noWriter.inject({
        method: 'PUT',
        url: '/api/v1/admin/salesforce/writeback',
        headers: as,
        payload: { mode: 'live' },
      });
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json()).toMatchObject({ code: 'live_not_allowed' });
      expect((res.json() as { detail: string }).detail).toMatch(/no Salesforce write connection/);
      const summary = SfWritebackSummary.parse(
        (await noWriter.inject({ method: 'GET', url: '/api/v1/admin/salesforce/writeback', headers: as })).json(),
      );
      expect(summary).toMatchObject({ liveAllowed: false, writerMode: 'off' });
      const [setting] = await db.db
        .select()
        .from(schema.appSetting)
        .where(eq(schema.appSetting.key, 'sf_writeback_mode'));
      const console = await noWriter.inject({
        method: 'PATCH',
        url: '/api/v1/admin/config/settings/sf_writeback_mode',
        headers: as,
        payload: { value: 'live', version: setting!.version, changeReason: 'Trying live on test' },
      });
      expect(console.statusCode, console.body).toBe(422);
    } finally {
      await noWriter.close();
    }
  });
});
