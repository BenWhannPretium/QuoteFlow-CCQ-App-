import {
  INTAKE_PROBLEM_CODES,
  IntakeDraft,
  IntakeDraftListResponse,
  QuoteDetail,
  SfOpportunityDetail,
  SfOpportunitySearchResponse,
  SubmitIntakeResponse,
  type IntakeDraftData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import { and, eq, ne, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
const clock = new Date('2026-10-16T15:00:00Z');

/** Open SF opportunities with no active quote (the synthetic seed leaves some free). */
let free: string[] = [];
const nextFree = () => {
  const id = free.shift();
  if (!id) throw new Error('test ran out of free opportunities');
  return id;
};

const kam = () => asRole(app, 'KAM');

/** What the wizard pre-fills from the SF opportunity, plus the Sales-knowable fields. */
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

async function createDraft(data: IntakeDraftData, role: Parameters<typeof asRole>[1] = 'KAM') {
  const res = await asRole(app, role).post('/api/v1/quotes/drafts', { data });
  expect(res.statusCode, res.body).toBe(201);
  return IntakeDraft.parse(res.json());
}

const submit = (id: string, role: Parameters<typeof asRole>[1] = 'KAM') =>
  asRole(app, role).post(`/api/v1/quotes/drafts/${id}/submit`);

beforeAll(async () => {
  const fresh = await freshSfDatabase('intake');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url }), { db, now: () => clock });
  await app.ready();
  const rows = await db.db.execute<{ id: string }>(sql`
    select s.sf_opportunity_id as id from sf_opportunity_snapshot s
    where not s.is_closed and s.account_id is not null
      and not exists (select 1 from quote q where q.sf_opportunity_id = s.sf_opportunity_id and q.status <> 'closed')
    order by s.sf_opportunity_id`);
  free = rows.map((r) => r.id);
  expect(free.length).toBeGreaterThanOrEqual(8);
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('create → autosave → submit (happy path)', () => {
  let draftId = '';
  let oppId = '';
  let quoteNumber = '';

  it('creates a draft for the caller with an evaluation', async () => {
    oppId = nextFree();
    const draft = await createDraft({ sfOpportunityId: oppId });
    draftId = draft.id;
    expect(draft.step).toBe(1);
    expect(draft.activeQuote).toBeNull();
    expect(draft.evaluation.ready).toBe(false);
    expect(draft.evaluation.blocking.map((b) => b.field)).toEqual(
      expect.arrayContaining(['customer.name', 'product_family', 'resin', 'est_annual_volume']),
    );
  });

  it('autosaves fields and the step; the evaluation follows', async () => {
    const data = await prefill(oppId);
    const res = await kam().patch(`/api/v1/quotes/drafts/${draftId}`, { data, step: 3 });
    expect(res.statusCode, res.body).toBe(200);
    const draft = IntakeDraft.parse(res.json());
    expect(draft.step).toBe(3);
    expect(draft.evaluation).toEqual({ blocking: [], warnings: [], ready: true });
    // T-009: the SF close date is read from the latest synced snapshot, never from the draft.
    const [snap] = await db.db
      .select()
      .from(schema.sfOpportunitySnapshot)
      .where(eq(schema.sfOpportunitySnapshot.sfOpportunityId, oppId));
    expect(draft.sfCloseDate).toBe(snap!.closeDate);
    expect(draft.data).not.toHaveProperty('expectedCloseDate');

    // A partial patch replaces only the keys it sends.
    const partial = await kam().patch(`/api/v1/quotes/drafts/${draftId}`, {
      data: { commentsForEngineering: 'Customer is trialling a competitor' },
    });
    const after = IntakeDraft.parse(partial.json());
    expect(after.data.resin).toBe('HDPE');
    expect(after.data.commentsForEngineering).toBe('Customer is trialling a competitor');
  });

  it('lists the open draft for its owner (resume)', async () => {
    const res = await kam().get('/api/v1/quotes/drafts?mine=true');
    const list = IntakeDraftListResponse.parse(res.json());
    expect(list.items.map((i) => i.id)).toContain(draftId);
  });

  it('submit creates CCQ-YYYY-NNNNN in Intake, waiting for G1, with history, activity and audit', async () => {
    const res = await submit(draftId);
    expect(res.statusCode, res.body).toBe(201);
    const body = SubmitIntakeResponse.parse(res.json());
    quoteNumber = body.quoteNumber;
    expect(body.quoteNumber).toMatch(/^CCQ-2026-\d{5}$/);
    expect(body).toMatchObject({ stageKey: 'INTAKE', status: 'active', routedTo: 'G1' });
    // B-08: scored at submit (advisory) with the model version recorded.
    expect(body.priorityScore).toEqual(expect.any(Number));
    expect(body.priorityTier).toMatch(/^(CRITICAL|HIGH|STANDARD|LOW)$/);
    expect(body.resubmitted).toBe(false);
    expect(body.warnings).toEqual([]);

    const [quote] = await db.db
      .select()
      .from(schema.quote)
      .where(eq(schema.quote.id, body.quoteId));
    expect(quote).toMatchObject({
      sfOpportunityId: oppId,
      stageKey: 'INTAKE',
      productFamily: 'BOTTLE',
      resin: 'HDPE',
      neckDiameter: '38',
      neckFinishType: '400',
      pcrLevel: '0',
      colorType: 'NATURAL',
      estAnnualVolume: 750_000,
      requestClass: 'CCQ',
      shipToOverridden: false,
      // FB-02 (F-009 / T-009): the need-by dates are stored; no close date is (SF's stays in SF).
      quoteNeededBy: '2026-12-15',
      productNeededBy: '2027-03-01',
      expectedCloseDate: null,
      priorityScore: body.priorityScore,
      priorityTier: body.priorityTier,
      scoringModelVersion: 1,
    });
    expect(quote!.submittedAt).toEqual(clock);
    expect(quote!.customerId).not.toBeNull();
    expect(quote!.structuredDescription).toMatchObject({
      standard: '16 oz Bottle, HDPE with Container, Closure',
    });

    const history = await db.db
      .select()
      .from(schema.stageHistory)
      .where(eq(schema.stageHistory.quoteId, body.quoteId));
    expect(history.map((h) => [h.stageKey, h.exitedAt])).toEqual([['INTAKE', null]]);

    const activity = await db.db
      .select()
      .from(schema.activityEvent)
      .where(eq(schema.activityEvent.quoteId, body.quoteId));
    expect(activity.map((a) => a.type)).toEqual(['quote_created']);

    const audit = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.quoteId, body.quoteId), eq(schema.auditEvent.action, 'create')),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after).toMatchObject({ quoteNumber, sfOpportunityId: oppId });

    const [draft] = await db.db
      .select()
      .from(schema.quoteDraft)
      .where(eq(schema.quoteDraft.id, draftId));
    expect(draft!.submittedQuoteId).toBe(body.quoteId);
  });

  it('a submitted draft is read-only and leaves the open list', async () => {
    expect((await submit(draftId)).statusCode).toBe(409);
    const patch = await kam().patch(`/api/v1/quotes/drafts/${draftId}`, { step: 2 });
    expect(patch.json()).toMatchObject({ code: INTAKE_PROBLEM_CODES.alreadySubmitted });
    const list = IntakeDraftListResponse.parse((await kam().get('/api/v1/quotes/drafts')).json());
    expect(list.items.map((i) => i.id)).not.toContain(draftId);
  });

  it('one active quote per opportunity: a second submit is 409 and the picker shows "Open existing"', async () => {
    const second = await createDraft(await prefill(oppId));
    expect(second.activeQuote).toMatchObject({ quoteNumber, stageKey: 'INTAKE' });
    const res = await submit(second.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: INTAKE_PROBLEM_CODES.activeQuoteExists,
      quoteNumber,
    });

    const search = await kam().get(
      `/api/v1/salesforce/opportunities?q=${encodeURIComponent((await prefill(oppId)).sfOpportunityName!)}&limit=5`,
    );
    const hit = SfOpportunitySearchResponse.parse(search.json()).items.find((i) => i.id === oppId);
    expect(hit?.activeQuote).toMatchObject({ quoteNumber });
  });
});

describe('blocking vs warning (domain decides, config-driven)', () => {
  it('missing blocking fields → 422 with the field list; nothing is created', async () => {
    const oppId = nextFree();
    const { resin: _r, estAnnualVolume: _v, ...data } = await prefill(oppId);
    const draft = await createDraft(data);
    const res = await submit(draft.id);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: INTAKE_PROBLEM_CODES.incomplete });
    expect(res.json<{ blocking: { field: string }[] }>().blocking.map((b) => b.field)).toEqual([
      'resin',
      'est_annual_volume',
    ]);
    // Free opportunities may carry closed historic quotes, but no active one was created.
    const active = await db.db
      .select()
      .from(schema.quote)
      .where(and(eq(schema.quote.sfOpportunityId, oppId), ne(schema.quote.status, 'closed')));
    expect(active).toHaveLength(0);
  });

  it('the required-field setting is honoured: drop resin from it and the same intake submits', async () => {
    const [before] = await db.db.execute<{ value: unknown }>(
      sql`select value from app_setting where key = 'intake_required_fields'`,
    );
    const withoutResin = (before!.value as { field?: string }[]).filter((r) => r.field !== 'resin');
    await db.db.execute(
      sql`update app_setting set value = ${JSON.stringify(withoutResin)}::jsonb where key = 'intake_required_fields'`,
    );
    try {
      const { resin: _r, ...data } = await prefill(nextFree());
      const draft = await createDraft(data);
      expect(draft.evaluation.ready).toBe(true);
      expect(draft.evaluation.warnings.map((w) => `${w.code}:${w.field}`)).toContain(
        'ENRICH:resin',
      );
      expect((await submit(draft.id)).statusCode).toBe(201);
    } finally {
      await db.db.execute(
        sql`update app_setting set value = ${JSON.stringify(before!.value)}::jsonb where key = 'intake_required_fields'`,
      );
    }
  });

  it('no drawing and a 1,000,000 volume: submit succeeds, with the warnings returned', async () => {
    const data = {
      ...(await prefill(nextFree())),
      drawingStatus: 'NONE',
      estAnnualVolume: 1_000_000,
    };
    const draft = await createDraft(data);
    expect(draft.evaluation.ready).toBe(true);
    const res = await submit(draft.id);
    expect(res.statusCode, res.body).toBe(201);
    const body = SubmitIntakeResponse.parse(res.json());
    expect(body.warnings.map((w) => w.code)).toEqual(['VOLUME_PLACEHOLDER', 'DRAWING_MISSING']);
    expect(body.warnings[1]!.message).toBe('Quotes without a drawing usually take longer.');
  });
});

describe('customer and ship-to', () => {
  it('a changed ship-to needs a reason, and keeps the original on the quote', async () => {
    const data = await prefill(nextFree());
    const moved = { ...data.shipTo!, line1: '99 Co-packer Way', city: 'Elsewhere' };
    const draft = await createDraft({ ...data, shipTo: moved });
    expect(draft.evaluation.blocking.map((b) => b.code)).toEqual(['SHIP_TO_REASON_REQUIRED']);
    expect((await submit(draft.id)).statusCode).toBe(422);

    await kam().patch(`/api/v1/quotes/drafts/${draft.id}`, {
      data: { shipToOverrideReason: 'Filled at the customer’s co-packer' },
    });
    const res = await submit(draft.id);
    expect(res.statusCode, res.body).toBe(201);
    const { quoteId } = SubmitIntakeResponse.parse(res.json());
    const [quote] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, quoteId));
    expect(quote).toMatchObject({
      shipToOverridden: true,
      shipToOverrideReason: 'Filled at the customer’s co-packer',
    });
    expect(quote!.shipTo).toMatchObject({ line1: '99 Co-packer Way' });
    expect(quote!.shipToOriginal).toMatchObject({ line1: data.shipTo!.line1 });
    const activity = await db.db
      .select({ type: schema.activityEvent.type })
      .from(schema.activityEvent)
      .where(eq(schema.activityEvent.quoteId, quoteId));
    expect(activity.map((a) => a.type)).toContain('override_applied');
    // B-09: the ship-to change is a self-applied, logged override row with the original kept.
    const overrides = await db.db
      .select()
      .from(schema.override)
      .where(eq(schema.override.quoteId, quoteId));
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({
      field: 'ship_to',
      status: 'applied',
      approvalMode: 'self',
      justification: 'Filled at the customer’s co-packer',
    });
    expect(overrides[0]!.originalValue).toMatchObject({ line1: data.shipTo!.line1 });
    expect(overrides[0]!.requestedValue).toMatchObject({ line1: '99 Co-packer Way' });
  });

  it('"not yet a Pretium customer" keeps the SF Account and marks the customer (F-007, DEC-27)', async () => {
    const data = await prefill(nextFree());
    const [before] = await db.db
      .select()
      .from(schema.customer)
      .where(eq(schema.customer.sfAccountId, data.customer!.sfAccountId!));
    const draft = await createDraft({
      ...data,
      customer: { ...data.customer!, status: 'not_yet_established' },
    });
    const res = await submit(draft.id);
    expect(res.statusCode, res.body).toBe(201);
    const { quoteId } = SubmitIntakeResponse.parse(res.json());
    const [quote] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, quoteId));
    const [customer] = await db.db
      .select()
      .from(schema.customer)
      .where(eq(schema.customer.id, quote!.customerId!));
    // Nothing typed: the SF Account is the customer, with the KAM's "no ERP account" answer.
    expect(customer).toMatchObject({
      status: 'not_yet_established',
      sfAccountId: data.customer!.sfAccountId,
      location: null,
      contact: null,
    });
    // An already-mirrored account that changes status is audited (before → after).
    const audit = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.entity, 'customer'), eq(schema.auditEvent.entityId, customer!.id)),
      );
    if (before && before.status === 'existing') {
      expect(audit.map((a) => [a.before, a.after])).toContainEqual([
        { status: 'existing' },
        { status: 'not_yet_established', source: 'intake' },
      ]);
    } else {
      expect(before?.id ?? customer!.id).toBe(customer!.id);
    }
  });

  it('only CCQ can be submitted: another class is 422 REQUEST_CLASS_NOT_ALLOWED (F-067, T-027)', async () => {
    const data = await prefill(nextFree());
    const draft = await createDraft({ ...data, requestClass: 'STOCK' });
    expect(draft.evaluation.blocking).toEqual([
      {
        code: 'REQUEST_CLASS_NOT_ALLOWED',
        field: 'request_class',
        message:
          'Stock, stock-plus, price inquiries and pack-out evaluations stay in the pricing application for now. Submit them there.',
      },
    ]);
    const res = await submit(draft.id);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: INTAKE_PROBLEM_CODES.requestClassNotAllowed,
      blocking: [{ code: 'REQUEST_CLASS_NOT_ALLOWED' }],
    });
    // No quote was created; switching back to CCQ submits.
    await kam().patch(`/api/v1/quotes/drafts/${draft.id}`, { data: { requestClass: 'CCQ' } });
    expect((await submit(draft.id)).statusCode).toBe(201);
  });

  it('need-by dates: Quote needed by after today, Product needed by on or after it (F-009)', async () => {
    const data = await prefill(nextFree());
    const past = await createDraft({ ...data, quoteNeededBy: '2026-10-16' });
    expect(past.evaluation.blocking.map((b) => `${b.code}:${b.field}`)).toEqual([
      'INVALID_VALUE:quote_needed_by',
    ]);
    expect((await submit(past.id)).statusCode).toBe(422);
    const order = await kam().patch(`/api/v1/quotes/drafts/${past.id}`, {
      data: { quoteNeededBy: '2027-01-10', productNeededBy: '2027-01-09' },
    });
    expect(
      IntakeDraft.parse(order.json()).evaluation.blocking.map((b) => `${b.code}:${b.field}`),
    ).toEqual(['INVALID_VALUE:product_needed_by']);
    const missing = await kam().patch(`/api/v1/quotes/drafts/${past.id}`, {
      data: { quoteNeededBy: null, productNeededBy: null },
    });
    expect(
      IntakeDraft.parse(missing.json()).evaluation.blocking.map((b) => `${b.code}:${b.field}`),
    ).toEqual(['MISSING_FIELD:quote_needed_by', 'MISSING_FIELD:product_needed_by']);
  });

  it('an opportunity with no Salesforce Account cannot be submitted (F-007, D-011)', async () => {
    const data = await prefill(nextFree());
    const draft = await createDraft({
      ...data,
      customer: { status: 'existing', sfAccountId: null, name: 'Typed name' },
    });
    expect(draft.evaluation.blocking.map((b) => b.code)).toContain('SF_ACCOUNT_REQUIRED');
    const res = await submit(draft.id);
    expect(res.statusCode).toBe(422);
  });
});

describe('product facts (FB-02 §3–4: F-010, F-011, F-055, F-023, F-075, F-013)', () => {
  it('stores the neck lists, resin grade, PCR, color, variants and follow-ups; Engineering and Pricing see them (T-013)', async () => {
    const data = {
      ...(await prefill(nextFree())),
      neckDiameter: 'CUSTOM',
      neckDiameterCustom: '31 mm',
      neckFinishType: 'SNAP',
      neckSpecialFeature: 'TAMPER_EVIDENT',
      resinCustomerSpecified: true,
      resinGrade: 'LyondellBasell Pro-fax 6331',
      pcrLevel: '25',
      colorType: 'CUSTOM',
      colorDescription: 'Pantone 286 C',
      additives: 'UV inhibitor',
      quoteVariantsNote: 'Price at 0/25/50% PCR; near-site vs ideal-site',
      components: ['CONTAINER', 'LINER', 'DECORATION'],
      linerSpec: 'Induction seal',
      decorationType: 'SILK_SCREEN',
      decorationPrintColors: 2,
    };
    const draft = await createDraft(data);
    expect(draft.evaluation.blocking).toEqual([]);
    const res = await submit(draft.id);
    expect(res.statusCode, res.body).toBe(201);
    const { quoteId, quoteNumber } = SubmitIntakeResponse.parse(res.json());
    const [quote] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, quoteId));
    expect(quote).toMatchObject({
      neckDiameter: 'CUSTOM',
      neckDiameterCustom: '31 mm',
      neckFinishType: 'SNAP',
      neckFinishTypeCustom: null,
      neckSpecialFeature: 'TAMPER_EVIDENT',
      neckFinish: null, // the old single field is no longer written
      resinCustomerSpecified: true,
      resinGrade: 'LyondellBasell Pro-fax 6331',
      pcrLevel: '25',
      colorType: 'CUSTOM',
      colorDescription: 'Pantone 286 C',
      additives: 'UV inhibitor',
      quoteVariantsNote: 'Price at 0/25/50% PCR; near-site vs ideal-site',
      linerSpec: 'Induction seal',
      labelsPurchasedBy: null,
      decorationType: 'SILK_SCREEN',
      decorationPrintColors: 2,
    });
    for (const role of ['Engineer', 'EngLead', 'Pricing', 'PricingLead'] as const) {
      const detail = await asRole(app, role).get(`/api/v1/quotes/${quoteNumber}`);
      expect(detail.statusCode, `${role} ${detail.body}`).toBe(200);
      expect(QuoteDetail.parse(detail.json()).intakeFacts).toMatchObject({
        resinCustomerSpecified: true,
        resinGrade: 'LyondellBasell Pro-fax 6331',
        colorDescription: 'Pantone 286 C',
        additives: 'UV inhibitor',
        quoteVariantsNote: 'Price at 0/25/50% PCR; near-site vs ideal-site',
      });
    }
  });

  it('a Custom value, a customer-specified resin and a picked component each need their field', async () => {
    const data = {
      ...(await prefill(nextFree())),
      neckFinishType: 'CUSTOM',
      resinCustomerSpecified: true,
      colorType: 'CUSTOM',
      components: ['LABEL', 'DECORATION'],
      decorationPrintColors: 13,
    };
    const draft = await createDraft(data);
    expect(draft.evaluation.blocking.map((b) => `${b.code}:${b.field}`)).toEqual([
      'MISSING_FIELD:neck_finish_type_custom',
      'MISSING_FIELD:color_description',
      'MISSING_FIELD:resin_grade',
      'MISSING_FIELD:labels_purchased_by',
      'MISSING_FIELD:decoration_type',
      'INVALID_VALUE:decoration_print_colors',
    ]);
    expect((await submit(draft.id)).statusCode).toBe(422);
  });

  it('values that no longer apply are cleared on submit (deselected component, unticked resin)', async () => {
    const data = {
      ...(await prefill(nextFree())),
      // Left over from earlier edits in the draft:
      neckFinishTypeCustom: 'stale',
      colorType: 'NATURAL',
      colorDescription: 'stale blue',
      resinCustomerSpecified: false,
      resinGrade: 'stale grade',
      components: ['CONTAINER'],
      linerSpec: 'stale liner',
      decorationPrintColors: 3,
    };
    const draft = await createDraft(data);
    expect(draft.evaluation.blocking).toEqual([]);
    const { quoteId } = SubmitIntakeResponse.parse((await submit(draft.id)).json());
    const [quote] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, quoteId));
    expect(quote).toMatchObject({
      neckFinishTypeCustom: null,
      colorDescription: null,
      resinGrade: null,
      linerSpec: null,
      decorationPrintColors: null,
    });
  });
});

describe('draft visibility: creator plus Admin', () => {
  let draftId = '';

  beforeAll(async () => {
    draftId = (await createDraft({ sfOpportunityId: free[0]! })).id;
  });

  it('another KAM or a SalesLeader cannot see it (404)', async () => {
    expect(
      (await asRole(app, 'KAM', 'owner').get(`/api/v1/quotes/drafts/${draftId}`)).statusCode,
    ).toBe(404);
    expect(
      (await asRole(app, 'SalesLeader').get(`/api/v1/quotes/drafts/${draftId}`)).statusCode,
    ).toBe(404);
    const theirs = IntakeDraftListResponse.parse(
      (await asRole(app, 'KAM', 'owner').get('/api/v1/quotes/drafts?mine=false')).json(),
    );
    expect(theirs.items.map((i) => i.id)).not.toContain(draftId);
  });

  it('Admin can see it and list everyone’s, but cannot change, submit or delete it', async () => {
    const admin = asRole(app, 'Admin');
    expect((await admin.get(`/api/v1/quotes/drafts/${draftId}`)).statusCode).toBe(200);
    const all = IntakeDraftListResponse.parse(
      (await admin.get('/api/v1/quotes/drafts?mine=false')).json(),
    );
    expect(all.items.map((i) => i.id)).toContain(draftId);
    const patch = await admin.patch(`/api/v1/quotes/drafts/${draftId}`, { step: 2 });
    expect(patch.statusCode).toBe(403);
    expect(patch.json()).toMatchObject({ code: INTAKE_PROBLEM_CODES.notOwner });
    expect((await submit(draftId, 'Admin')).statusCode).toBe(403);
    expect((await admin.delete(`/api/v1/quotes/drafts/${draftId}`)).statusCode).toBe(403);
  });

  it('the owner deletes it (audited); afterwards it is gone', async () => {
    expect((await kam().delete(`/api/v1/quotes/drafts/${draftId}`)).statusCode).toBe(204);
    expect((await kam().get(`/api/v1/quotes/drafts/${draftId}`)).statusCode).toBe(404);
    const audit = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.entity, 'quote_draft'), eq(schema.auditEvent.entityId, draftId)),
      );
    expect(audit.map((a) => a.action).sort()).toEqual(['create', 'update']);
  });

  it('roles without quote.create are refused', async () => {
    expect(
      (await asRole(app, 'Engineer').post('/api/v1/quotes/drafts', { data: {} })).statusCode,
    ).toBe(403);
    expect((await asRole(app, 'Pricing').get('/api/v1/quotes/drafts')).statusCode).toBe(403);
  });
});

describe('routing with G1 disabled', () => {
  it('submit goes straight to the engineering queue through the SUBMIT gate', async () => {
    await db.db.execute(
      sql`update gate_definition set enabled = (key = 'SUBMIT') where key in ('G1', 'SUBMIT')`,
    );
    try {
      const draft = await createDraft(await prefill(nextFree()));
      const res = await submit(draft.id);
      expect(res.statusCode, res.body).toBe(201);
      const body = SubmitIntakeResponse.parse(res.json());
      expect(body).toMatchObject({ stageKey: 'ENG_REVIEW', routedTo: 'ENG_REVIEW' });
      const decisions = await db.db
        .select()
        .from(schema.gateDecision)
        .where(eq(schema.gateDecision.quoteId, body.quoteId));
      expect(decisions.map((d) => [d.gateKey, d.outcomeKey])).toEqual([['SUBMIT', 'submit']]);
      const history = await db.db
        .select()
        .from(schema.stageHistory)
        .where(eq(schema.stageHistory.quoteId, body.quoteId));
      expect(history.map((h) => h.stageKey).sort()).toEqual(['ENG_REVIEW', 'INTAKE']);
    } finally {
      await db.db.execute(
        sql`update gate_definition set enabled = (key = 'G1') where key in ('G1', 'SUBMIT')`,
      );
    }
  });
});
