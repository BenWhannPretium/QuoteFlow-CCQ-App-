/**
 * FB-11 (D-032): intake commercial inputs: the payment terms the customer requests, customer funding,
 * returnable dunnage, delivered or FOB with the freight, and the bid / program reference. All optional at
 * submit; every role that reads the quote sees them (rule 2); search and the pipeline CSV find them.
 * Its own database so the free SF opportunities go further.
 */
import {
  IntakeDraft,
  PublicConfigResponse,
  QuoteDetail,
  QuoteListResponse,
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
const clock = new Date('2026-11-09T15:00:00Z');

let free: string[] = [];
const nextFree = () => {
  const id = free.shift();
  if (!id) throw new Error('test ran out of free opportunities');
  return id;
};

const kam = () => asRole(app, 'KAM');
const ALL_ROLES = [
  'KAM',
  'SalesLeader',
  'EngLead',
  'Engineer',
  'Pricing',
  'PricingLead',
  'Approver',
  'Leadership',
  'Admin',
] as const;

async function prefill(sfOpportunityId: string): Promise<IntakeDraftData> {
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
    components: ['CONTAINER', 'CLOSURE'],
    market: 'FOOD',
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
    packagingNotes: 'Corner boards',
    estAnnualVolume: 750_000,
    estAnnualRevenue: sf.opportunity.amount,
    estAnnualRevenueSf: sf.opportunity.amount,
    quoteNeededBy: '2026-12-15',
    productNeededBy: '2027-03-01',
    containerSize: '16 oz',
    standardDescription: '16 oz Bottle, HDPE with Container, Closure',
    drawingStatus: 'HAVE_DRAWING',
  };
}

async function createDraft(data: IntakeDraftData) {
  const res = await kam().post('/api/v1/quotes/drafts', { data });
  expect(res.statusCode, res.body).toBe(201);
  return IntakeDraft.parse(res.json());
}

const submit = (id: string) => kam().post(`/api/v1/quotes/drafts/${id}/submit`);

async function submitQuote(extra: IntakeDraftData) {
  const draft = await createDraft({ ...(await prefill(nextFree())), ...extra });
  expect(draft.evaluation.blocking).toEqual([]);
  const res = await submit(draft.id);
  expect(res.statusCode, res.body).toBe(201);
  const out = SubmitIntakeResponse.parse(res.json());
  const [quote] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, out.quoteId));
  return { ...out, quote: quote!, draft };
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('intake_fb11');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url }), { db, now: () => clock });
  await app.ready();
  const rows = await db.db.execute<{ id: string }>(sql`
    select s.sf_opportunity_id as id from sf_opportunity_snapshot s
    where not s.is_closed and s.account_id is not null
      and not exists (select 1 from quote q where q.sf_opportunity_id = s.sf_opportunity_id and q.status <> 'closed')
    order by s.sf_opportunity_id`);
  free = rows.map((r) => r.id);
  expect(free.length).toBeGreaterThanOrEqual(6);
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('commercial inputs at intake (D-032)', () => {
  it('stores every input; each role that reads the quote sees them (rule 2)', async () => {
    const { quote, quoteNumber } = await submitQuote({
      requestedPaymentTerms: 'NET_60',
      toolingFundingModel: 'CUSTOMER_FUNDED',
      returnableDunnage: true,
      priceBasis: 'DELIVERED',
      freightType: 'DROP_TRAILER',
      freightSpecialArrangements: 'Drop trailer at the customer dock for two weeks',
      bidReference: 'RFP-2026-114',
    });
    expect(quote).toMatchObject({
      requestedPaymentTerms: 'NET_60',
      requestedPaymentTermsOther: null,
      toolingFundingModel: 'CUSTOMER_FUNDED',
      returnableDunnage: true,
      priceBasis: 'DELIVERED',
      freightType: 'DROP_TRAILER',
      freightSpecialArrangements: 'Drop trailer at the customer dock for two weeks',
      bidReference: 'RFP-2026-114',
    });
    for (const role of ALL_ROLES) {
      const detail = await asRole(app, role).get(`/api/v1/quotes/${quoteNumber}`);
      if (detail.statusCode === 403 || detail.statusCode === 404) continue; // out of that role's scope
      expect(detail.statusCode, `${role} ${detail.body}`).toBe(200);
      expect(QuoteDetail.parse(detail.json()).intakeFacts, role).toMatchObject({
        requestedPaymentTerms: 'NET_60',
        toolingFundingModel: 'CUSTOMER_FUNDED',
        returnableDunnage: true,
        priceBasis: 'DELIVERED',
        freightType: 'DROP_TRAILER',
        freightSpecialArrangements: 'Drop trailer at the customer dock for two weeks',
        bidReference: 'RFP-2026-114',
      });
    }
    // Pricing sees them in particular (the Quoting tab's "From intake").
    const pricing = await asRole(app, 'Pricing').get(`/api/v1/quotes/${quoteNumber}`);
    expect(pricing.statusCode, pricing.body).toBe(200);
  });

  it('is optional: a blank intake submits, with warnings, and the funding answer defaults to "Not discussed"', async () => {
    const draft = await createDraft(await prefill(nextFree()));
    expect(draft.evaluation.blocking).toEqual([]);
    expect(draft.evaluation.warnings.map((w) => w.field)).toEqual(
      expect.arrayContaining(['requested_payment_terms', 'price_basis']),
    );
    const res = await submit(draft.id);
    expect(res.statusCode, res.body).toBe(201);
    const { quoteId } = SubmitIntakeResponse.parse(res.json());
    const [quote] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, quoteId));
    expect(quote).toMatchObject({
      requestedPaymentTerms: null,
      toolingFundingModel: 'NOT_DISCUSSED',
      returnableDunnage: false,
      priceBasis: null,
      freightType: null,
      freightSpecialArrangements: null,
      bidReference: null,
    });
  });

  it('a delivered price without a freight type is a warning, never a block', async () => {
    const draft = await createDraft({ ...(await prefill(nextFree())), priceBasis: 'DELIVERED' });
    expect(draft.evaluation.blocking).toEqual([]);
    expect(draft.evaluation.warnings.map((w) => `${w.code}:${w.field}`)).toContain(
      'ENRICH:freight_type',
    );
  });

  it('clears the freight fields when the price is FOB (a stale value from earlier edits is not stored)', async () => {
    const { quote } = await submitQuote({
      priceBasis: 'FOB_PLANT',
      freightType: 'T_BAR',
      freightSpecialArrangements: 'stale T-bars',
    });
    expect(quote).toMatchObject({
      priceBasis: 'FOB_PLANT',
      freightType: null,
      freightSpecialArrangements: null,
    });
  });

  it('"Other" payment terms need a description, which is kept only for Other', async () => {
    const draft = await createDraft({
      ...(await prefill(nextFree())),
      requestedPaymentTerms: 'OTHER',
    });
    expect(draft.evaluation.blocking.map((b) => `${b.code}:${b.field}`)).toEqual([
      'MISSING_FIELD:requested_payment_terms_other',
    ]);
    expect((await submit(draft.id)).statusCode).toBe(422);

    const other = await submitQuote({
      requestedPaymentTerms: 'OTHER',
      requestedPaymentTermsOther: 'Net 75, paid on receipt of goods',
    });
    expect(other.quote).toMatchObject({
      requestedPaymentTerms: 'OTHER',
      requestedPaymentTermsOther: 'Net 75, paid on receipt of goods',
    });
    const net = await submitQuote({
      requestedPaymentTerms: 'NET_30',
      requestedPaymentTermsOther: 'stale',
    });
    expect(net.quote.requestedPaymentTermsOther).toBeNull();
  });

  it('refuses values that are too long (bid reference 60, freight note 200)', async () => {
    // The contract refuses them at the boundary (400); the domain repeats the limits for the wizard.
    const res = await kam().post('/api/v1/quotes/drafts', {
      data: {
        ...(await prefill(nextFree())),
        bidReference: 'x'.repeat(61),
        priceBasis: 'DELIVERED',
        freightSpecialArrangements: 'y'.repeat(201),
      },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(
      res
        .json<{ errors: { path: string }[] }>()
        .errors.map((e) => e.path)
        .sort(),
    ).toEqual(['/data/bidReference', '/data/freightSpecialArrangements']);
  });

  it('serves the standard payment terms and the new lists to every reader (the flag is derived from them)', async () => {
    const res = await asRole(app, 'KAM').get('/api/v1/config/public');
    expect(res.statusCode, res.body).toBe(200);
    const config = PublicConfigResponse.parse(res.json());
    expect(config.settings.standard_payment_terms).toEqual(['NET_15', 'NET_30']);
    const codes = (list: string) => (config.valueLists[list] ?? []).map((e) => e.code);
    expect(codes('requested_payment_terms')).toEqual(
      expect.arrayContaining(['NET_15', 'NET_30', 'NET_60', 'NET_120', 'OTHER']),
    );
    expect(codes('price_basis')).toEqual(['FOB_PLANT', 'DELIVERED']);
    expect(codes('freight_type')).toEqual(['FLATBED', 'VAN', 'DROP_TRAILER', 'T_BAR', 'OTHER']);
    expect(codes('tooling_funding_model')).toContain('NOT_DISCUSSED');
  });

  it('writes the inputs into the quote-created audit event', async () => {
    const { quote } = await submitQuote({
      requestedPaymentTerms: 'NET_45',
      priceBasis: 'DELIVERED',
      freightType: 'VAN',
      bidReference: 'PROGRAM-7',
    });
    const [event] = await db.db
      .select()
      .from(schema.auditEvent)
      .where(and(eq(schema.auditEvent.quoteId, quote.id), eq(schema.auditEvent.action, 'create')));
    expect((event!.after as { commercialInputs: unknown }).commercialInputs).toMatchObject({
      requestedPaymentTerms: 'NET_45',
      toolingFundingModel: 'NOT_DISCUSSED',
      priceBasis: 'DELIVERED',
      freightType: 'VAN',
      bidReference: 'PROGRAM-7',
    });
  });

  it('an open draft saved before FB-11 (none of the fields) still submits', async () => {
    const data = await prefill(nextFree());
    for (const key of [
      'requestedPaymentTerms',
      'toolingFundingModel',
      'returnableDunnage',
      'priceBasis',
      'bidReference',
    ] as const) {
      expect(data[key]).toBeUndefined();
    }
    const draft = await createDraft(data);
    expect((await submit(draft.id)).statusCode).toBe(201);
  });
});

describe('search and the pipeline CSV (F-085)', () => {
  it('finds a quote by its bid reference, in the list and the search box', async () => {
    const { quoteNumber } = await submitQuote({ bidReference: 'ZEBRA-BID-4471' });
    const res = await asRole(app, 'KAM').get('/api/v1/quotes?q=zebra-bid-4471');
    expect(res.statusCode, res.body).toBe(200);
    const list = QuoteListResponse.parse(res.json());
    expect(list.items.map((i) => i.quoteNumber)).toEqual([quoteNumber]);
    expect(list.items[0]).toMatchObject({ bidReference: 'ZEBRA-BID-4471' });
  });

  it('offers the inputs as optional CSV columns, not default ones', async () => {
    const { quoteNumber } = await submitQuote({
      bidReference: 'CSV-BID-9',
      requestedPaymentTerms: 'NET_90',
      toolingFundingModel: 'SHARED',
      returnableDunnage: true,
      priceBasis: 'DELIVERED',
      freightType: 'FLATBED',
    });
    const csv = await asRole(app, 'KAM').get(
      '/api/v1/quotes/export.csv?q=CSV-BID-9&columns=quoteNumber,bidReference,requestedPaymentTerms,toolingFundingModel,priceBasis,freightType,returnableDunnage',
    );
    expect(csv.statusCode, csv.body).toBe(200);
    // Every cell is quoted; compare the values.
    const lines = csv.body
      .trim()
      .split(/\r?\n/)
      .map((l) => l.replaceAll('"', ''));
    expect(lines[0]).toBe(
      'Quote,Bid / program reference,Requested payment terms,Customer tooling funding,Delivered / FOB,Freight type,Returnable dunnage',
    );
    // DR-pricing-finance-15 / DR-approver-leadership-admin-15: labels, not the stored codes.
    expect(lines[1]).toBe(
      `${quoteNumber},CSV-BID-9,Net 90,Shared (company and customer),Delivered,Flatbed,Yes`,
    );

    const plain = await asRole(app, 'KAM').get('/api/v1/quotes/export.csv?q=CSV-BID-9');
    expect(plain.body.split(/\r?\n/)[0]).not.toContain('Bid / program reference');
  });
});

describe('rework keeps the inputs', () => {
  it("a reworked quote's draft carries the stored inputs, and resubmitting keeps the funding answer", async () => {
    const sent = await submitQuote({
      requestedPaymentTerms: 'NET_120',
      toolingFundingModel: 'AMORTIZED',
      returnableDunnage: true,
      priceBasis: 'DELIVERED',
      freightType: 'DROP_TRAILER',
      freightSpecialArrangements: 'Two-week drop',
      bidReference: 'REWORK-1',
    });
    expect(sent.routedTo).toBe('G1');
    const returned = await asRole(app, 'SalesLeader').post(
      `/api/v1/quotes/${sent.quoteNumber}/gates/G1/decisions`,
      {
        outcomeKey: 'rework',
        reasonCode: 'missing_information',
        note: 'Confirm the freight terms',
      },
    );
    expect(returned.statusCode, returned.body).toBe(201);

    const open = await kam().post(`/api/v1/quotes/${sent.quoteNumber}/rework`);
    expect(open.statusCode, open.body).toBe(200);
    const draft = IntakeDraft.parse(open.json());
    expect(draft.data).toMatchObject({
      requestedPaymentTerms: 'NET_120',
      toolingFundingModel: 'AMORTIZED',
      returnableDunnage: true,
      priceBasis: 'DELIVERED',
      freightType: 'DROP_TRAILER',
      freightSpecialArrangements: 'Two-week drop',
      bidReference: 'REWORK-1',
    });

    // The KAM changes the price basis to FOB: the freight fields are cleared, the rest stays.
    await kam().patch(`/api/v1/quotes/drafts/${draft.id}`, { data: { priceBasis: 'FOB_PLANT' } });
    const res = await kam().post(`/api/v1/quotes/drafts/${draft.id}/submit`);
    expect(res.statusCode, res.body).toBe(201);
    const [quote] = await db.db
      .select()
      .from(schema.quote)
      .where(eq(schema.quote.id, sent.quoteId));
    expect(quote).toMatchObject({
      requestedPaymentTerms: 'NET_120',
      toolingFundingModel: 'AMORTIZED',
      priceBasis: 'FOB_PLANT',
      freightType: null,
      freightSpecialArrangements: null,
      bidReference: 'REWORK-1',
    });
  });
});
