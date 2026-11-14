/**
 * FB-15 (Nov 13 walkthrough, W13-01 to W13-10): the intake fixes on the server. W13-01 "a filled intake still
 * says it is missing required information" had several causes; each one the server takes part in is
 * reproduced here (the wizard-only causes are in apps/web/src/intake/fb15.test.ts). Synthetic data only.
 * Its own database so the free SF opportunities go further.
 */
import {
  IntakeDraft,
  QuoteDetail,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-11-13T15:00:00Z');

let free: string[] = [];
const nextFree = () => {
  const id = free.shift();
  if (!id) throw new Error('test ran out of free opportunities');
  return id;
};
const kam = () => asRole(app, 'KAM');

async function prefill(sfOpportunityId: string): Promise<IntakeDraftData> {
  const res = await kam().get(`/api/v1/salesforce/opportunities/${sfOpportunityId}`);
  expect(res.statusCode, res.body).toBe(200);
  const sf = SfOpportunityDetail.parse(res.json());
  const shipTo = {
    line1: '1 Test St',
    city: 'Testville',
    state: 'MO',
    postal: null,
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
    components: ['CONTAINER', 'CLOSURE'],
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
    quoteNeededBy: '2026-12-15',
    productNeededBy: '2027-03-01',
    containerSize: '16 oz',
    drawingStatus: 'HAVE_DRAWING',
  };
}

async function createDraft(data: IntakeDraftData) {
  const res = await kam().post('/api/v1/quotes/drafts', { data });
  expect(res.statusCode, res.body).toBe(201);
  return IntakeDraft.parse(res.json());
}
const submit = (id: string) => kam().post(`/api/v1/quotes/drafts/${id}/submit`);
const blocking = (d: { evaluation: { blocking: { code: string; field: string }[] } }) =>
  d.evaluation.blocking.map((b) => `${b.code}:${b.field}`);

async function submitQuote(extra: IntakeDraftData) {
  const draft = await createDraft({ ...(await prefill(nextFree())), ...extra });
  expect(draft.evaluation.blocking).toEqual([]);
  const res = await submit(draft.id);
  expect(res.statusCode, res.body).toBe(201);
  const out = SubmitIntakeResponse.parse(res.json());
  const [quote] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, out.quoteId));
  return { ...out, quote: quote!, draft };
}

/** The quote waits at G1; the sales leader sends it back to the KAM. */
async function sendBack(quoteNumber: string, note: string) {
  const res = await asRole(app, 'SalesLeader').post(
    `/api/v1/quotes/${quoteNumber}/gates/G1/decisions`,
    { outcomeKey: 'rework', reasonCode: 'missing_information', note },
  );
  expect(res.statusCode, res.body).toBe(201);
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('intake_fb15');
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

describe('W13-01: the 422 names every field and the server agrees with the wizard', () => {
  it('a refused submit lists each blocking issue (field, message) for the Fix links', async () => {
    const draft = await createDraft({
      ...(await prefill(nextFree())),
      market: null,
      subMarket: null,
      components: ['CONTAINER', 'OTHER'],
    });
    const res = await submit(draft.id);
    expect(res.statusCode).toBe(422);
    const problem = res.json<{
      detail: string;
      errors: { path: string; message: string }[];
      blocking: { code: string; field: string }[];
    }>();
    expect(problem.blocking.map((b) => `${b.code}:${b.field}`)).toEqual([
      'MISSING_FIELD:market',
      'MISSING_FIELD:sub_market',
      'MISSING_FIELD:component_other',
    ]);
    expect(problem.errors.map((e) => e.path)).toEqual(['market', 'subMarket', 'component_other']);
  });

  it('(b) a code retired after it was picked: the draft evaluation names it, like the 422', async () => {
    const draft = await createDraft({ ...(await prefill(nextFree())), additive: 'ANTISTAT' });
    expect(blocking(draft)).toEqual([]);
    await db.db
      .update(schema.valueList)
      .set({ active: false })
      .where(and(eq(schema.valueList.listKey, 'additive'), eq(schema.valueList.code, 'ANTISTAT')));
    try {
      const again = IntakeDraft.parse(
        (await kam().get(`/api/v1/quotes/drafts/${draft.id}`)).json(),
      );
      expect(blocking(again)).toEqual(['INVALID_VALUE:additive']);
      const res = await submit(draft.id);
      expect(res.statusCode).toBe(422);
      expect(res.json<{ blocking: { field: string }[] }>().blocking[0]!.field).toBe('additive');
    } finally {
      await db.db
        .update(schema.valueList)
        .set({ active: true })
        .where(
          and(eq(schema.valueList.listKey, 'additive'), eq(schema.valueList.code, 'ANTISTAT')),
        );
    }
  });

  it('(d) a Salesforce ship-to without a state: filling the state needs no reason', async () => {
    const base = await prefill(nextFree());
    const sfDefault = { ...base.shipToDefault!, state: null };
    const draft = await createDraft({ ...base, shipTo: sfDefault, shipToDefault: sfDefault });
    expect(blocking(draft)).toEqual(['MISSING_FIELD:ship_to.state']);
    const res = await kam().patch(`/api/v1/quotes/drafts/${draft.id}`, {
      data: { shipTo: { ...sfDefault, state: 'MO' } },
    });
    expect(blocking(IntakeDraft.parse(res.json()))).toEqual([]);
    const out = await submit(draft.id);
    expect(out.statusCode, out.body).toBe(201);
    const [q] = await db.db
      .select()
      .from(schema.quote)
      .where(eq(schema.quote.id, SubmitIntakeResponse.parse(out.json()).quoteId));
    expect(q!.shipToOverridden).toBe(false);
    expect(q!.shipTo).toMatchObject({ state: 'MO' });
  });

  it('(f) a rework whose Quote needed by date has passed names it; fixing it resubmits', async () => {
    const { quoteNumber, quote } = await submitQuote({
      quoteNeededBy: '2026-11-20',
      productNeededBy: '2026-11-25',
    });
    await sendBack(quoteNumber, 'Please confirm the Quote needed by date');
    clock = new Date('2026-11-30T15:00:00Z');
    try {
      const res = await kam().post(`/api/v1/quotes/${quoteNumber}/rework`);
      expect(res.statusCode, res.body).toBe(200);
      const draft = IntakeDraft.parse(res.json());
      // The copy of the last submit carries the passed date; the draft says so before Submit.
      expect(blocking(draft)).toEqual(['INVALID_VALUE:quote_needed_by']);
      // The rework draft carries the codes the quote already holds (for the wizard's list check).
      expect(draft.keptListValues).toMatchObject({ resin: ['HDPE'], market: ['FOOD'] });
      expect(draft.rework).toMatchObject({ note: 'Please confirm the Quote needed by date' });
      await kam().patch(`/api/v1/quotes/drafts/${draft.id}`, {
        data: { quoteNeededBy: '2026-12-20', productNeededBy: '2027-02-01' },
      });
      const out = await submit(draft.id);
      expect(out.statusCode, out.body).toBe(201);
      expect(SubmitIntakeResponse.parse(out.json())).toMatchObject({
        quoteNumber,
        resubmitted: true,
      });
      // No stale "returned for rework" banner on the quote after the resubmit.
      const detail = QuoteDetail.parse((await kam().get(`/api/v1/quotes/${quoteNumber}`)).json());
      expect(detail.rework).toBeNull();
      expect(quote.id).toBe(detail.id);
    } finally {
      clock = new Date('2026-11-13T15:00:00Z');
    }
  });
});

describe('W13-03: "Other" asks what it is', () => {
  it('product family, component and decoration Other are required and stored', async () => {
    const data = {
      productFamily: 'OTHER',
      components: ['CONTAINER', 'DECORATION', 'OTHER'],
      decorationType: 'OTHER',
      decorationPrintColors: 2,
    };
    const draft = await createDraft({ ...(await prefill(nextFree())), ...data });
    expect(blocking(draft)).toEqual([
      'MISSING_FIELD:product_family_other',
      'MISSING_FIELD:component_other',
      'MISSING_FIELD:decoration_type_other',
    ]);
    const ok = await submitQuote({
      ...data,
      productFamilyOther: 'Squeeze tube',
      componentOther: 'Measuring cup',
      decorationTypeOther: 'In-mold label',
    });
    expect(ok.quote).toMatchObject({
      productFamilyOther: 'Squeeze tube',
      componentOther: 'Measuring cup',
      decorationTypeOther: 'In-mold label',
    });
    // Every reader of the quote sees them (rule 2).
    for (const role of ['Engineer', 'Pricing', 'Approver'] as const) {
      const detail = QuoteDetail.parse(
        (await asRole(app, role).get(`/api/v1/quotes/${ok.quoteNumber}`)).json(),
      );
      expect(detail.intakeFacts).toMatchObject({
        productFamilyOther: 'Squeeze tube',
        componentOther: 'Measuring cup',
        decorationTypeOther: 'In-mold label',
      });
    }
  });

  it('a description left behind after Other is unpicked is cleared', async () => {
    const ok = await submitQuote({ productFamilyOther: 'stale', componentOther: 'stale' });
    expect(ok.quote).toMatchObject({ productFamilyOther: null, componentOther: null });
  });

  it('freight Other on a delivered price requires the special arrangements', async () => {
    const data = { priceBasis: 'DELIVERED', freightType: 'OTHER' };
    const draft = await createDraft({ ...(await prefill(nextFree())), ...data });
    expect(blocking(draft)).toEqual(['MISSING_FIELD:freight_special_arrangements']);
    expect((await submit(draft.id)).statusCode).toBe(422);
    const ok = await submitQuote({ ...data, freightSpecialArrangements: 'Customer pickup' });
    expect(ok.quote.freightSpecialArrangements).toBe('Customer pickup');
  });
});

describe('W13-09: customer share of Shared funding', () => {
  it('stored for Shared, refused out of range, cleared for other funding', async () => {
    const shared = await submitQuote({ toolingFundingModel: 'SHARED', customerSharePct: 37.5 });
    expect(shared.quote.customerSharePct).toBe(37.5);
    const detail = QuoteDetail.parse(
      (await asRole(app, 'Pricing').get(`/api/v1/quotes/${shared.quoteNumber}`)).json(),
    );
    expect(detail.intakeFacts.customerSharePct).toBe(37.5);

    const draft = await createDraft({
      ...(await prefill(nextFree())),
      toolingFundingModel: 'SHARED',
      customerSharePct: 140,
    });
    expect(blocking(draft)).toEqual(['INVALID_VALUE:customer_share_pct']);
    expect((await submit(draft.id)).statusCode).toBe(422);

    const other = await submitQuote({ toolingFundingModel: 'NOT_DISCUSSED', customerSharePct: 40 });
    expect(other.quote.customerSharePct).toBeNull();
  });
});

describe('W13-07, W13-08: stock colors and Fluorination are on the lists', () => {
  it('a stock color and Fluorination submit', async () => {
    const ok = await submitQuote({ colorType: 'STOCK_WHITE', additive: 'FLUORINATION' });
    expect(ok.quote).toMatchObject({ colorType: 'STOCK_WHITE', additive: 'FLUORINATION' });
  });
});
