import {
  INTAKE_PROBLEM_CODES,
  IntakeDraft,
  IntakeDraftListResponse,
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
    neckFinish: '38-400',
    packagingType: 'BULK',
    packagingNotes: 'Corner boards',
    estAnnualVolume: 750_000,
    estAnnualRevenue: sf.opportunity.amount,
    estAnnualRevenueSf: sf.opportunity.amount,
    expectedCloseDate: sf.opportunity.closeDate,
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
    expect(body.priorityScore).toBeNull(); // B-08 hook
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
      neckFinish: '38-400',
      estAnnualVolume: 750_000,
      requestClass: 'CCQ',
      shipToOverridden: false,
      priorityScore: null,
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
    const setting = sql`update app_setting set value = value - 4 where key = 'intake_required_fields'`;
    // index 4 = present('resin') in the seed
    const [before] = await db.db.execute<{ value: unknown }>(
      sql`select value from app_setting where key = 'intake_required_fields'`,
    );
    await db.db.execute(setting);
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
    expect(activity.map((a) => a.type)).toContain('ship_to_overridden');
  });

  it('a not-yet-established customer gets name, location and contact only (DEC-27)', async () => {
    const data = await prefill(nextFree());
    const draft = await createDraft({
      ...data,
      customer: {
        status: 'not_yet_established',
        name: 'Brand New Beverage Co (synthetic)',
        location: 'Austin, TX',
        contactName: 'Pat Buyer',
        contactEmail: 'pat@example.com',
      },
    });
    const res = await submit(draft.id);
    expect(res.statusCode, res.body).toBe(201);
    const { quoteId } = SubmitIntakeResponse.parse(res.json());
    const [quote] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, quoteId));
    const [customer] = await db.db
      .select()
      .from(schema.customer)
      .where(eq(schema.customer.id, quote!.customerId!));
    expect(customer).toMatchObject({
      status: 'not_yet_established',
      sfAccountId: null,
      source: 'intake',
      location: 'Austin, TX',
      contact: { name: 'Pat Buyer', email: 'pat@example.com', phone: null },
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
