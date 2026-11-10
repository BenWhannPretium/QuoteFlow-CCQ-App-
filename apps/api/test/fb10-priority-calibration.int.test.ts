/**
 * FB-10 (priority calibration; D-004 open): the inactive v3 draft and its preview on open quotes (F-073,
 * T-036), volume-band routing at intake (T-011) and the non-blocking platform-minimum warning (F-066, T-025).
 * Both switches are seeded OFF and an Admin turns them on here. Its own database so the free SF opportunities
 * go further. The tests run in order: they share one database.
 */
import {
  ActivateScoringResponse,
  AdminScoringResponse,
  AdminSettingsResponse,
  IntakeDraft,
  PublicConfigResponse,
  QuoteDetail,
  ScoringPreviewResponse,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import { eq, ne, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-11-09T15:00:00Z');
const WHY = 'D-004 working session: bands and points agreed (test)';

let free: string[] = [];
const nextFree = () => {
  const id = free.shift();
  if (!id) throw new Error('test ran out of free opportunities');
  return id;
};

const kam = () => asRole(app, 'KAM');
const admin = () => asRole(app, 'Admin');
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

async function scoring() {
  const res = await admin().get('/api/v1/admin/config/scoring');
  expect(res.statusCode, res.body).toBe(200);
  return AdminScoringResponse.parse(res.json());
}
async function setting(key: string) {
  const res = await admin().get('/api/v1/admin/config/settings');
  return AdminSettingsResponse.parse(res.json()).items.find((s) => s.key === key)!;
}
async function setSetting(key: string, value: unknown, extra: Record<string, unknown> = {}) {
  const row = await setting(key);
  return admin().patch(`/api/v1/admin/config/settings/${key}`, {
    version: row.version,
    changeReason: WHY,
    value,
    ...extra,
  });
}

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
    requestedPaymentTerms: 'NET_30',
    priceBasis: 'FOB_PLANT',
  };
}

async function submitQuote(extra: IntakeDraftData) {
  const create = await kam().post('/api/v1/quotes/drafts', {
    data: { ...(await prefill(nextFree())), ...extra },
  });
  expect(create.statusCode, create.body).toBe(201);
  const draft = IntakeDraft.parse(create.json());
  expect(draft.evaluation.blocking).toEqual([]);
  const res = await kam().post(`/api/v1/quotes/drafts/${draft.id}/submit`);
  expect(res.statusCode, res.body).toBe(201);
  const out = SubmitIntakeResponse.parse(res.json());
  const [quote] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, out.quoteId));
  return { ...out, draft, quote: quote! };
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('fb10');
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

describe('the v3 draft and its preview (F-073, T-036)', () => {
  it('ships an inactive, provisional draft; the live model is unchanged', async () => {
    const { versions } = await scoring();
    const draft = versions.filter((v) => v.status === 'draft');
    expect(draft).toHaveLength(1);
    // FB-12 re-keyed FB-10's draft from market to sub-market (its reason now names FB-12).
    expect(draft[0]!.changeReason).toMatch(/^FB-12/);
    expect(draft[0]!.approval.provisional).toBe(true);
    const active = versions.find((v) => v.status === 'active')!;
    expect(draft[0]!.modelVersion).toBe(active.modelVersion + 1);
    const weights = (m: { attributes: unknown[] }) =>
      (m.attributes as { key: string; weight: number }[]).map((a) => [a.key, a.weight]);
    expect(weights(draft[0]!.model)).toEqual(weights(active.model));
    expect(draft[0]!.model.tiers).toEqual(active.model.tiers);
  });

  it('previews the saved draft against the live model on the OPEN quotes: tiers, points moved, why', async () => {
    const quotesBefore = await db.db
      .select({
        id: schema.quote.id,
        score: schema.quote.priorityScore,
        version: schema.quote.scoringModelVersion,
      })
      .from(schema.quote)
      .orderBy(schema.quote.id);
    const res = await asRole(app, 'Leadership').get('/api/v1/admin/config/scoring/draft/preview');
    expect(res.statusCode, res.body).toBe(200);
    const p = ScoringPreviewResponse.parse(res.json());
    const { versions } = await scoring();
    expect(p.activeVersion).toBe(versions.find((v) => v.status === 'active')!.modelVersion);
    expect(p.draftVersion).toBe(versions.find((v) => v.status === 'draft')!.modelVersion);

    const openCount = (
      await db.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.quote)
        .where(ne(schema.quote.status, 'closed'))
    )[0]!.n;
    expect(openCount).toBeGreaterThan(0);
    expect(p.openQuotes).toBe(openCount);
    expect(p.rows).toHaveLength(openCount);
    expect(p.rows.every((r) => r.status !== 'closed')).toBe(true);

    for (const r of p.rows) {
      expect(r.before).not.toBeNull();
      expect(r.pointsMoved).toBeCloseTo(r.after.score - r.before!.score, 1);
      // Only strategic fit differs between v2 and the draft.
      expect(r.drivers.every((d) => d.key === 'strategic_fit')).toBe(true);
      if (r.pointsMoved !== 0) expect(r.drivers.length).toBeGreaterThan(0);
    }
    // The 9-box points differ by sub-market, so the preview moves some quotes and not others.
    expect(p.rows.some((r) => r.pointsMoved !== 0)).toBe(true);
    expect(new Set(p.rows.map((r) => r.market)).size).toBeGreaterThan(1);
    expect(p.summary.quotes).toBe(openCount);
    expect(p.summary.maxPointsUp).toBeGreaterThanOrEqual(0);
    expect(p.summary.maxPointsDown).toBeLessThanOrEqual(0);

    // T-036: two quotes in different sub-markets move by different amounts; a quote with no sub-market not at all.
    const bySubMarket = new Map(p.rows.map((r) => [r.subMarket, r.pointsMoved]));
    expect(new Set(bySubMarket.values()).size).toBeGreaterThan(1);
    expect(p.rows.filter((r) => r.subMarket === null).every((r) => r.pointsMoved === 0)).toBe(true);

    // Writes nothing: stored scores, versions and the audit trail are as they were.
    const quotesAfter = await db.db
      .select({
        id: schema.quote.id,
        score: schema.quote.priorityScore,
        version: schema.quote.scoringModelVersion,
      })
      .from(schema.quote)
      .orderBy(schema.quote.id);
    expect(quotesAfter).toEqual(quotesBefore);
  });

  it('the unsaved-edits preview also covers the open quotes and carries points moved', async () => {
    const { versions } = await scoring();
    const draft = versions.find((v) => v.status === 'draft')!;
    const res = await asRole(app, 'Leadership').post('/api/v1/admin/config/scoring/preview', {
      model: draft.model,
    });
    expect(res.statusCode, res.body).toBe(200);
    const p = ScoringPreviewResponse.parse(res.json());
    expect(p.draftVersion).toBeNull();
    expect(p.rows.every((r) => r.status !== 'closed')).toBe(true);
    expect(p.rows.some((r) => r.pointsMoved !== 0)).toBe(true);
  });

  it('only Leadership and Admin read the preview', async () => {
    for (const role of ALL_ROLES) {
      const res = await asRole(app, role).get('/api/v1/admin/config/scoring/draft/preview');
      expect(res.statusCode, role).toBe(['Leadership', 'Admin'].includes(role) ? 200 : 403);
    }
  });

  it('activating needs a reason and only Admin may do it', async () => {
    const draft = (await scoring()).versions.find((v) => v.status === 'draft')!;
    const url = '/api/v1/admin/config/scoring/draft/activate';
    for (const role of ALL_ROLES.filter((r) => r !== 'Admin')) {
      const res = await asRole(app, role).post(url, {
        version: draft.version,
        changeReason: WHY,
      });
      expect(res.statusCode, role).toBe(403);
    }
    const noReason = await admin().post(url, { version: draft.version, changeReason: '' });
    expect(noReason.statusCode).toBe(400);
    expect((await scoring()).versions.find((v) => v.status === 'draft')).toBeDefined();
  });

  it('activates on request without rescoring open quotes, keeps v2, and audits the reason', async () => {
    const before = await scoring();
    const active = before.versions.find((v) => v.status === 'active')!;
    const draft = before.versions.find((v) => v.status === 'draft')!;
    const stored = await db.db
      .select({
        id: schema.quote.id,
        score: schema.quote.priorityScore,
        version: schema.quote.scoringModelVersion,
      })
      .from(schema.quote)
      .orderBy(schema.quote.id);

    clock = new Date(clock.getTime() + 60_000);
    const res = await admin().post('/api/v1/admin/config/scoring/draft/activate', {
      version: draft.version,
      changeReason: WHY,
      rescoreOpen: false,
    });
    expect(res.statusCode, res.body).toBe(200);
    const out = ActivateScoringResponse.parse(res.json());
    expect(out.rescoreQueued).toBe(0);
    await app.adminConfig.rescore.flush();

    const after = await scoring();
    expect(after.versions.find((v) => v.id === draft.id)!.status).toBe('active');
    expect(after.versions.find((v) => v.id === active.id)!.status).toBe('superseded'); // history kept
    expect(
      await db.db
        .select({
          id: schema.quote.id,
          score: schema.quote.priorityScore,
          version: schema.quote.scoringModelVersion,
        })
        .from(schema.quote)
        .orderBy(schema.quote.id),
    ).toEqual(stored);

    const [event] = await db.db
      .select()
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.entity, 'scoring_model'))
      .orderBy(sql`${schema.auditEvent.at} desc`)
      .limit(1);
    expect(event!.changeReason).toBe(WHY);
    expect(event!.after).toMatchObject({ rescoreOpen: false, rescoreQueued: 0 });

    // A new quote now scores with the 9-box points by sub-market (FB-12): T-036 in the priority breakdown.
    const fitOf = async (extra: IntakeDraftData) => {
      const q = await submitQuote(extra);
      const detail = QuoteDetail.parse(
        (await asRole(app, 'SalesLeader').get(`/api/v1/quotes/${q.quoteNumber}`)).json(),
      );
      expect(detail.priority.modelVersion).toBe(draft.modelVersion);
      return detail.priority.breakdown.find((b) => b.key === 'strategic_fit')!;
    };
    const snacks = await fitOf({ market: 'FOOD', subMarket: 'FOOD_SNACKS' });
    expect([snacks.points, snacks.raw]).toEqual([80, 'FOOD_SNACKS']); // Strategic Growth
    const honey = await fitOf({ market: 'FOOD', subMarket: 'FOOD_HONEY_SWEETENERS' });
    expect([honey.points, honey.raw]).toEqual([20, 'FOOD_HONEY_SWEETENERS']); // Rationalization
    const unscored = await fitOf({ market: 'FOOD' });
    expect([unscored.points, unscored.raw]).toEqual([50, 'FOOD']); // no sub-market: the neutral 50
    expect(unscored.explanation).toContain('Pick a sub-market to score strategic fit');
  });

  it('answers 404 when there is no draft to preview', async () => {
    const res = await admin().get('/api/v1/admin/config/scoring/draft/preview');
    expect(res.statusCode).toBe(404);
  });
});

describe('platform-minimum warning (F-066, T-025)', () => {
  it('is off in the seed: no warning, nothing recorded', async () => {
    const row = await setting('intake_guardrails');
    expect((row.value as { enabled: boolean }).enabled).toBe(false);
    expect(row.approval.provisional).toBe(true);
    const q = await submitQuote({ estAnnualVolume: 500_000 });
    expect(q.warnings.some((w) => w.code === 'BELOW_PLATFORM_MINIMUM')).toBe(false);
    expect(q.quote.guardrailWarning).toBeNull();
  });

  it('warns below the minimum, never blocks, and records the warning on the quote for G1', async () => {
    const on = { ...((await setting('intake_guardrails')).value as object), enabled: true };
    const res = await setSetting('intake_guardrails', on);
    expect(res.statusCode, res.body).toBe(200);
    // The wizard reads it from the public config.
    const config = PublicConfigResponse.parse((await kam().get('/api/v1/config/public')).json());
    expect((config.settings.intake_guardrails as { enabled: boolean }).enabled).toBe(true);

    const q = await submitQuote({ estAnnualVolume: 500_000 });
    const warn = q.draft.evaluation.warnings.find((w) => w.code === 'BELOW_PLATFORM_MINIMUM');
    expect(warn?.message).toBe(
      'Below the platform minimum for our machine platforms: 500,000 units/yr. You can still submit.',
    );
    expect(q.warnings.some((w) => w.code === 'BELOW_PLATFORM_MINIMUM')).toBe(true);
    expect(q.quote.guardrailWarning).toBe(warn!.message);
    expect(q.quote.submittedAt).not.toBeNull();

    // Every role that reads the quote sees it (rule 2); it is recorded for G1.
    for (const role of ALL_ROLES) {
      const detail = await asRole(app, role).get(`/api/v1/quotes/${q.quoteNumber}`);
      expect(detail.statusCode, role).toBe(200);
      expect(QuoteDetail.parse(detail.json()).intakeFacts.guardrailWarning).toBe(warn!.message);
    }

    // At or above the lowest minimum: no warning, and nothing recorded.
    const ok = await submitQuote({ estAnnualVolume: 1_000_000, estAnnualVolumeConfirmed: true });
    expect(ok.warnings.some((w) => w.code === 'BELOW_PLATFORM_MINIMUM')).toBe(false);
    expect(ok.quote.guardrailWarning).toBeNull();
  });

  it('the setting is validated and the change is audited with its reason', async () => {
    const bad = await setSetting('intake_guardrails', {
      enabled: true,
      minAnnualVolumeByProcess: { ISBM: -5 },
    });
    expect(bad.statusCode).toBe(422);
    const [event] = await db.db
      .select()
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.entity, 'app_setting'))
      .orderBy(sql`${schema.auditEvent.at} desc`)
      .limit(1);
    expect(event!.changeReason).toBe(WHY);
  });
});

describe('volume-band routing (T-011)', () => {
  it('is off in the seed: every submit goes to G1 as before', async () => {
    const row = await setting('g1_volume_routing');
    expect((row.value as { enabled: boolean }).enabled).toBe(false);
    const q = await submitQuote({ estAnnualVolume: 5_000_000, estAnnualVolumeConfirmed: true });
    expect(q.routedTo).toBe('G1');
    expect(q.routingReason).toBeNull();
  });

  it('outside the band goes to the sales leader (G1), inside goes straight to Engineering, and it is audited', async () => {
    const row = await setting('g1_volume_routing');
    const res = await setSetting('g1_volume_routing', {
      ...(row.value as object),
      enabled: true,
      min: 1_000_000,
      max: 10_000_000,
    });
    expect(res.statusCode, res.body).toBe(200);

    const below = await submitQuote({ estAnnualVolume: 750_000 });
    expect(below.routedTo).toBe('G1');
    expect(below.stageKey).toBe('INTAKE');
    expect(below.routingReason).toContain('outside the 1,000,000 to under 10,000,000 band');

    const above = await submitQuote({
      estAnnualVolume: 12_000_000,
      estAnnualVolumeConfirmed: true,
    });
    expect(above.routedTo).toBe('G1');

    const inBand = await submitQuote({
      estAnnualVolume: 3_000_000,
      estAnnualVolumeConfirmed: true,
    });
    expect(inBand.stageKey).toBe('ENG_REVIEW');
    expect(inBand.routingReason).toContain('in the 1,000,000 to under 10,000,000 band');

    const atMin = await submitQuote({ estAnnualVolume: 1_000_000, estAnnualVolumeConfirmed: true });
    expect(atMin.stageKey).toBe('ENG_REVIEW'); // the minimum is inclusive

    // The sales leader sees the out-of-band quotes waiting at G1, and not the in-band one.
    const queue = (await asRole(app, 'SalesLeader').get('/api/v1/gates/G1/queue')).json<{
      items: { quoteNumber: string }[];
    }>();
    const numbers = queue.items.map((i) => i.quoteNumber);
    expect(numbers).toEqual(expect.arrayContaining([below.quoteNumber, above.quoteNumber]));
    expect(numbers).not.toContain(inBand.quoteNumber);

    // Audited, with the reason.
    const events = await db.db
      .select()
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.quoteId, inBand.quoteId));
    const routed = events.find(
      (e) => (e.after as { event?: string } | null)?.event === 'quote.volume_routed',
    );
    expect(routed?.after).toMatchObject({ route: 'engineering', inBand: true });

    // The stored workflow config is untouched: G1 on, SUBMIT off.
    const gates = await db.db
      .select({ key: schema.gateDefinition.key, enabled: schema.gateDefinition.enabled })
      .from(schema.gateDefinition)
      .where(sql`${schema.gateDefinition.key} in ('G1', 'SUBMIT')`);
    expect(Object.fromEntries(gates.map((g) => [g.key, g.enabled]))).toEqual({
      G1: true,
      SUBMIT: false,
    });
  });

  it('keeps G1 on while routing is on, and needs G1 on to switch routing on', async () => {
    const off = await setSetting('g1_enabled', false, { confirm: true });
    expect(off.statusCode).toBe(422);
    expect(off.json<{ detail: string }>().detail).toMatch(/Turn volume-band routing off first/);

    // Routing off, then G1 off, then routing cannot be switched on.
    const routing = (await setting('g1_volume_routing')).value as object;
    expect((await setSetting('g1_volume_routing', { ...routing, enabled: false })).statusCode).toBe(
      200,
    );
    expect((await setSetting('g1_enabled', false, { confirm: true })).statusCode).toBe(200);
    const on = await setSetting('g1_volume_routing', { ...routing, enabled: true });
    expect(on.statusCode).toBe(422);
    expect(on.json<{ detail: string }>().detail).toMatch(/Turn the G1 qualify gate on first/);
    expect((await setSetting('g1_enabled', true)).statusCode).toBe(200);
  });

  it('rejects a band whose minimum is not below its maximum', async () => {
    const routing = (await setting('g1_volume_routing')).value as object;
    const res = await setSetting('g1_volume_routing', { ...routing, min: 5, max: 5 });
    expect(res.statusCode).toBe(422);
  });
});
