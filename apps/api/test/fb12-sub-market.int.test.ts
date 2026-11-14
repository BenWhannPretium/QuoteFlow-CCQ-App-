/**
 * FB-12 (F-020, F-073, T-036; D-004 open): the market list, the optional sub-market at intake, and the
 * inactive v3 draft scoring by sub-market. No new route: the lists come through `/config/public`, the
 * sub-market rides on the intake draft and the quote. The tests run in order: they share one database.
 */
import {
  AdminScoringResponse,
  IntakeDraft,
  PublicConfigResponse,
  QuoteDetail,
  ScoringPreviewResponse,
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

let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
const clock = new Date('2026-11-10T15:00:00Z');

let free: string[] = [];
const nextFree = () => {
  const id = free.shift();
  if (!id) throw new Error('test ran out of free opportunities');
  return id;
};

const kam = () => asRole(app, 'KAM');
const admin = () => asRole(app, 'Admin');
const ALL_ROLES: Role[] = [
  'KAM',
  'SalesLeader',
  'EngLead',
  'Engineer',
  'Pricing',
  'PricingLead',
  'Finance',
  'Approver',
  'Leadership',
  'Admin',
];

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
    requestedPaymentTerms: 'NET_30',
    priceBasis: 'FOB_PLANT',
  };
}

async function createDraft(extra: IntakeDraftData) {
  const res = await kam().post('/api/v1/quotes/drafts', {
    data: { ...(await prefill(nextFree())), ...extra },
  });
  expect(res.statusCode, res.body).toBe(201);
  return IntakeDraft.parse(res.json());
}

async function submitQuote(extra: IntakeDraftData) {
  const draft = await createDraft(extra);
  expect(draft.evaluation.blocking).toEqual([]);
  const res = await kam().post(`/api/v1/quotes/drafts/${draft.id}/submit`);
  expect(res.statusCode, res.body).toBe(201);
  const out = SubmitIntakeResponse.parse(res.json());
  const [quote] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, out.quoteId));
  return { ...out, draft, quote: quote! };
}

const detailAs = async (role: Role, quoteNumber: string) =>
  asRole(app, role).get(`/api/v1/quotes/${quoteNumber}`);

/**
 * FB-15 (W13-02): Sub-market is required by config (`intake_required_fields`, provisional). Runs `fn` with
 * that one rule removed, as an Admin may (and as before FB-15), then puts the setting back.
 */
async function withoutSubMarketRule<T>(fn: () => Promise<T>): Promise<T> {
  const key = eq(schema.appSetting.key, 'intake_required_fields');
  const [row] = await db.db.select().from(schema.appSetting).where(key);
  const rules = row!.value as { field: string }[];
  await db.db
    .update(schema.appSetting)
    .set({ value: rules.filter((r) => r.field !== 'sub_market') })
    .where(key);
  try {
    return await fn();
  } finally {
    await db.db.update(schema.appSetting).set({ value: rules }).where(key);
  }
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('fb12');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url }), { db, now: () => clock });
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

describe('the lists (F-020)', () => {
  it('offers Melanie Rasche’s 8 markets in her order and her 30 sub-markets, each under a market', async () => {
    for (const role of ALL_ROLES) {
      const res = await asRole(app, role).get('/api/v1/config/public');
      expect(res.statusCode, role).toBe(200);
    }
    const config = PublicConfigResponse.parse((await kam().get('/api/v1/config/public')).json());
    const markets = config.valueLists.market!;
    expect(markets.map((m) => m.code)).toEqual([
      'FOOD',
      'BEVERAGE',
      'NUTRITION_WELLNESS',
      'OTC_HEALTH',
      'CLINICAL',
      'PERSONAL_CARE',
      'HOME_CARE',
      'AUTO_COMMERCIAL_CHEMICAL',
    ]);
    const subs = config.valueLists.sub_market!;
    expect(subs).toHaveLength(30);
    const codes = new Set(markets.map((m) => m.code));
    expect(subs.every((s) => codes.has(String(s.meta.market)))).toBe(true);
    expect(subs.find((s) => s.code === 'FOOD_SNACKS')).toMatchObject({
      label: 'Snacks & Confections',
      meta: { market: 'FOOD' },
    });
    // The five old codes are not offered, but their labels are kept for old quotes.
    expect(markets.map((m) => m.code)).not.toContain('PHARMA_HEALTH');
    expect(config.retiredValues!.market).toMatchObject({
      NUTRITION: 'Nutrition/Supplements',
      HOUSEHOLD_CHEMICAL: 'Household Chemical',
      PHARMA_HEALTH: 'Pharma/Health',
      INDUSTRIAL_CHEMICAL: 'Industrial/Chemical',
      PET: 'Pet',
    });
    // FB-15 (W13-02, D-006 owner Bailey Schmitt, 2026-11-13): the sub-market is required now (it was
    // optional under FB-12), and its help names the Midas term for Spirits & Mixers (W13-11).
    const required = JSON.stringify(config.settings.intake_required_fields);
    expect(required).toContain('"sub_market"');
    expect((config.settings.intake_field_help as Record<string, string>).sub_market).toBe(
      'Pick the closest sub-market. It sets the strategic-fit score. Beverage › Spirits & Mixers covers alcoholic drinks (Midas calls it Alcoholic).',
    );
  });
});

describe('the sub-market on the intake and the quote (F-073)', () => {
  let snacks: Awaited<ReturnType<typeof submitQuote>>;
  let honey: Awaited<ReturnType<typeof submitQuote>>;

  it('is saved on the quote with its market, shown to every role that can read the quote, and audited', async () => {
    snacks = await submitQuote({ market: 'FOOD', subMarket: 'FOOD_SNACKS' });
    expect(snacks.quote.market).toBe('FOOD');
    expect(snacks.quote.subMarket).toBe('FOOD_SNACKS');

    let readers = 0;
    for (const role of ALL_ROLES) {
      const res = await detailAs(role, snacks.quoteNumber);
      if (res.statusCode !== 200) {
        expect([403, 404], role).toContain(res.statusCode);
        continue;
      }
      readers += 1;
      const detail = QuoteDetail.parse(res.json());
      expect(detail.subMarket, role).toBe('FOOD_SNACKS');
      expect(detail.market, role).toBe('FOOD');
      // Engineering's product facts read "Food › Snacks & Confections" (rule 2: no role is hidden from it).
      expect(
        detail.engineering.productFacts.find((f) => f.key === 'market'),
        role,
      ).toMatchObject({ label: 'Market', value: 'Food › Snacks & Confections' });
    }
    expect(readers).toBeGreaterThanOrEqual(8);

    const [event] = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.entity, 'quote'),
          eq(schema.auditEvent.entityId, snacks.quote.id),
          eq(schema.auditEvent.action, 'create'),
        ),
      );
    expect(event!.after).toMatchObject({ market: 'FOOD', subMarket: 'FOOD_SNACKS' });
  });

  it('FB-15 (W13-02): is required; without the rule (an Admin may remove it) a quote with no sub-market submits, scoring the neutral 50', async () => {
    const blank = await createDraft({ market: 'BEVERAGE', subMarket: null });
    expect(blank.evaluation.blocking.map((b) => `${b.code}:${b.field}`)).toEqual([
      'MISSING_FIELD:sub_market',
    ]);
    expect((await kam().post(`/api/v1/quotes/drafts/${blank.id}/submit`)).statusCode).toBe(422);
    // The rule is config (provisional): with it removed, as before FB-15, the same draft submits. (One
    // opportunity, as before, so the later tests still get the opportunities they expect.)
    const res = await withoutSubMarketRule(() =>
      kam().post(`/api/v1/quotes/drafts/${blank.id}/submit`),
    );
    expect(res.statusCode, res.body).toBe(201);
    const out = SubmitIntakeResponse.parse(res.json());
    const [row] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, out.quoteId));
    const none = { ...out, quote: row! };
    expect(none.quote.subMarket).toBeNull();
    const detail = QuoteDetail.parse((await detailAs('SalesLeader', none.quoteNumber)).json());
    expect(detail.subMarket).toBeNull();
    const fit = detail.priority.breakdown.find((b) => b.key === 'strategic_fit')!;
    expect(fit.points).toBe(50);
    const [event] = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.entity, 'quote'),
          eq(schema.auditEvent.entityId, none.quote.id),
          eq(schema.auditEvent.action, 'create'),
        ),
      );
    expect(event!.after).toMatchObject({ market: 'BEVERAGE', subMarket: null });
  });

  it('must belong to the quote’s market: the draft says so and the submit answers 422 naming subMarket', async () => {
    for (const data of [
      { market: 'BEVERAGE', subMarket: 'FOOD_SNACKS' }, // another market's sub-market
      { market: 'FOOD', subMarket: 'NOT_A_SUB_MARKET' }, // not on the list
      { market: null, subMarket: 'FOOD_SNACKS' }, // no market at all
    ] as IntakeDraftData[]) {
      const draft = await createDraft(data);
      expect(
        draft.evaluation.blocking.find((b) => b.field === 'sub_market'),
        JSON.stringify(data),
      ).toMatchObject({ code: 'INVALID_VALUE' });
      const res = await kam().post(`/api/v1/quotes/drafts/${draft.id}/submit`);
      expect(res.statusCode, JSON.stringify(data)).toBe(422);
      const body = res.json<{ errors?: { path: string }[] }>();
      expect(body.errors?.map((e) => e.path)).toContain('subMarket');
    }
  });

  it('is cleared on the server when the market changes to one it does not belong to', async () => {
    const draft = await createDraft({ market: 'FOOD', subMarket: 'FOOD_OILS' });
    expect(draft.data.subMarket).toBe('FOOD_OILS');
    const patch = (data: IntakeDraftData) =>
      kam().patch(`/api/v1/quotes/drafts/${draft.id}`, { data });
    // Same market, other fields: kept.
    let res = await patch({ containerSize: '12 oz' });
    expect(IntakeDraft.parse(res.json()).data.subMarket).toBe('FOOD_OILS');
    // The market is re-sent unchanged: kept.
    res = await patch({ market: 'FOOD' });
    expect(IntakeDraft.parse(res.json()).data.subMarket).toBe('FOOD_OILS');
    // A different market, with the old sub-market still sent: cleared.
    res = await patch({ market: 'BEVERAGE', subMarket: 'FOOD_OILS' });
    expect(res.statusCode, res.body).toBe(200);
    const cleared = IntakeDraft.parse(res.json());
    expect(cleared.data.market).toBe('BEVERAGE');
    expect(cleared.data.subMarket ?? null).toBeNull();
    // FB-15 (W13-02): it is required now, so the blank is asked for; it no longer "does not belong".
    expect(
      cleared.evaluation.blocking.filter((b) => b.field === 'sub_market').map((b) => b.code),
    ).toEqual(['MISSING_FIELD']);
    // A sub-market of the new market is kept when it is sent with the change.
    res = await patch({ market: 'FOOD', subMarket: 'FOOD_SPICES' });
    expect(IntakeDraft.parse(res.json()).data.subMarket).toBe('FOOD_SPICES');
    // Clearing the market clears the sub-market.
    res = await patch({ market: null });
    expect(IntakeDraft.parse(res.json()).data.subMarket ?? null).toBeNull();
  });

  it('T-036: two quotes identical except sub-market score the same live, and differently under the inactive draft', async () => {
    honey = await submitQuote({ market: 'FOOD', subMarket: 'FOOD_HONEY_SWEETENERS' });
    const live = async (qn: string) => {
      const d = QuoteDetail.parse((await detailAs('SalesLeader', qn)).json());
      return {
        score: d.priority.score,
        modelVersion: d.priority.modelVersion,
        fit: d.priority.breakdown.find((b) => b.key === 'strategic_fit')!,
      };
    };
    const a = await live(snacks.quoteNumber);
    const b = await live(honey.quoteNumber);
    expect(a.fit.points).toBe(50);
    expect(b.fit.points).toBe(50);
    expect(a.score).toBe(b.score); // identical under the live model (v2)
    expect(a.modelVersion).toBe(b.modelVersion);

    // The draft is inactive: still a draft, still FB-12's, and the live model is the one that scored.
    const versions = AdminScoringResponse.parse(
      (await admin().get('/api/v1/admin/config/scoring')).json(),
    ).versions;
    const draft = versions.find((v) => v.status === 'draft')!;
    const active = versions.find((v) => v.status === 'active')!;
    expect(draft.changeReason).toMatch(/^FB-12/);
    expect(draft.approval.provisional).toBe(true);
    expect(a.modelVersion).toBe(active.modelVersion);

    // The preview (Leadership and Admin) shows them apart: Snacks up, Honey down, by .15 × 30.
    const res = await asRole(app, 'Leadership').get('/api/v1/admin/config/scoring/draft/preview');
    expect(res.statusCode, res.body).toBe(200);
    const p = ScoringPreviewResponse.parse(res.json());
    const row = (qn: string) => p.rows.find((r) => r.quoteNumber === qn)!;
    expect(row(snacks.quoteNumber)).toMatchObject({
      market: 'FOOD',
      subMarket: 'FOOD_SNACKS',
      pointsMoved: 4.5,
    });
    expect(row(honey.quoteNumber)).toMatchObject({
      market: 'FOOD',
      subMarket: 'FOOD_HONEY_SWEETENERS',
      pointsMoved: -4.5,
    });
    expect(row(snacks.quoteNumber).drivers).toEqual([
      expect.objectContaining({ key: 'strategic_fit', before: 50, after: 80 }),
    ]);
    // A quote with no sub-market does not move at all.
    const none = p.rows.filter((r) => r.market && !r.subMarket);
    expect(none.length).toBeGreaterThan(0);
    expect(none.every((r) => r.pointsMoved === 0)).toBe(true);
    // Synthetic quotes carry sub-markets too, so the preview moves some of them.
    expect(p.rows.some((r) => r.subMarket !== null && r.pointsMoved !== 0)).toBe(true);
  });
});

describe('a quote on a retired market (F-020)', () => {
  it('keeps its market code; the lists still know its label; nothing remaps it', async () => {
    const q = await submitQuote({ market: 'FOOD' });
    // A quote from before FB-12 carries a retired market and no sub-market.
    await db.db
      .update(schema.quote)
      .set({ market: 'PHARMA_HEALTH', subMarket: null })
      .where(eq(schema.quote.id, q.quote.id));
    const detail = QuoteDetail.parse((await detailAs('Engineer', q.quoteNumber)).json());
    expect(detail.market).toBe('PHARMA_HEALTH');
    expect(detail.engineering.productFacts.find((f) => f.key === 'market')!.value).toBe(
      'Pharma/Health (no longer offered)',
    );
    const config = PublicConfigResponse.parse((await kam().get('/api/v1/config/public')).json());
    expect(config.retiredValues!.market!.PHARMA_HEALTH).toBe('Pharma/Health');
    // Reading it changed nothing.
    const [row] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, q.quote.id));
    expect(row!.market).toBe('PHARMA_HEALTH');
  });
});

/**
 * DR-cross-cutting-02 / DR-kam-sales-leader-06 (Sev-2): every list-backed intake field is checked against
 * the ACTIVE value-list codes on the server, at draft save (new writes) and at submit, with the sub-market
 * check's wording. A quote that already holds a retired value still loads, and its rework keeps it.
 */
describe('DR-cross-cutting-02: intake value lists are checked on the server', () => {
  const BAD: [field: string, value: unknown, message: string][] = [
    ['market', 'ZZZ_NOT_A_MARKET', 'Pick a market from the list'],
    ['market', 'PHARMA_HEALTH', 'Pick a market from the list'], // retired by FB-12
    ['resin', 'UNOBTAINIUM', 'Pick a resin from the list'],
    ['productFamily', 'SPACESHIP', 'Pick a product family from the list'],
    ['neckDiameter', '9999', 'Pick a neck diameter from the list'],
    ['pcrLevel', '77', 'Pick a PCR level from the list'],
    ['packagingType', 'LASER', 'Pick a packaging type from the list'],
    ['components', ['CONTAINER', 'WARP_DRIVE'], 'Pick a component from the list'],
  ];

  it.each(BAD)('a new draft with %s = %j is refused (422)', async (field, value, message) => {
    const res = await kam().post('/api/v1/quotes/drafts', {
      data: { ...(await prefill(free[0]!)), [field]: value },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({
      code: 'invalid_list_value',
      errors: [{ path: field, message }],
    });
  });

  it('a draft save that writes an unknown code is refused; the stored draft is unchanged', async () => {
    const draft = await createDraft({});
    const res = await kam().patch(`/api/v1/quotes/drafts/${draft.id}`, {
      data: { market: 'ZZZ_NOT_A_MARKET' },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json()).toMatchObject({ errors: [{ path: 'market' }] });
    const [row] = await db.db
      .select()
      .from(schema.quoteDraft)
      .where(eq(schema.quoteDraft.id, draft.id));
    expect((row!.data as IntakeDraftData).market).toBe('FOOD');
    // A save that does not touch the list fields still works.
    const ok = await kam().patch(`/api/v1/quotes/drafts/${draft.id}`, {
      data: { bidReference: 'BID-1' },
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('submit refuses a draft that holds an unknown code (written before the check)', async () => {
    const draft = await createDraft({});
    await db.db
      .update(schema.quoteDraft)
      .set({ data: { ...draft.data, resin: 'UNOBTAINIUM' } })
      .where(eq(schema.quoteDraft.id, draft.id));
    const res = await kam().post(`/api/v1/quotes/drafts/${draft.id}/submit`);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json<{ errors: { path: string; message: string }[] }>().errors).toContainEqual({
      path: 'resin',
      message: 'Pick a resin from the list',
    });
  });

  it('a quote on a retired value still loads, and its rework keeps the value', async () => {
    const q = await submitQuote({ market: 'FOOD' });
    await db.db
      .update(schema.quote)
      .set({ market: 'PHARMA_HEALTH', subMarket: null })
      .where(eq(schema.quote.id, q.quote.id));
    expect((await detailAs('KAM', q.quoteNumber)).statusCode).toBe(200);
    // Send it back to the KAM, open the rework draft, change something else and resubmit.
    const back = await asRole(app, 'SalesLeader').post(
      `/api/v1/quotes/${q.quoteNumber}/gates/G1/decisions`,
      { outcomeKey: 'rework', reasonCode: 'missing_information', note: 'Add the bid reference' },
    );
    expect(back.statusCode, back.body).toBe(201);
    const rework = await kam().post(`/api/v1/quotes/${q.quoteNumber}/rework`);
    expect(rework.statusCode, rework.body).toBeLessThan(300);
    const draft = IntakeDraft.parse(rework.json());
    const patched = await kam().patch(`/api/v1/quotes/drafts/${draft.id}`, {
      data: { market: 'PHARMA_HEALTH', bidReference: 'BID-2' },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(
      IntakeDraft.parse(patched.json()).evaluation.blocking.filter((b) => b.field === 'market'),
    ).toEqual([]);
  });
});

/** DR-kam-sales-leader-05: a draft save from an older copy (another tab saved since) is refused. */
describe('DR-kam-sales-leader-05: draft version check', () => {
  it('a save made from an older copy gets 409 and changes nothing', async () => {
    const draft = await createDraft({});
    const tab1 = await kam().patch(`/api/v1/quotes/drafts/${draft.id}`, {
      data: { bidReference: 'FROM-TAB-1' },
      expectedUpdatedAt: draft.updatedAt,
    });
    expect(tab1.statusCode, tab1.body).toBe(200);
    // Tab 2 still holds the first copy.
    const tab2 = await kam().patch(`/api/v1/quotes/drafts/${draft.id}`, {
      data: { bidReference: 'FROM-TAB-2' },
      expectedUpdatedAt: draft.updatedAt,
    });
    expect(tab2.statusCode).toBe(409);
    expect(tab2.json()).toMatchObject({ code: 'draft_changed' });
    const [row] = await db.db
      .select()
      .from(schema.quoteDraft)
      .where(eq(schema.quoteDraft.id, draft.id));
    expect((row!.data as IntakeDraftData).bidReference).toBe('FROM-TAB-1');
    // From the latest copy, the save goes through; without a version, no check (older clients).
    const latest = IntakeDraft.parse(tab1.json());
    expect(
      (
        await kam().patch(`/api/v1/quotes/drafts/${draft.id}`, {
          data: { bidReference: 'FROM-TAB-1-AGAIN' },
          expectedUpdatedAt: latest.updatedAt,
        })
      ).statusCode,
    ).toBe(200);
  });
});
