import {
  DEV_USER_HEADER,
  DashboardResponse,
  IntakeDraft,
  MeResponse,
  QuoteDetail,
  RequoteResponse,
  RequoteSourceResponse,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
  type IntakeItemData,
} from '@ccq/contracts';
import { schema, uuidv7, type DbClient } from '@ccq/db';
import { proposalsEndingByQualifier } from '@ccq/db/repos';
import { addCalendarDays, proposalCalendarDate } from '@ccq/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmCapitalTerms, multipart, prepareModels } from './model-helpers';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * FB-26 (N17-30 to N17-32): the linked re-quote of an expired quote (both states, the copy, both links,
 * the "From the expired quote" panel, audit and timeline; refused while valid, twice, or for another
 * KAM), the expiry notices to the sales leader who qualified the quote, "Expiring soon" for the sales
 * leader, and the CER links and proof at hand-off.
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
  const send = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
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
    patch: (url: string, body?: unknown) => send('PATCH', url, body),
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

const SHIP_TO = {
  line1: '1 Test St',
  city: 'Testville',
  state: 'MO',
  postal: '63101',
  country: 'US',
};

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
    description: 'Synthetic re-quote test',
    commentsForEngineering: 'Same tooling as the last quote',
  };
}

const item = (key: string, over: Partial<IntakeItemData> = {}): IntakeItemData => ({
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
  ...over,
});

async function submitDraft(data: IntakeDraftData, by = 'kam') {
  const res = await persona(by).post('/api/v1/quotes/drafts', { data });
  ok(res);
  const sub = await persona(by).post(
    `/api/v1/quotes/drafts/${IntakeDraft.parse(res.json()).id}/submit`,
  );
  ok(sub);
  const { quoteNumber } = SubmitIntakeResponse.parse(sub.json());
  created.push(quoteNumber);
  return quoteNumber;
}

/** One item, all the way to Customer Decision (validity = issued + 30 days). */
async function inCustomerDecision() {
  const qn = await submitDraft({ ...(await request(await nextFree())), items: [item(uuidv7())] });
  ok(await decide(qn, 'G1', { outcomeKey: 'advance' }, 'sales-leader'));
  ok(
    await persona('eng-lead').put(`/api/v1/quotes/${qn}/eng-review`, {
      processType: 'EBM',
      machineType: 'EBM',
      plantCode: 'AURORA',
      cavitation: 8,
      cycleTimeS: 14.5,
      prelimCapitalUsd: 0,
      toolingNotes: 'Reuse the 2025 mold base',
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
async function detail(qn: string, by = 'kam') {
  const res = await persona(by).get(`/api/v1/quotes/${qn}`);
  expect(res.statusCode, res.body).toBe(200);
  return QuoteDetail.parse(res.json());
}
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
const audits = async (qn: string) =>
  db.db
    .select()
    .from(schema.auditEvent)
    .where(eq(schema.auditEvent.quoteId, (await quoteRow(qn)).id))
    .orderBy(asc(schema.auditEvent.at));
const requote = (qn: string, body: Record<string, unknown>, by = 'kam') =>
  persona(by).post(`/api/v1/quotes/${qn}/requote`, body);
const draftOf = async (id: string, by = 'kam') => {
  const res = await persona(by).get(`/api/v1/quotes/drafts/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return IntakeDraft.parse(res.json());
};
/** After the validity date (US Central): the proposal has expired. */
const lapse = async (qn: string) => {
  const until = (await quoteRow(qn)).validityUntil!;
  clock = new Date(`${addCalendarDays(until, 1)}T18:00:00Z`);
};

const setSetting = (key: string, value: unknown) =>
  db.db.execute(
    sql`update app_setting set value = ${JSON.stringify(value)}::jsonb where key = ${key}`,
  );

beforeAll(async () => {
  const fresh = await freshSfDatabase('fb26_requote');
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
    'multi-role',
    'eng-lead',
    'engineer',
    'pricing',
    'admin',
  ]) {
    await userId(key);
  }
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('a linked re-quote from a quote still open at Customer Decision (N17-30)', () => {
  it('is refused while the offer is still valid', async () => {
    const qn = await inCustomerDecision();
    const res = await requote(qn, { note: 'Customer said yes', reasonCode: 'validity_lapsed' });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ code: 'requote_not_allowed' });
    expect((await detail(qn)).requote).toMatchObject({ canStart: false, startFrom: null });
  });

  it('records G5 "No response / Expired" first, then opens a pre-filled draft; the KAM edits and submits it', async () => {
    const qn = await inCustomerDecision();
    await lapse(qn);
    const old = await quoteRow(qn);
    expect((await detail(qn)).requote).toMatchObject({
      canStart: true,
      startFrom: 'open_lapsed',
      requotedAs: null,
    });

    // The reason is needed: the quote is closed as expired first.
    const noReason = await requote(qn, { note: 'Customer said yes on the phone' });
    expect(noReason.statusCode, noReason.body).toBe(422);
    expect((await quoteRow(qn)).status).toBe('active');

    const res = await requote(qn, {
      note: 'Customer said yes on the phone',
      reasonCode: 'validity_lapsed',
    });
    ok(res, 200);
    const started = RequoteResponse.parse(res.json());
    expect(started.recordedExpired).toBe(true);

    // The old quote: closed Expired through the gate, with the KAM's note; nothing else changed.
    const closed = await quoteRow(qn);
    expect(closed).toMatchObject({
      stageKey: 'EXPIRED',
      status: 'closed',
      outcome: 'expired',
      outcomeReasonCode: 'validity_lapsed',
      requotedFromQuoteId: null,
    });
    const [g5] = await db.db
      .select()
      .from(schema.gateDecision)
      .where(and(eq(schema.gateDecision.quoteId, old.id), eq(schema.gateDecision.gateKey, 'G5')));
    expect(g5).toMatchObject({ outcomeKey: 'expired', note: 'Customer said yes on the phone' });
    expect(await events(qn, 'requote_started')).toHaveLength(1);
    const started_audit = (await audits(qn)).find(
      (a) => (a.after as { event?: string } | null)?.event === 'quote.requote_started',
    );
    expect(started_audit).toMatchObject({ entity: 'quote_draft', entityId: started.draftId });

    // The draft: same opportunity, step 2, the banner, request fields and the item copied, no need-by.
    const draft = await draftOf(started.draftId);
    expect(draft.requote).toEqual({
      quoteNumber: qn,
      expiredOn: old.validityUntil,
      banner: `Re-quote of ${qn} (expired ${old.validityUntil}). Check every value; Engineering and Pricing will review it again.`,
    });
    expect(draft.step).toBe(2);
    expect(draft.openQuoteWarning).toBeNull();
    expect(draft.data).toMatchObject({
      sfOpportunityId: old.sfOpportunityId,
      market: 'FOOD',
      subMarket: 'FOOD_SNACKS',
      description: 'Synthetic re-quote test',
      commentsForEngineering: 'Same tooling as the last quote',
    });
    expect(draft.data.quoteNeededBy).toBeUndefined();
    expect(draft.data.items).toHaveLength(1);
    const [oldItem] = await db.db
      .select()
      .from(schema.quoteItem)
      .where(eq(schema.quoteItem.quoteId, old.id));
    expect(draft.data.items![0]!.key).not.toBe(oldItem!.id);
    expect(draft.data.items![0]).toMatchObject({ resin: 'HDPE', containerSize: '16 oz' });

    // Starting again returns the same draft to its owner.
    const again = await requote(qn, { note: 'again' });
    ok(again, 200);
    expect(RequoteResponse.parse(again.json()).draftId).toBe(started.draftId);
    // The old quote's header says a re-quote was started.
    expect((await detail(qn)).requote).toMatchObject({
      canStart: false,
      draft: { draftId: started.draftId },
    });

    // The KAM checks the values, changes one and submits it through G1 as normal.
    ok(
      await persona('kam').patch(`/api/v1/quotes/drafts/${started.draftId}`, {
        data: {
          quoteNeededBy: addCalendarDays(today(), 30),
          description: 'Late yes: same three bottles',
        },
      }),
      200,
    );
    const sub = await persona('kam').post(`/api/v1/quotes/drafts/${started.draftId}/submit`);
    ok(sub);
    const { quoteNumber: newQn, routedTo } = SubmitIntakeResponse.parse(sub.json());
    expect(routedTo).toBe('G1');
    const fresh = await quoteRow(newQn);
    expect(fresh).toMatchObject({
      requotedFromQuoteId: old.id,
      kamUserId: old.kamUserId,
      stageKey: 'INTAKE',
      version: 1,
      description: 'Late yes: same three bottles',
      sfOpportunityId: old.sfOpportunityId,
    });

    // Both links, both timelines, the audit.
    expect((await detail(qn)).requote).toMatchObject({
      requotedAs: { quoteNumber: newQn, readable: true },
      canStart: false,
      draft: null,
    });
    expect((await detail(newQn)).requote).toMatchObject({
      requoteOf: { quoteNumber: qn, readable: true, at: old.validityUntil },
    });
    expect((await events(qn, 'requoted_as'))[0]!.payload).toMatchObject({ quoteNumber: newQn });
    expect((await events(newQn, 'quote_created'))[0]!.payload).toMatchObject({ requoteOf: qn });
    expect(
      (await audits(newQn)).find((a) => a.entity === 'quote' && a.action === 'create')!.after,
    ).toMatchObject({ requoteOf: qn, requotedFromQuoteId: old.id });
    expect(
      (await audits(qn)).some(
        (a) => (a.after as { event?: string } | null)?.event === 'quote.requoted_as',
      ),
    ).toBe(true);

    // Nothing of Engineering, Pricing or the decisions came along.
    expect(
      await db.db
        .select()
        .from(schema.pricingRecord)
        .where(eq(schema.pricingRecord.quoteId, fresh.id)),
    ).toEqual([]);
    expect(
      (
        await db.db.select().from(schema.engReview).where(eq(schema.engReview.quoteId, fresh.id))
      ).filter((r) => r.plantCode !== null),
    ).toEqual([]);
    expect(
      await db.db
        .select()
        .from(schema.gateDecision)
        .where(eq(schema.gateDecision.quoteId, fresh.id)),
    ).toEqual([]);

    // "From the expired quote": the old engineering solution and price approval, read only.
    const panel = RequoteSourceResponse.parse(
      (await persona('eng-lead').get(`/api/v1/quotes/${newQn}/requote-source`)).json(),
    );
    expect(panel).toMatchObject({
      quoteNumber: qn,
      readable: true,
      capitalReadiness: 'pre_approved',
    });
    expect(panel.priceApproval?.approvedByName).toBeTruthy();
    expect(panel.items[0]).toMatchObject({
      itemNo: 1,
      plantCode: 'AURORA',
      cavitation: 8,
      cycleTimeS: 14.5,
      toolingNotes: 'Reuse the 2025 mold base',
    });
    // Not a re-quote: 404.
    expect((await persona('eng-lead').get(`/api/v1/quotes/${qn}/requote-source`)).statusCode).toBe(
      404,
    );

    // Once re-quoted, never again.
    const twice = await requote(qn, { note: 'again' });
    expect(twice.statusCode, twice.body).toBe(409);
    expect(twice.json()).toMatchObject({ code: 'already_requoted', quoteNumber: newQn });
  });

  it("is refused for another KAM's quote, and for roles without quote.requote", async () => {
    const qn = await inCustomerDecision();
    await lapse(qn);
    await db.db.execute(
      sql`update quote set kam_user_id = ${await userId('kam-owner')} where quote_number = ${qn}`,
    );
    const res = await requote(qn, { note: 'not mine', reasonCode: 'validity_lapsed' });
    expect(res.statusCode, res.body).toBe(403);
    expect((await requote(qn, { note: 'x' }, 'eng-lead')).statusCode).toBe(403);
    expect((await quoteRow(qn)).status).toBe('active');
  });
});

describe('a linked re-quote of a closed expired three-item quote (N17-30)', () => {
  it('a sales leader starts it; items are copied with their drawings as links; the KAM keeps the account', async () => {
    const keys = [uuidv7(), uuidv7(), uuidv7()];
    const qn = await submitDraft({
      ...(await request(await nextFree())),
      items: [
        item(keys[0]!),
        item(keys[1]!, { label: '24 oz bottle', containerSize: '24 oz' }),
        item(keys[2]!, { label: '24 oz bottle 25% PCR', containerSize: '24 oz', pcrLevel: '25' }),
      ],
    });
    const old = await quoteRow(qn);
    const items = await db.db
      .select()
      .from(schema.quoteItem)
      .where(eq(schema.quoteItem.quoteId, old.id))
      .orderBy(asc(schema.quoteItem.itemNo));
    expect(items).toHaveLength(3);
    // A drawing held by item 1 (metadata only, synthetic) and linked from item 3 (FB-19's way).
    const drawingId = uuidv7();
    await db.db.insert(schema.attachment).values({
      id: drawingId,
      quoteId: old.id,
      quoteItemId: items[0]!.id,
      kind: 'bottle_drawing',
      fileName: 'synthetic-drawing.pdf',
      size: 10,
      mime: 'application/pdf',
      uploadedBy: old.kamUserId,
    });
    await db.db.insert(schema.quoteItemDrawing).values({
      quoteId: old.id,
      quoteItemId: items[2]!.id,
      attachmentId: drawingId,
    });
    // Closed as "No response / Expired" (synthetic shortcut).
    await db.db.execute(sql`
      update quote set stage_key = 'EXPIRED', status = 'closed', outcome = 'expired',
        outcome_reason_code = 'no_response', closure_owner_id = kam_user_id, closed_at = now(),
        validity_until = '2026-09-30', submitted_at = coalesce(submitted_at, now())
      where id = ${old.id}`);

    const res = await requote(qn, { note: 'Customer came back in November' }, 'sales-leader');
    ok(res, 200);
    const started = RequoteResponse.parse(res.json());
    expect(started.recordedExpired).toBe(false);
    const draft = await draftOf(started.draftId, 'sales-leader');
    expect(draft.ownerUserId).toBe(await userId('sales-leader'));
    expect(draft.data.items!.map((i) => i.label)).toEqual([
      '16 oz bottle',
      '24 oz bottle',
      '24 oz bottle 25% PCR',
    ]);
    expect(draft.data.items!.map((i) => i.linkedDrawingIds ?? [])).toEqual([
      [drawingId],
      [],
      [drawingId],
    ]);
    expect(
      draft.data.items!.some((i) => keys.includes(i.key) || items.some((x) => x.id === i.key)),
    ).toBe(false);
    // The KAM's own draft list is untouched (drafts are private to whoever started them).
    const kamDrafts = await persona('kam').get(`/api/v1/quotes/drafts/${started.draftId}`);
    expect(kamDrafts.statusCode).toBe(404);

    // The "quote needed by" date is not copied: a new request has a new date.
    expect(draft.data.quoteNeededBy).toBeUndefined();
    ok(
      await persona('sales-leader').patch(`/api/v1/quotes/drafts/${started.draftId}`, {
        data: { quoteNeededBy: addCalendarDays(today(), 30) },
      }),
      200,
    );
    const sub = await persona('sales-leader').post(
      `/api/v1/quotes/drafts/${started.draftId}/submit`,
    );
    ok(sub);
    const { quoteNumber: newQn } = SubmitIntakeResponse.parse(sub.json());
    const fresh = await quoteRow(newQn);
    expect(fresh.kamUserId).toBe(old.kamUserId);
    expect(fresh.requotedFromQuoteId).toBe(old.id);
    const newItems = await db.db
      .select()
      .from(schema.quoteItem)
      .where(eq(schema.quoteItem.quoteId, fresh.id))
      .orderBy(asc(schema.quoteItem.itemNo));
    expect(newItems).toHaveLength(3);
    const links = await db.db
      .select()
      .from(schema.quoteItemDrawing)
      .where(eq(schema.quoteItemDrawing.quoteId, fresh.id));
    expect(links.map((l) => [l.quoteItemId, l.attachmentId]).sort()).toEqual(
      [
        [newItems[0]!.id, drawingId],
        [newItems[2]!.id, drawingId],
      ].sort(),
    );
    // The old quote's file stays where it was.
    const [file] = await db.db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.id, drawingId));
    expect(file).toMatchObject({ quoteId: old.id, quoteItemId: items[0]!.id, removedAt: null });
    // The KAM (who owns both) sees both links.
    expect((await detail(newQn)).requote?.requoteOf?.quoteNumber).toBe(qn);
    expect((await detail(qn)).requote?.requotedAs?.quoteNumber).toBe(newQn);
  });

  it('a reader who cannot read the old quote sees only its number', async () => {
    const qn = await inCustomerDecision();
    await lapse(qn);
    const started = RequoteResponse.parse(
      (await requote(qn, { note: 'yes', reasonCode: 'no_response' })).json(),
    );
    ok(
      await persona('kam').patch(`/api/v1/quotes/drafts/${started.draftId}`, {
        data: { quoteNeededBy: addCalendarDays(today(), 30) },
      }),
      200,
    );
    const sub = await persona('kam').post(`/api/v1/quotes/drafts/${started.draftId}/submit`);
    ok(sub);
    const { quoteNumber: newQn } = SubmitIntakeResponse.parse(sub.json());
    // The new quote moves to the owner-scoped KAM; the old one stays with the KAM.
    await db.db.execute(
      sql`update quote set kam_user_id = ${await userId('kam-owner')} where quote_number = ${newQn}`,
    );
    const seen = (await detail(newQn, 'kam-owner')).requote;
    expect(seen?.requoteOf).toMatchObject({ quoteNumber: qn, readable: false });
    const panel = RequoteSourceResponse.parse(
      (await persona('kam-owner').get(`/api/v1/quotes/${newQn}/requote-source`)).json(),
    );
    expect(panel).toEqual({
      quoteNumber: qn,
      readable: false,
      items: [],
      priceApproval: null,
      capitalReadiness: null,
      capitalReadinessLabel: null,
    });
  });

  it('switched off by linked_requote_allowed_from', async () => {
    const qn = await inCustomerDecision();
    await lapse(qn);
    await setSetting('linked_requote_allowed_from', ['closed_expired']);
    try {
      const res = await requote(qn, { note: 'x', reasonCode: 'no_response' });
      expect(res.statusCode, res.body).toBe(409);
      expect((await quoteRow(qn)).status).toBe('active');
    } finally {
      await setSetting('linked_requote_allowed_from', ['closed_expired', 'open_lapsed']);
    }
  });
});

describe('expiry follow-up for the sales leader (N17-31)', () => {
  const notes = async (qn: string, type: string) =>
    db.db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.quoteId, (await quoteRow(qn)).id),
          eq(schema.notification.type, type),
          eq(schema.notification.channel, 'in_app'),
        ),
      );

  it('tells the KAM and the sales leader who qualified it, once each, before and after expiry', async () => {
    const qn = await inCustomerDecision();
    const until = (await quoteRow(qn)).validityUntil!;
    clock = new Date(`${addCalendarDays(until, -3)}T18:00:00Z`);
    await app.validityExpiry!.runNow();
    await app.validityExpiry!.runNow();
    const expiring = await notes(qn, 'quote.validity_expiring');
    expect(expiring.map((n) => n.userId).sort()).toEqual(
      [await userId('kam'), await userId('sales-leader')].sort(),
    );

    // "Expiring soon" on the sales leader's Command Center (they qualified it), soonest first.
    const dash = DashboardResponse.parse(
      (await persona('sales-leader').get('/api/v1/dashboards/SalesLeader')).json(),
    );
    if (dash.role !== 'SalesLeader') throw new Error('wrong dashboard');
    expect(dash.expiring.scope).toBe('qualified');
    expect(dash.expiring.withinDays).toBe(7);
    const days = dash.expiring.items.map((i) => i.daysLeft);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
    expect(days.every((d) => d <= 7)).toBe(true);
    // The list shows the first ten (lapsed ones first); the query behind it holds this quote.
    const listed = await proposalsEndingByQualifier(db.db, clock, 7, await userId('sales-leader'));
    expect(listed.map((r) => r.quote_number)).toContain(qn);
    expect(dash.expiring.count).toBe(listed.length);
    const another = await proposalsEndingByQualifier(db.db, clock, 7, await userId('kam'));
    expect(another.map((r) => r.quote_number)).not.toContain(qn);

    clock = new Date(`${addCalendarDays(until, 1)}T18:00:00Z`);
    await app.validityExpiry!.runNow();
    const expired = await notes(qn, 'quote.validity_expired');
    expect(expired.map((n) => n.userId).sort()).toEqual(
      [await userId('kam'), await userId('sales-leader')].sort(),
    );
  });

  it('tells only the KAM when the setting says so', async () => {
    const qn = await inCustomerDecision();
    await setSetting('validity_notice_recipients', ['kam']);
    try {
      await lapse(qn);
      await app.validityExpiry!.runNow();
      expect((await notes(qn, 'quote.validity_expired')).map((n) => n.userId)).toEqual([
        await userId('kam'),
      ]);
    } finally {
      await setSetting('validity_notice_recipients', ['kam', 'g1_decider']);
    }
  });

  it('a sales leader who never decided G1 sees every expiring quote', async () => {
    const qn = await inCustomerDecision();
    await lapse(qn);
    // The synthetic data has multi-role deciding some G1s: hand those to the other sales leader.
    await db.db.execute(sql`
      update gate_decision set decided_by = ${await userId('sales-leader')}
      where gate_key = 'G1' and decided_by = ${await userId('multi-role')}`);
    const dash = DashboardResponse.parse(
      (await persona('multi-role').get('/api/v1/dashboards/SalesLeader')).json(),
    );
    if (dash.role !== 'SalesLeader') throw new Error('wrong dashboard');
    expect(dash.expiring.scope).toBe('all');
    const listed = await proposalsEndingByQualifier(db.db, clock, 7, null);
    expect(listed.map((r) => r.quote_number)).toContain(qn);
    expect(dash.expiring.count).toBe(listed.length);
  });
});

describe('the CER at hand-off (N17-32)', () => {
  const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]);
  const upload = (url: string, kind: string, by = 'kam') => {
    const body = multipart(
      { kind, size: String(PDF.length) },
      { name: 'cer-screenshot.pdf', content: PDF },
    );
    return app.inject({
      method: 'POST',
      url,
      headers: { [DEV_USER_HEADER]: by, 'content-type': body.contentType },
      payload: body.payload,
    });
  };

  async function inCommit() {
    const qn = await inCustomerDecision();
    ok(
      await decide(
        qn,
        'G5',
        { outcomeKey: 'awarded', reasonCode: 'loi', acceptedAt: today() },
        'kam',
      ),
    );
    tick();
    return qn;
  }

  it('shows the CER links when set, and tells only an Admin to set them while empty', async () => {
    const qn = await inCommit();
    expect((await detail(qn)).customerDecision.cer).toMatchObject({
      toolUrl: null,
      templateUrl: null,
      setLinksHint: false,
      proof: null,
      proofRequired: false,
      canUploadProof: true,
    });
    expect((await detail(qn, 'admin')).customerDecision.cer?.setLinksHint).toBe(true);
    // An Admin sets them (https only).
    const [row] = await db.db
      .select()
      .from(schema.appSetting)
      .where(eq(schema.appSetting.key, 'cer_tool_url'));
    const bad = await persona('admin').patch('/api/v1/admin/config/settings/cer_tool_url', {
      value: 'http://cer.example.test',
      version: row!.version,
      changeReason: 'FB-26 test',
    });
    expect(bad.statusCode, bad.body).toBe(422);
    expect(bad.body).toContain('https');
    await setSetting('cer_tool_url', 'https://cer.example.test/apex');
    await setSetting('cer_template_url', 'https://cer.example.test/template.xlsx');
    try {
      expect((await detail(qn)).customerDecision.cer).toMatchObject({
        toolUrl: 'https://cer.example.test/apex',
        templateUrl: 'https://cer.example.test/template.xlsx',
      });
      expect((await detail(qn, 'admin')).customerDecision.cer?.setLinksHint).toBe(false);
    } finally {
      await setSetting('cer_tool_url', '');
      await setSetting('cer_template_url', '');
    }
  });

  it('takes a CER proof on the hand-off (versioned), refuses it at intake, and needs it for G6 only when the setting is on', async () => {
    const qn = await inCommit();
    // Refused at intake.
    const draft = await persona('kam').post('/api/v1/quotes/drafts', {
      data: await request(await nextFree()),
    });
    ok(draft);
    const atIntake = await upload(
      `/api/v1/quotes/drafts/${IntakeDraft.parse(draft.json()).id}/attachments`,
      'cer_proof',
    );
    expect(atIntake.statusCode, atIntake.body).toBe(422);
    // Not before the award.
    const early = await inCustomerDecision();
    expect((await upload(`/api/v1/quotes/${early}/attachments`, 'cer_proof')).statusCode).toBe(409);
    // Not by someone who cannot edit the hand-off.
    expect(
      (await upload(`/api/v1/quotes/${qn}/attachments`, 'cer_proof', 'eng-lead')).statusCode,
    ).toBe(403);

    ok(
      await persona('kam').put(`/api/v1/quotes/${qn}/handoff`, {
        cerStatus: 'approved',
        cerId: 'CER-SYN-001',
        cerApprovedOn: today(),
        receivingRole: 'commercial_activation',
        receivingContactName: 'Pat Doe',
        acceptedOn: today(),
        complete: true,
      }),
      200,
    );
    await setSetting('handoff_cer_proof_required', true);
    try {
      const refused = await decide(qn, 'G6', { outcomeKey: 'advance', reasonCode: 'loi' }, 'kam');
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.body).toContain('CER proof');

      ok(await upload(`/api/v1/quotes/${qn}/attachments`, 'cer_proof'));
      ok(await upload(`/api/v1/quotes/${qn}/attachments`, 'cer_proof'));
      const cer = (await detail(qn)).customerDecision.cer!;
      expect(cer.proof).toMatchObject({ fileName: 'cer-screenshot.pdf', version: 2 });
      expect(cer.proofRequired).toBe(true);

      ok(await decide(qn, 'G6', { outcomeKey: 'advance', reasonCode: 'loi' }, 'kam'));
      expect((await quoteRow(qn)).stageKey).toBe('AWARDED');
    } finally {
      await setSetting('handoff_cer_proof_required', false);
    }
  });

  it('with the setting off (the seed), G6 advances without a proof', async () => {
    const qn = await inCommit();
    ok(
      await persona('kam').put(`/api/v1/quotes/${qn}/handoff`, {
        cerStatus: 'approved',
        cerId: 'CER-SYN-002',
        cerApprovedOn: today(),
        receivingRole: 'commercial_activation',
        receivingContactName: 'Pat Doe',
        acceptedOn: today(),
        complete: true,
      }),
      200,
    );
    ok(await decide(qn, 'G6', { outcomeKey: 'advance', reasonCode: 'loi' }, 'kam'));
  });
});

// Keep the clock moving forward between files' quotes.
afterAll(() => {
  tick(DAY);
});
