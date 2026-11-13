/**
 * FB-09 (Danielle Leu, 2026-11-09): "Other" resin, PCR level or additive asks for the customer-specified
 * value. Required to submit (not to save a draft), cleared when "Other" is unpicked, shown to every role
 * that reads the quote. Retired resins keep their code and show "(no longer offered)". D-006 is untouched.
 * Its own database so the free SF opportunities go further.
 */
import {
  IntakeDraft,
  PublicConfigResponse,
  QuoteDetail,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import { eq, sql } from 'drizzle-orm';
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
    subMarket: 'FOOD_SNACKS', // FB-15 (W13-02): required
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
  const fresh = await freshSfDatabase('intake_fb09');
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

describe('"Other" resin, PCR level and additive (FB-09)', () => {
  const blocking = (d: { evaluation: { blocking: { code: string; field: string }[] } }) =>
    d.evaluation.blocking.map((b) => `${b.code}:${b.field}`);

  it('Resin = Other blocks the submit (422, field named) until the resin and grade is given', async () => {
    const draft = await createDraft({ ...(await prefill(nextFree())), resin: 'OTHER' });
    expect(blocking(draft)).toEqual(['MISSING_FIELD:resin_grade']);
    const refused = await submit(draft.id);
    expect(refused.statusCode).toBe(422);
    expect(refused.body).toContain('resin_grade');
    // Save-as-draft is not blocked: the draft above was stored with the detail missing.
    const ok = await submitQuote({ resin: 'OTHER', resinGrade: 'Eastman Tritan TX1001' });
    expect(ok.quote).toMatchObject({
      resin: 'OTHER',
      resinGrade: 'Eastman Tritan TX1001',
      resinCustomerSpecified: false, // independent of the checkbox
    });
  });

  it('the grade is cleared when Other is unpicked, kept for a customer-specified resin', async () => {
    const cleared = await submitQuote({ resin: 'PET', resinGrade: 'stale grade' });
    expect(cleared.quote.resinGrade).toBeNull();
    const kept = await submitQuote({
      resin: 'PET',
      resinCustomerSpecified: true,
      resinGrade: 'Pro-fax 6331',
    });
    expect(kept.quote).toMatchObject({ resin: 'PET', resinGrade: 'Pro-fax 6331' });
  });

  it('PCR = Other needs pcr_level_other; it is stored only while Other is picked', async () => {
    const draft = await createDraft({ ...(await prefill(nextFree())), pcrLevel: 'OTHER' });
    expect(blocking(draft)).toEqual(['MISSING_FIELD:pcr_level_other']);
    expect((await submit(draft.id)).statusCode).toBe(422);
    const other = await submitQuote({ pcrLevel: 'OTHER', pcrLevelOther: '35% PCR' });
    expect(other.quote).toMatchObject({ pcrLevel: 'OTHER', pcrLevelOther: '35% PCR' });
    const thirty = await submitQuote({ pcrLevel: '30', pcrLevelOther: 'stale' });
    expect(thirty.quote).toMatchObject({ pcrLevel: '30', pcrLevelOther: null });
  });

  it('Additive = Other needs the additives note; any other choice leaves it optional', async () => {
    const draft = await createDraft({ ...(await prefill(nextFree())), additive: 'OTHER' });
    expect(blocking(draft)).toEqual(['MISSING_FIELD:additives']);
    expect((await submit(draft.id)).statusCode).toBe(422);
    const other = await submitQuote({ additive: 'OTHER', additives: 'Customer nucleating agent' });
    expect(other.quote).toMatchObject({
      additive: 'OTHER',
      additives: 'Customer nucleating agent',
    });
    const uv = await submitQuote({ additive: 'UV' });
    expect(uv.quote).toMatchObject({ additive: 'UV', additives: null });
    const noted = await submitQuote({ additive: 'BARRIER', additives: 'EVOH, 5%' });
    expect(noted.quote).toMatchObject({ additive: 'BARRIER', additives: 'EVOH, 5%' });
  });

  it('every role that reads the quote sees the values (rule 2)', async () => {
    const { quoteNumber } = await submitQuote({
      resin: 'OTHER',
      resinGrade: 'Eastman Tritan TX1001',
      pcrLevel: 'OTHER',
      pcrLevelOther: '35% PCR',
      additive: 'OTHER',
      additives: 'Customer nucleating agent',
    });
    for (const role of ALL_ROLES) {
      const detail = await asRole(app, role).get(`/api/v1/quotes/${quoteNumber}`);
      if (detail.statusCode === 403 || detail.statusCode === 404) continue; // out of that role's scope
      expect(detail.statusCode, `${role} ${detail.body}`).toBe(200);
      expect(QuoteDetail.parse(detail.json()).intakeFacts, role).toMatchObject({
        resinGrade: 'Eastman Tritan TX1001',
        pcrLevelOther: '35% PCR',
        additive: 'OTHER',
        additives: 'Customer nucleating agent',
      });
    }
  });

  it('does not change the required fields (D-006 stays a proposal)', async () => {
    const res = await kam().get('/api/v1/config/public');
    const config = PublicConfigResponse.parse(res.json());
    const required = JSON.stringify(config.settings.intake_required_fields ?? []);
    for (const f of ['pcr_level', 'additive', 'additives', 'resin_grade', 'pcr_level_other']) {
      expect(required).not.toContain(f);
    }
  });

  it('serves the lists, and the labels of retired entries for old quotes', async () => {
    await db.db.execute(
      sql`update value_list set active = false where list_key = 'resin' and code = 'PS'`,
    );
    const res = await kam().get('/api/v1/config/public');
    const config = PublicConfigResponse.parse(res.json());
    expect(config.valueLists.additive?.map((e) => e.label)).toEqual([
      'None',
      'UV',
      'Barrier',
      'Antistat',
      'Impact Modifier',
      'Fluorination', // FB-15 (W13-08, provisional)
      'Other',
    ]);
    expect(config.valueLists.pcr_level?.map((e) => e.label)).toEqual([
      '0% / Virgin',
      '25%',
      '30%',
      '50%',
      '100%',
      'Other',
    ]);
    expect(config.valueLists.resin?.map((e) => e.label)).toEqual([
      'PET',
      'HDPE',
      'PP',
      'LDPE',
      'Other',
    ]);
    expect(config.retiredValues?.resin).toEqual({ PS: 'PS' });
    await db.db.execute(
      sql`update value_list set active = true where list_key = 'resin' and code = 'PS'`,
    );
  });
});
