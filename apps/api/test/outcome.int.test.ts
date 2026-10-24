import { DEV_USER_HEADER } from '@ccq/contracts';
import {
  GateDecisionResponse,
  HandoffResponse,
  IntakeDraft,
  MeResponse,
  MyProposalsResponse,
  OutcomesReport,
  QuoteDetail,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import { addCalendarDays, proposalCalendarDate } from '@ccq/domain';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * B-13 customer decision (CR-37/38/39/40/41): the Customer Decision header (validity countdown, SF stage
 * side by side), "My open proposals", every G5 outcome through the generic gate route, the closure rule
 * on every terminal path, the daily expiry job (flags, never closes), the Awarded hand-off record and
 * the outcomes report (Expired is not Lost).
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-10-30T15:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const tick = (ms = HOUR) => {
  clock = new Date(clock.getTime() + ms);
};

const created: string[] = [];
/** An open SF opportunity with no open CCQ quote (a closed quote frees its opportunity), else recycle one. */
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
  const send = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: { [DEV_USER_HEADER]: key },
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  return {
    get: (url: string) => send('GET', url),
    post: (url: string, body?: unknown) => send('POST', url, body),
    put: (url: string, body?: unknown) => send('PUT', url, body),
  };
};
const ids: Record<string, string> = {};
async function userId(key: string): Promise<string> {
  ids[key] ??= MeResponse.parse((await persona(key).get('/api/v1/me')).json()).user.id;
  return ids[key];
}

const decide = (qn: string, gate: string, body: Record<string, unknown>, by: string) =>
  persona(by).post(`/api/v1/quotes/${qn}/gates/${gate}/decisions`, body);
const g5 = (qn: string, body: Record<string, unknown>, by = 'kam') => decide(qn, 'G5', body, by);
const ok = (res: { statusCode: number; body: string }, status = 201) =>
  expect(res.statusCode, res.body).toBe(status);
const errorCodes = (res: { json: () => unknown }) =>
  ((res.json() as { errors?: { code: string }[] }).errors ?? []).map((e) => e.code).sort();
const errorPaths = (res: { json: () => unknown }) =>
  ((res.json() as { errors?: { path: string }[] }).errors ?? []).map((e) => e.path).sort();
const today = () => proposalCalendarDate(clock);

async function prefill(sfOpportunityId: string, over: IntakeDraftData = {}) {
  const sf = SfOpportunityDetail.parse(
    (await persona('kam').get(`/api/v1/salesforce/opportunities/${sfOpportunityId}`)).json(),
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

/** A quote at Intake, submitted by the KAM. */
async function submitted() {
  const res = await persona('kam').post('/api/v1/quotes/drafts', {
    data: await prefill(await nextFree()),
  });
  ok(res);
  const sub = await persona('kam').post(
    `/api/v1/quotes/drafts/${IntakeDraft.parse(res.json()).id}/submit`,
  );
  ok(sub);
  const { quoteNumber: qn } = SubmitIntakeResponse.parse(sub.json());
  created.push(qn);
  return qn;
}

/** Into Engineering (G1 advanced) with a complete review. */
async function inEngineering() {
  const qn = await submitted();
  ok(await decide(qn, 'G1', { outcomeKey: 'advance' }, 'sales-leader'));
  ok(
    await persona('eng-lead').put(`/api/v1/quotes/${qn}/eng-review`, {
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
    await persona('eng-lead').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
      rows: [
        {
          site: 'PLANT_01',
          assumedEffectivenessPct: 70,
          cycleTimeS: 14.5,
          utilizationPct: 62,
          analysisDate: '2026-10-26',
          analystId: await userId('engineer'),
        },
      ],
    }),
    200,
  );
  // B-26: the capacity owner's sign-off before G2.
  ok(
    await persona('eng-lead').put(`/api/v1/quotes/${qn}/capacity-signoff`, { status: 'approved' }),
    200,
  );
  return qn;
}

/** Into Quoting with the price approval recorded. */
async function inQuoting() {
  const qn = await inEngineering();
  ok(await decide(qn, 'G2', { outcomeKey: 'proceed' }, 'eng-lead'));
  tick();
  await recordPrice(qn);
  return qn;
}

async function recordPrice(qn: string) {
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
}

/** Into Final Review. */
async function inFinalReview() {
  const qn = await inQuoting();
  ok(await decide(qn, 'G3', { outcomeKey: 'submit' }, 'pricing'));
  tick();
  return qn;
}

/** Released by Final Review: waiting for the customer, validity = today + 30 (D-12 seed). */
async function inCustomerDecision() {
  const qn = await inFinalReview();
  // B-26: the KAM checks the terms before the offer is released.
  ok(
    await persona('kam').put(`/api/v1/quotes/${qn}/terms`, {
      termsPaymentTerms: 'Net 45',
      termsToolingCommitment: false,
      checked: true,
    }),
    200,
  );
  ok(await decide(qn, 'G4', { outcomeKey: 'approve' }, 'approver'));
  tick();
  return qn;
}

/** B-26: awarded by the customer (G5), now in Commit & Hand Off. */
async function inCommit(evidence = 'loi') {
  const qn = await inCustomerDecision();
  ok(await g5(qn, { outcomeKey: 'awarded', reasonCode: evidence, acceptedAt: today() }));
  tick();
  return qn;
}

/** B-26: the CER is not required and the receiving team accepted the hand-off (G6 can close Won). */
async function committed(evidence = 'loi') {
  const qn = await inCommit(evidence);
  ok(
    await persona('kam').put(`/api/v1/quotes/${qn}/handoff`, {
      cerStatus: 'not_required',
      receivingRole: 'commercial_activation',
      receivingContactName: 'Pat Doe',
      acceptedOn: today(),
      complete: true,
    }),
    200,
  );
  return qn;
}

const quoteRow = async (qn: string) =>
  (await db.db.select().from(schema.quote).where(eq(schema.quote.quoteNumber, qn)))[0]!;
async function detail(qn: string, by = 'kam') {
  const res = await persona(by).get(`/api/v1/quotes/${qn}`);
  expect(res.statusCode, res.body).toBe(200);
  return QuoteDetail.parse(res.json());
}
const decisions = async (qn: string, gateKey?: string) =>
  db.db
    .select()
    .from(schema.gateDecision)
    .where(
      gateKey
        ? and(
            eq(schema.gateDecision.quoteId, (await quoteRow(qn)).id),
            eq(schema.gateDecision.gateKey, gateKey),
          )
        : eq(schema.gateDecision.quoteId, (await quoteRow(qn)).id),
    )
    .orderBy(asc(schema.gateDecision.decidedAt));
const events = async (qn: string, type: string) =>
  db.db
    .select()
    .from(schema.activityEvent)
    .where(
      and(
        eq(schema.activityEvent.quoteId, (await quoteRow(qn)).id),
        eq(schema.activityEvent.type, type),
      ),
    );
const notifications = async (qn: string, type: string) =>
  db.db
    .select()
    .from(schema.notification)
    .where(
      and(
        eq(schema.notification.quoteId, (await quoteRow(qn)).id),
        eq(schema.notification.type, type),
        eq(schema.notification.channel, 'in_app'),
      ),
    )
    .orderBy(desc(schema.notification.createdAt));
const handoffRow = async (qn: string) =>
  (
    await db.db
      .select()
      .from(schema.handoffRecord)
      .where(eq(schema.handoffRecord.quoteId, (await quoteRow(qn)).id))
  )[0];
const setSfStage = async (qn: string, stage: string) =>
  db.db.execute(sql`
    update sf_opportunity_snapshot set sf_stage = ${stage}
    where sf_opportunity_id = (select sf_opportunity_id from quote where quote_number = ${qn})`);
async function proposals(by = 'kam') {
  const res = await persona(by).get('/api/v1/quotes/mine/proposals');
  expect(res.statusCode, res.body).toBe(200);
  return MyProposalsResponse.parse(res.json());
}
async function report(by = 'admin') {
  const res = await persona(by).get('/api/v1/admin/reports/outcomes');
  expect(res.statusCode, res.body).toBe(200);
  return OutcomesReport.parse(res.json());
}

/** Closure columns of a closed quote. */
async function closure(qn: string) {
  const r = await quoteRow(qn);
  return {
    stageKey: r.stageKey,
    status: r.status,
    outcome: r.outcome,
    outcomeReasonCode: r.outcomeReasonCode,
    closureOwnerId: r.closureOwnerId,
    closedAt: r.closedAt?.toISOString() ?? null,
  };
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('outcome');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url, RATE_LIMIT_MAX: '100000' }), {
    db,
    now: () => clock,
  });
  await app.ready();

  for (const key of [
    'kam',
    'kam-owner',
    'sales-leader',
    'eng-lead',
    'engineer',
    'pricing',
    'approver',
  ]) {
    await userId(key);
  }
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('the Customer Decision header', () => {
  it('shows the proposal date and a validity countdown on a frozen clock (amber ≤ 7 days, red once expired)', async () => {
    const qn = await inCustomerDecision();
    const issued = (await quoteRow(qn)).proposalIssuedAt!;
    const until = addCalendarDays(proposalCalendarDate(issued), 30);
    let cd = (await detail(qn)).customerDecision;
    expect(cd).toMatchObject({
      proposalIssuedAt: issued.toISOString(),
      validity: { validityUntil: until, daysLeft: 30, state: 'valid', warningDays: 7 },
      validityExpiredFlaggedAt: null,
      closure: null,
      handoff: null,
      canEditHandoff: false,
    });

    const saved = clock;
    clock = new Date(issued.getTime() + 23 * DAY);
    cd = (await detail(qn)).customerDecision;
    expect(cd.validity).toMatchObject({ daysLeft: 7, state: 'expiring' });
    clock = new Date(issued.getTime() + 31 * DAY);
    cd = (await detail(qn)).customerDecision;
    expect(cd.validity).toMatchObject({ daysLeft: -1, state: 'expired' });
    clock = saved;
  });

  it('the warning window is config (validity_warning_days)', async () => {
    const qn = await inCustomerDecision();
    await db.db.execute(
      sql`update app_setting set value = '40'::jsonb where key = 'validity_warning_days'`,
    );
    try {
      expect((await detail(qn)).customerDecision.validity).toMatchObject({
        state: 'expiring',
        warningDays: 40,
      });
    } finally {
      await db.db.execute(
        sql`update app_setting set value = '7'::jsonb where key = 'validity_warning_days'`,
      );
    }
  });

  it('shows the SF stage side by side and flags CCQ Customer Decision vs SF Closed Won', async () => {
    const qn = await inCustomerDecision();
    await setSfStage(qn, 'Negotiating');
    expect((await detail(qn)).customerDecision.sf).toMatchObject({
      sfStage: 'Negotiating',
      ccqStageHint: 'CUSTOMER_DECISION',
      mismatch: false,
    });
    await setSfStage(qn, 'Closed Won - Product Shipping');
    const sf = (await detail(qn)).customerDecision.sf;
    expect(sf).toMatchObject({
      sfStage: 'Closed Won - Product Shipping',
      ccqStageHint: 'AWARDED',
      mismatch: true,
    });
    expect(sf.reason).toContain('Customer Decision');
  });
});

describe('My open proposals (GET /quotes/mine/proposals)', () => {
  it("lists the KAM's quotes waiting for the customer, soonest validity end first", async () => {
    const later = await inCustomerDecision();
    tick(-10 * DAY); // an earlier release: validity ends sooner
    const sooner = await inCustomerDecision();
    tick(10 * DAY);
    const list = await proposals();
    const mine = list.items.map((i) => i.quoteNumber);
    expect(mine).toContain(later);
    expect(mine.indexOf(sooner)).toBeLessThan(mine.indexOf(later));
    const ends = list.items.map((i) => i.validity.validityUntil ?? '9999');
    expect(ends).toEqual([...ends].sort());
    expect(
      list.items.every((i) => i.stageKey === 'CUSTOMER_DECISION' && i.status !== 'closed'),
    ).toBe(true);
    expect(list.items.every((i) => i.kamUserId === ids.kam)).toBe(true);
    expect(list.counts.total).toBe(list.items.length);
    expect(list.items.find((i) => i.quoteNumber === sooner)).toMatchObject({
      validity: { state: 'valid' },
      sf: { mismatch: false },
    });
  });

  it('is only the caller’s own: another KAM does not see them; roles without outcome.record get 403', async () => {
    const qn = await inCustomerDecision();
    expect((await proposals('kam-owner')).items.map((i) => i.quoteNumber)).not.toContain(qn);
    for (const key of ['engineer', 'pricing', 'approver', 'leadership']) {
      expect((await persona(key).get('/api/v1/quotes/mine/proposals')).statusCode).toBe(403);
    }
  });
});

describe('G5 Awarded', () => {
  it('needs the acceptance evidence and date; a future date or a non-http link is refused', async () => {
    const qn = await inCustomerDecision();
    let res = await g5(qn, { outcomeKey: 'awarded' });
    expect(res.statusCode).toBe(422);
    expect(errorCodes(res)).toEqual(['MISSING_FIELD', 'REASON_REQUIRED']);
    res = await g5(qn, {
      outcomeKey: 'awarded',
      reasonCode: 'po',
      acceptedAt: addCalendarDays(today(), 1),
      acceptanceDocumentUrl: 'javascript:alert(1)',
    });
    expect(res.statusCode).toBe(422);
    expect(errorPaths(res)).toEqual(['/acceptanceDocumentUrl', '/acceptedAt']);
    expect((await quoteRow(qn)).status).toBe('active');
  });

  it('→ Commit & Hand Off (B-26: acceptance is not spend authority) and opens the hand-off record', async () => {
    const qn = await inCustomerDecision();
    const res = await g5(qn, {
      outcomeKey: 'awarded',
      reasonCode: 'po',
      acceptedAt: today(),
      acceptanceDocumentUrl: 'https://pretium.sharepoint.example/po-4471.pdf',
      note: 'PO 4471 received',
    });
    ok(res);
    const { quote } = GateDecisionResponse.parse(res.json());
    expect(await closure(qn)).toEqual({
      stageKey: 'COMMIT_HANDOFF',
      status: 'active',
      outcome: null,
      outcomeReasonCode: null,
      closureOwnerId: null,
      closedAt: null,
    });
    expect(quote.customerDecision).toMatchObject({
      closure: null,
      handoff: {
        acceptanceEvidence: 'po',
        acceptanceEvidenceLabel: 'Purchase order (PO)',
        acceptanceDate: today(),
        acceptanceDocumentUrl: 'https://pretium.sharepoint.example/po-4471.pdf',
        cerStatus: 'pending',
        completed: false,
      },
      canEditHandoff: true,
    });
    const [d] = await decisions(qn, 'G5');
    expect(d!.payload).toMatchObject({ accepted_at: today(), validity_lapsed: false });
    expect(d!.evidence).toMatchObject({
      decidedByRoles: ['KAM'],
      customer: { validity: { state: 'valid' } },
    });
    expect(await events(qn, 'quote_closed')).toEqual([]);
    // The KAM's G6 options.
    expect(quote.availableActions.map((a) => `${a.gateKey}/${a.outcomeKey}`)).toEqual([
      'G6/advance',
      'G6/hold',
      'G6/requote',
      'G6/stop',
    ]);
  });

  it('only the KAM (own) or a SalesLeader decides G5', async () => {
    const qn = await inCustomerDecision();
    for (const key of ['eng-lead', 'pricing', 'approver', 'leadership', 'admin']) {
      const res = await g5(qn, { outcomeKey: 'lost', reasonCode: 'price' }, key);
      expect(res.statusCode, key).toBe(403);
    }
    // Another KAM: the quote is not theirs (RLS hides it from an owner-scoped KAM).
    expect([403, 404]).toContain(
      (await g5(qn, { outcomeKey: 'lost', reasonCode: 'price' }, 'kam-owner')).statusCode,
    );
    expect((await quoteRow(qn)).status).toBe('active');
  });
});

describe('G5 Lost', () => {
  it('needs a reason code; "Other" also a note; keeps the competitor; owner defaults to the KAM', async () => {
    const qn = await inCustomerDecision();
    let res = await g5(qn, { outcomeKey: 'lost' }, 'sales-leader');
    expect(errorCodes(res)).toEqual(['REASON_REQUIRED']);
    res = await g5(qn, { outcomeKey: 'lost', reasonCode: 'other' }, 'sales-leader');
    expect(errorCodes(res)).toEqual(['NOTE_REQUIRED']);
    res = await g5(
      qn,
      { outcomeKey: 'lost', reasonCode: 'price', competitor: 'Acme Plastics' },
      'sales-leader',
    );
    ok(res);
    expect(await closure(qn)).toMatchObject({
      stageKey: 'CLOSED_LOST',
      outcome: 'lost',
      outcomeReasonCode: 'price',
      // decided by the SalesLeader, owned by the KAM (D-15: KAM records, sales leader accountable)
      closureOwnerId: ids.kam,
    });
    const { quote } = GateDecisionResponse.parse(res.json());
    expect(quote.customerDecision.closure).toMatchObject({
      reasonLabel: 'Price',
      competitor: 'Acme Plastics',
      decidedByRoles: ['SalesLeader'],
    });
  });

  it('a SalesLeader may name the closure owner; a KAM may not; the owner must be an active user', async () => {
    const qn = await inCustomerDecision();
    let res = await g5(qn, {
      outcomeKey: 'lost',
      reasonCode: 'lead_time',
      closureOwnerId: ids['sales-leader'],
    });
    expect(res.statusCode).toBe(403);
    res = await g5(
      qn,
      {
        outcomeKey: 'lost',
        reasonCode: 'lead_time',
        closureOwnerId: '019a0000-0000-7000-8000-00000000beef',
      },
      'sales-leader',
    );
    expect(res.statusCode).toBe(422);
    expect(errorCodes(res)).toEqual(['INVALID_CLOSURE_OWNER']);
    res = await g5(
      qn,
      { outcomeKey: 'lost', reasonCode: 'lead_time', closureOwnerId: ids['sales-leader'] },
      'sales-leader',
    );
    ok(res);
    expect((await quoteRow(qn)).closureOwnerId).toBe(ids['sales-leader']);
  });
});

describe('G5 No response / Expired: "silence is not a loss"', () => {
  it('before the validity date needs a note; after it, the reason alone; lands in EXPIRED, not CLOSED_LOST', async () => {
    const early = await inCustomerDecision();
    const res = await g5(early, { outcomeKey: 'expired', reasonCode: 'no_response' });
    expect(res.statusCode).toBe(422);
    expect(errorCodes(res)).toEqual(['MISSING_FIELD']);
    const action = (await detail(early)).availableActions.find((a) => a.outcomeKey === 'expired')!;
    expect(action).toMatchObject({ requiresNoteBeforeValidity: true, closesAs: 'expired' });
    ok(
      await g5(early, {
        outcomeKey: 'expired',
        reasonCode: 'no_response',
        note: 'Customer confirmed the project is shelved',
      }),
    );
    expect(await closure(early)).toMatchObject({ stageKey: 'EXPIRED', outcome: 'expired' });

    const lapsed = await inCustomerDecision();
    const saved = clock;
    tick(31 * DAY);
    expect(
      (await detail(lapsed)).availableActions.find((a) => a.outcomeKey === 'expired'),
    ).toMatchObject({ requiresNoteBeforeValidity: false });
    ok(await g5(lapsed, { outcomeKey: 'expired', reasonCode: 'validity_lapsed' }));
    expect(await closure(lapsed)).toMatchObject({
      stageKey: 'EXPIRED',
      outcome: 'expired',
      outcomeReasonCode: 'validity_lapsed',
      closureOwnerId: ids.kam,
    });
    const [d] = await decisions(lapsed, 'G5');
    expect(d!.payload).toMatchObject({ validity_lapsed: true });
    clock = saved;
  });
});

describe('G5 On hold', () => {
  it('needs a reason and a review date; the hold time is excluded from time in stage (CR-57)', async () => {
    const qn = await inCustomerDecision();
    let res = await g5(qn, { outcomeKey: 'on_hold' });
    expect(errorCodes(res)).toEqual(['MISSING_FIELD', 'MISSING_FIELD', 'REASON_REQUIRED']);
    res = await g5(qn, {
      outcomeKey: 'on_hold',
      reasonCode: 'customer_requested_delay',
      holdUntil: addCalendarDays(today(), 14),
      holdOwnerId: await userId('kam'),
    });
    ok(res);
    const row = await quoteRow(qn);
    expect(row).toMatchObject({
      stageKey: 'CUSTOMER_DECISION',
      status: 'on_hold',
      reviewDate: addCalendarDays(today(), 14),
      closedAt: null,
    });
    tick(5 * DAY);
    ok(await g5(qn, { outcomeKey: 'lost', reasonCode: 'customer_cancelled' }));
    const [stay] = await db.db
      .select()
      .from(schema.stageHistory)
      .where(
        and(
          eq(schema.stageHistory.quoteId, row.id),
          eq(schema.stageHistory.stageKey, 'CUSTOMER_DECISION'),
        ),
      );
    expect(stay!.onHoldMs).toBe(5 * DAY);
  });
});

describe('G5 Re-quote (CR-38)', () => {
  it('needs a change reason and a target; bumps the version; prior approvals are kept, marked superseded, never edited', async () => {
    const qn = await inCustomerDecision();
    const before = await decisions(qn);
    let res = await g5(qn, { outcomeKey: 'requote' });
    expect(errorCodes(res)).toEqual(['REASON_REQUIRED', 'TARGET_REQUIRED']);
    res = await g5(qn, { outcomeKey: 'requote', reasonCode: 'other', targetStageKey: 'QUOTING' });
    expect(errorCodes(res)).toEqual(['NOTE_REQUIRED']);
    res = await g5(qn, {
      outcomeKey: 'requote',
      reasonCode: 'volume_change',
      targetStageKey: 'QUOTING',
      note: 'Volume doubled to 1.5M',
    });
    ok(res);
    const { quote } = GateDecisionResponse.parse(res.json());
    expect(quote).toMatchObject({ stageKey: 'QUOTING', status: 'active', version: 2 });

    // Every earlier decision is byte-for-byte what it was, and now shows as superseded.
    const after = await decisions(qn);
    expect(after.slice(0, before.length)).toEqual(before);
    const shown = quote.decisions;
    for (const d of before) {
      expect(shown.find((s) => s.id === d.id)).toMatchObject({ quoteVersion: 1, superseded: true });
    }
    expect(shown.find((s) => s.gateKey === 'G5')).toMatchObject({
      outcomeKey: 'requote',
      reasonCode: 'volume_change',
      quoteVersion: 1,
      superseded: true,
    });
    // The v1 pricing record stays; v2 starts afresh, and Pricing is told it is a re-quote.
    const records = await db.db
      .select()
      .from(schema.pricingRecord)
      .where(eq(schema.pricingRecord.quoteId, quote.id))
      .orderBy(asc(schema.pricingRecord.quoteVersion));
    expect(records.map((r) => [r.quoteVersion, !!r.priceApprovedBy])).toEqual([
      [1, true],
      [2, false],
    ]);
    const [alert] = await notifications(qn, 'quote.ready_for_quoting');
    expect(alert!.body).toContain('re-quote');

    // Released again later, the new proposal gets a fresh validity date.
    await recordPrice(qn);
    ok(await decide(qn, 'G3', { outcomeKey: 'submit' }, 'pricing'));
    ok(await decide(qn, 'G4', { outcomeKey: 'approve' }, 'approver'));
    expect((await detail(qn)).decisions.filter((d) => !d.superseded).map((d) => d.gateKey)).toEqual(
      ['G4', 'G3'],
    );
  });
});

describe('B-26: G6 Commit & Hand Off (deck slide 15)', () => {
  it('closes Won only when the CER is approved or not required and the hand-off is accepted', async () => {
    const qn = await inCommit('po');
    const blocked = await decide(qn, 'G6', { outcomeKey: 'advance', reasonCode: 'po' }, 'kam');
    expect(blocked.statusCode).toBe(422);
    expect(errorPaths(blocked)).toEqual([
      '/handoff_record.cer_status',
      '/handoff_record.completed_at',
    ]);
    const put = (body: Record<string, unknown>) =>
      persona('kam').put(`/api/v1/quotes/${qn}/handoff`, body);
    // An approved CER needs its ID and approval date.
    expect((await put({ cerStatus: 'approved' })).statusCode).toBe(422);
    ok(await put({ cerStatus: 'approved', cerId: 'CER-9001', cerApprovedOn: today() }), 200);
    expect(
      errorPaths(await decide(qn, 'G6', { outcomeKey: 'advance', reasonCode: 'po' }, 'kam')),
    ).toEqual(['/handoff_record.completed_at']);
    ok(
      await put({
        receivingRole: 'commercial_activation',
        receivingContactName: 'Pat Doe',
        acceptedOn: today(),
        complete: true,
      }),
      200,
    );
    for (const key of ['eng-lead', 'pricing', 'approver', 'admin']) {
      expect(
        (await decide(qn, 'G6', { outcomeKey: 'advance', reasonCode: 'po' }, key)).statusCode,
        key,
      ).toBe(403);
    }
    const won = await decide(qn, 'G6', { outcomeKey: 'advance', reasonCode: 'po' }, 'kam');
    ok(won);
    expect(await closure(qn)).toMatchObject({
      stageKey: 'AWARDED',
      status: 'closed',
      outcome: 'awarded',
      closureOwnerId: ids.kam,
    });
    expect(GateDecisionResponse.parse(won.json()).quote.customerDecision.closure).toMatchObject({
      outcome: 'awarded',
      kind: 'customer',
      gateKey: 'G6',
    });
  });

  it('Hold is "commitment pending" (owner + review date); Re-quote returns to the affected gate', async () => {
    const qn = await inCommit();
    ok(
      await decide(
        qn,
        'G6',
        {
          outcomeKey: 'hold',
          reasonCode: 'awaiting_capital_decision',
          holdUntil: addCalendarDays(today(), 10),
          holdOwnerId: await userId('kam'),
        },
        'kam',
      ),
    );
    expect(await quoteRow(qn)).toMatchObject({ stageKey: 'COMMIT_HANDOFF', status: 'on_hold' });
    const back = await decide(
      qn,
      'G6',
      { outcomeKey: 'requote', reasonCode: 'volume_change', targetStageKey: 'QUOTING' },
      'kam',
    );
    ok(back);
    expect(await quoteRow(qn)).toMatchObject({ stageKey: 'QUOTING', status: 'active', version: 2 });
  });

  it('SF "Closed Won" agrees with a quote waiting in Commit & Hand Off', async () => {
    const qn = await inCommit();
    await setSfStage(qn, 'Closed Won - Product Shipping');
    expect((await detail(qn)).customerDecision.sf.mismatch).toBe(false);
  });
});

describe('B-26: G5 In negotiation', () => {
  it('records a counter within range with a note; the quote stays in Customer Decision', async () => {
    const qn = await inCustomerDecision();
    expect(errorCodes(await g5(qn, { outcomeKey: 'negotiating' }))).toEqual(['NOTE_REQUIRED']);
    ok(await g5(qn, { outcomeKey: 'negotiating', note: 'Counter at -2%, inside the range' }));
    expect(await quoteRow(qn)).toMatchObject({ stageKey: 'CUSTOMER_DECISION', status: 'active' });
    expect((await detail(qn)).customerDecision.inNegotiation).toBe(true);
  });
});

describe('the closure rule (CR-39/40): every terminal path', () => {
  /** Each terminal path: how to get there and the decision that closes it. */
  const paths: [string, () => Promise<string>, string, Record<string, unknown>, string, string][] =
    [
      [
        'G1 Stop',
        submitted,
        'G1',
        { outcomeKey: 'stop', reasonCode: 'not_strategic', note: 'n' },
        'sales-leader',
        'DECLINED',
      ],
      [
        'G1 Redirect',
        submitted,
        'G1',
        { outcomeKey: 'redirect', reasonCode: 'stock_item' },
        'sales-leader',
        'REDIRECTED',
      ],
      [
        'G2 Stop',
        inEngineering,
        'G2',
        { outcomeKey: 'stop', reasonCode: 'customer_withdrew', note: 'n' },
        'eng-lead',
        'DECLINED',
      ],
      [
        'G3 Stop',
        inQuoting,
        'G3',
        { outcomeKey: 'stop', reasonCode: 'not_strategic', note: 'n' },
        'pricing',
        'DECLINED',
      ],
      [
        'G4 Decline',
        inFinalReview,
        'G4',
        { outcomeKey: 'decline', reasonCode: 'margin_below_floor', note: 'n' },
        'approver',
        'DECLINED',
      ],
      [
        'G6 Advance (Closed – Won)',
        () => committed('loi'),
        'G6',
        { outcomeKey: 'advance', reasonCode: 'loi' },
        'kam',
        'AWARDED',
      ],
      [
        'G6 Stop (commitment not authorized)',
        inCommit,
        'G6',
        { outcomeKey: 'stop', reasonCode: 'cer_not_approved', note: 'CER refused' },
        'sales-leader',
        'NOT_AUTHORIZED',
      ],
      [
        'G5 Lost',
        inCustomerDecision,
        'G5',
        { outcomeKey: 'lost', reasonCode: 'capability' },
        'kam',
        'CLOSED_LOST',
      ],
      [
        'G5 Expired',
        inCustomerDecision,
        'G5',
        { outcomeKey: 'expired', reasonCode: 'no_response', note: 'n' },
        'kam',
        'EXPIRED',
      ],
    ];

  it.each(paths)(
    '%s: refused without a reason; closes with outcome + reason + owner + date + deciding role',
    async (_name, setup, gate, body, by, stage) => {
      const qn = await setup();
      const { reasonCode, ...noReason } = body;
      const refused = await decide(qn, gate, noReason, by);
      expect(refused.statusCode, refused.body).toBe(422);
      expect(errorCodes(refused)).toContain('REASON_REQUIRED');
      expect((await quoteRow(qn)).status).not.toBe('closed');

      ok(await decide(qn, gate, body, by));
      const row = await closure(qn);
      expect(row).toMatchObject({
        stageKey: stage,
        status: 'closed',
        outcomeReasonCode: reasonCode,
        closedAt: clock.toISOString(),
      });
      expect(row.outcome).toBeTruthy();
      // Customer outcomes (G5, and Won at G6): owned by the KAM. Internal no-gos: by the decider.
      const customer = gate === 'G5' || (gate === 'G6' && body.outcomeKey === 'advance');
      expect(row.closureOwnerId).toBe(customer ? ids.kam : await userId(by));
      const [closing] = (await decisions(qn, gate)).slice(-1);
      expect(
        (closing!.evidence as { decidedByRoles: string[] }).decidedByRoles.length,
      ).toBeGreaterThan(0);
      expect((await detail(qn)).customerDecision.closure).toMatchObject({
        outcome: row.outcome,
        reasonCode,
        kind: customer ? 'customer' : 'internal',
      });
    },
  );

  it('the database refuses a closure without reason or owner, whoever writes it', async () => {
    const qn = await inCustomerDecision();
    await expect(
      db.db.execute(sql`
        update quote set stage_key = 'CLOSED_LOST', status = 'closed', outcome = 'lost', closed_at = now()
        where quote_number = ${qn}`),
    ).rejects.toThrow();
    await expect(
      db.db.execute(sql`
        update quote set stage_key = 'CLOSED_LOST', status = 'closed', outcome = 'lost', closed_at = now(),
          outcome_reason_code = 'price'
        where quote_number = ${qn}`),
    ).rejects.toThrow();
    expect((await quoteRow(qn)).status).toBe('active');
  });

  it('no closed quote anywhere breaks the rule (seed data included)', async () => {
    const [row] = await db.db.execute<{ n: number }>(sql`
      select count(*)::int as n from quote where status = 'closed'
        and (outcome is null or outcome_reason_code is null or closure_owner_id is null or closed_at is null)`);
    expect(row!.n).toBe(0);
    expect((await report()).incompleteClosures).toBe(0);
  });
});

describe('the daily validity expiry job', () => {
  it('flags lapsed proposals once, tells the KAM, writes a timeline event, and never closes them', async () => {
    const qn = await inCustomerDecision();
    const until = (await quoteRow(qn)).validityUntil!;
    const saved = clock;
    // The last valid day: nothing to flag.
    clock = new Date(`${until}T20:00:00Z`);
    let run = await app.validityExpiry!.runNow();
    expect(run.outcome).toBe('succeeded');
    expect(run.quoteNumbers).not.toContain(qn);

    clock = new Date(clock.getTime() + DAY);
    run = await app.validityExpiry!.runNow();
    expect(run.quoteNumbers).toContain(qn);
    const row = await quoteRow(qn);
    expect(row).toMatchObject({ stageKey: 'CUSTOMER_DECISION', status: 'active', closedAt: null });
    expect(row.validityExpiredFlaggedAt?.toISOString()).toBe(clock.toISOString());
    expect(await events(qn, 'validity_expired')).toMatchObject([
      { payload: { validityUntil: until } },
    ]);
    const [n] = await notifications(qn, 'quote.validity_expired');
    expect(n).toMatchObject({ userId: ids.kam });
    expect(n!.body).toContain('Revalidate or record the outcome');
    expect((await detail(qn)).customerDecision).toMatchObject({
      validity: { state: 'expired' },
      validityExpiredFlaggedAt: clock.toISOString(),
    });

    // Once per validity date.
    run = await app.validityExpiry!.runNow();
    expect(run.quoteNumbers).not.toContain(qn);
    expect(await notifications(qn, 'quote.validity_expired')).toHaveLength(1);
    clock = saved;
  });

  it('runs on one instance only (advisory lock)', async () => {
    const conn = await db.sql.reserve();
    try {
      await conn`select pg_advisory_lock(1301001)`;
      expect((await app.validityExpiry!.runNow()).outcome).toBe('skipped');
      await conn`select pg_advisory_unlock(1301001)`;
    } finally {
      conn.release();
    }
    expect((await app.validityExpiry!.runNow()).outcome).toBe('succeeded');
  });

  it('a re-quote that is released again starts a fresh countdown', async () => {
    const qn = await inCustomerDecision();
    const saved = clock;
    tick(40 * DAY);
    await app.validityExpiry!.runNow();
    expect((await quoteRow(qn)).validityExpiredFlaggedAt).not.toBeNull();
    ok(
      await g5(qn, {
        outcomeKey: 'requote',
        reasonCode: 'terms_change',
        targetStageKey: 'QUOTING',
      }),
    );
    await recordPrice(qn);
    ok(await decide(qn, 'G3', { outcomeKey: 'submit' }, 'pricing'));
    ok(await decide(qn, 'G4', { outcomeKey: 'approve' }, 'approver'));
    const row = await quoteRow(qn);
    expect(row.validityExpiredFlaggedAt).toBeNull();
    expect(row.validityUntil).toBe(addCalendarDays(proposalCalendarDate(clock), 30));
    clock = saved;
  });
});

describe('the hand-off record (PUT /quotes/:qn/handoff)', () => {
  const awarded = () => inCommit('contract');
  const put = (qn: string, body: Record<string, unknown>, by = 'kam') =>
    persona(by).put(`/api/v1/quotes/${qn}/handoff`, body);

  it('only in Commit & Hand Off (or on a Closed – Won quote)', async () => {
    const qn = await inCustomerDecision();
    const res = await put(qn, { cerId: 'CER-1' });
    expect(res.statusCode).toBe(409);
    expect(errorCodes(res)).toEqual(['NOT_AWARDED']);
    expect((await detail(qn)).customerDecision.canEditHandoff).toBe(false);
  });

  it('captures the CER (B-26: status and approval date; no BPR) and the receiving role; timeline gets field names, audit the values', async () => {
    const qn = await awarded();
    expect((await put(qn, { bprId: 'BPR-1' })).statusCode).toBe(400);
    const res = await put(qn, {
      cerId: ' CER-2026-0412 ',
      cerStatus: 'approved',
      cerApprovedOn: today(),
      receivingRole: 'commercial_activation',
      receivingContactName: 'Amanda Cronkhite',
      acceptedOn: today(),
      notes: 'Kick-off booked',
    });
    expect(res.statusCode, res.body).toBe(200);
    const { customerDecision } = HandoffResponse.parse(res.json());
    expect(customerDecision.handoff).toMatchObject({
      acceptanceEvidence: 'contract',
      cerId: 'CER-2026-0412',
      cerStatus: 'approved',
      cerApprovedOn: today(),
      receivingRole: 'commercial_activation',
      receivingRoleLabel: 'Commercial Activation',
      receivingContactName: 'Amanda Cronkhite',
      acceptedOn: today(),
      completed: false,
    });
    expect(await quoteRow(qn)).toMatchObject({ cerId: 'CER-2026-0412' });
    const [e] = await events(qn, 'handoff_updated');
    expect((e!.payload as { fields: string[] }).fields.sort()).toEqual([
      'acceptedOn',
      'cerApprovedOn',
      'cerId',
      'cerStatus',
      'notes',
      'receivingContactName',
      'receivingRole',
    ]);
    expect(JSON.stringify(e!.payload)).not.toContain('CER-2026-0412');
    const [audit] = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.entity, 'handoff_record'),
          eq(schema.auditEvent.quoteId, (await quoteRow(qn)).id),
        ),
      );
    expect(audit).toMatchObject({ action: 'update', after: { cerId: 'CER-2026-0412' } });
  });

  it('"Hand-off complete" needs role, contact and date, and records who confirmed it', async () => {
    const qn = await awarded();
    let res = await put(qn, { complete: true, receivingRole: 'other' });
    expect(res.statusCode).toBe(422);
    expect(errorPaths(res)).toEqual([
      '/acceptedOn',
      '/receivingContactName',
      '/receivingRoleOther',
    ]);
    res = await put(
      qn,
      {
        complete: true,
        receivingRole: 'npi_post_award_pm',
        receivingContactName: 'Pat Doe',
        acceptedOn: today(),
      },
      'sales-leader',
    );
    expect(res.statusCode, res.body).toBe(200);
    const saved = HandoffResponse.parse(res.json()).customerDecision.handoff;
    expect(saved).toMatchObject({ completed: true, completedAt: clock.toISOString() });
    expect(saved?.completedByName).toBeTruthy();
    expect((await handoffRow(qn))!.completedBy).toBe(ids['sales-leader']);
    expect(await events(qn, 'handoff_completed')).toHaveLength(1);
  });

  it('is editable by the KAM (own), SalesLeader and Admin; nobody else', async () => {
    const qn = await awarded();
    for (const key of ['kam', 'sales-leader', 'admin']) {
      expect((await put(qn, { notes: `by ${key}` }, key)).statusCode, key).toBe(200);
    }
    for (const key of ['eng-lead', 'engineer', 'pricing', 'approver', 'leadership']) {
      expect((await put(qn, { notes: 'x' }, key)).statusCode, key).toBe(403);
    }
    // A KAM who is not this quote's KAM.
    await db.db.execute(
      sql`update quote set kam_user_id = ${ids['kam-owner']!} where quote_number = ${qn}`,
    );
    expect((await put(qn, { notes: 'x' })).statusCode).toBe(403);
    // No price figure sneaks in: the body is strict.
    expect((await put(qn, { notes: 'x', price: 1.23 }, 'admin')).statusCode).toBe(400);
  });
});

describe('the outcomes report (GET /admin/reports/outcomes)', () => {
  it('counts by outcome and reason; Expired is never Lost; win rate excludes expired; capture rate', async () => {
    const base = await report();
    const lost = await inCustomerDecision();
    ok(await g5(lost, { outcomeKey: 'lost', reasonCode: 'capacity' }));
    const expired = await inCustomerDecision();
    ok(await g5(expired, { outcomeKey: 'expired', reasonCode: 'no_response', note: 'Silent' }));
    const won = await committed('verbal');
    ok(await decide(won, 'G6', { outcomeKey: 'advance', reasonCode: 'verbal' }, 'kam'));
    // B-26: an award still in Commit & Hand Off counts as a win (commitment pending).
    await inCommit('po');

    const r = await report();
    expect(r.customer.lost).toBe(base.customer.lost + 1);
    expect(r.customer.expired).toBe(base.customer.expired + 1);
    expect(r.customer.awarded).toBe(base.customer.awarded + 2);
    expect(r.customer.commitmentPending).toBe(base.customer.commitmentPending + 1);
    expect(r.customer.winRate).toBeCloseTo(
      r.customer.awarded / (r.customer.awarded + r.customer.lost),
      2,
    );
    const by = (o: string) => r.outcomes.find((x) => x.outcome === o)!;
    expect(by('expired')).toMatchObject({ kind: 'customer', label: 'Expired' });
    expect(by('lost')).toMatchObject({ kind: 'customer', label: 'Closed Lost' });
    expect(by('declined').kind).toBe('internal');
    expect(by('expired').reasons.find((x) => x.code === 'no_response')!.count).toBe(
      base.outcomes
        .find((x) => x.outcome === 'expired')!
        .reasons.find((x) => x.code === 'no_response')!.count + 1,
    );
    expect(r.capture.recorded).toBe(base.capture.recorded + 4);
    expect(by('not_authorized').kind).toBe('internal');
    expect(r.capture.rate).toBe(
      Math.round((r.capture.recorded / (r.capture.recorded + r.capture.goneDark)) * 1000) / 1000,
    );
    expect(r.taxonomyProvisional).toBe(true); // D-15 not approved yet
  });

  it('is read by analytics roles; KAMs and Engineers get 403', async () => {
    for (const key of ['admin', 'leadership', 'sales-leader']) {
      expect((await persona(key).get('/api/v1/admin/reports/outcomes')).statusCode, key).toBe(200);
    }
    for (const key of ['kam', 'engineer']) {
      expect((await persona(key).get('/api/v1/admin/reports/outcomes')).statusCode, key).toBe(403);
    }
  });
});
