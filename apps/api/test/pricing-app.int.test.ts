import {
  IntegrationRunsResponse,
  PricingContext,
  PricingErfResponse,
  PricingErfSearchResponse,
  QuotingDetail,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import type { Role } from '@ccq/domain';
import {
  FakePricingReader,
  PRICING_COLUMNS,
  syntheticPricingFixture,
  type PricingRow,
} from '@ccq/integrations';
import { and, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { PRICING_CACHE_MS } from '../src/services/pricing-app';
import { testConfig } from '../src/test-utils';

/**
 * B-15 (F-11): the pricing-app lookups and a quote's pricing context, against the fake reader on the
 * synthetic fixture. Covers: commercial-only access (403 + nothing leaked), ERF/BPR by number and
 * customer, ERF↔BPR cardinality, SPR history, CCQ vs SF ERF linkage, "Use as reference" setting
 * quote.erf_number, the 5-minute cache, the manual-reference fallback when the reader is down and
 * hourly integration_run counts.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let reader: FakePricingReader;
let clock = new Date('2026-11-04T15:10:00Z');
const tick = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};
const as = (role: Role) => asRole(app, role);

const C = PRICING_COLUMNS;
const fixture = syntheticPricingFixture();
const col = (row: PricingRow, ref: { column: string }) => String(row[ref.column]);

/** An ERF with at least two BPRs (cardinality), and one other ERF. */
const plain = (e: PricingRow) => /^\d{4,7}$/.test(col(e, C.erf.erfNumber)); // the ERF format setting
const erfWithBprs = fixture.erf.find(
  (e) =>
    plain(e) &&
    fixture.bpr.filter((b) => String(b[C.bpr.erfNumber.column]) === col(e, C.erf.erfNumber))
      .length >= 2,
)!;
const ERF_A = col(erfWithBprs, C.erf.erfNumber);
const ERF_B = col(
  fixture.erf.find((e) => plain(e) && col(e, C.erf.erfNumber) !== ERF_A)!,
  C.erf.erfNumber,
);
const BPR_X = col(
  fixture.bpr.find((b) => b[C.bpr.erfNumber.column] === null) ?? fixture.bpr.at(-1)!,
  C.bpr.bprNumber,
);
const CUSTOMER = col(erfWithBprs, C.erf.customerName);

const ALLOWED: Role[] = ['Pricing', 'EngLead', 'Approver', 'Leadership', 'Admin'];
const DENIED: Role[] = ['KAM', 'Engineer', 'SalesLeader'];

let qn: string;

async function resetQuote(fields: { erf: string | null; sfErf: string | null }) {
  await db.db.execute(sql`update quote set erf_number = ${fields.erf} where quote_number = ${qn}`);
  await db.db.execute(sql`
    update sf_opportunity_snapshot s set erf_number_sf = ${fields.sfErf}
    from quote q where q.quote_number = ${qn} and q.sf_opportunity_id = s.sf_opportunity_id`);
  await db.db.execute(sql`
    update pricing_record p set pricing_refs = '{"erf": []}'::jsonb
    from quote q where q.quote_number = ${qn} and p.quote_id = q.id and p.quote_version = q.version`);
}

async function context(role: Role = 'Pricing') {
  const res = await as(role).get(`/api/v1/quotes/${qn}/pricing-context`);
  expect(res.statusCode, res.body).toBe(200);
  return PricingContext.parse(res.json());
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('pricing_app');
  db = fresh.client;
  reader = new FakePricingReader(syntheticPricingFixture());
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url }), {
    db,
    pricing: reader,
    now: () => clock,
  });
  await app.ready();
  // An open seeded quote in Quoting (its pricing record is created by the first PUT), and SPR
  // history in the pricing app for its customer.
  const [row] = await db.db.execute<{ quote_number: string; name: string }>(sql`
    select q.quote_number, c.name from quote q
    join customer c on c.id = q.customer_id
    where q.stage_key = 'QUOTING' and q.status <> 'closed'
    order by q.quote_number limit 1`);
  expect(row, 'a seeded open Quoting quote').toBeDefined();
  qn = row!.quote_number;
  reader.put('spr', {
    [C.spr.sprNumber.column]: 'SPR-90001',
    [C.spr.customerName.column]: row!.name,
    [C.spr.itemDescription.column]: '32oz HDPE Round',
    [C.spr.requestedOn.column]: '2024-02-01',
  });
}, 120_000);
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  reader.failWith = null;
  tick(PRICING_CACHE_MS + 1); // start every test with a cold cache
});

describe('access: commercial roles only (server-enforced)', () => {
  const urls = () => [
    `/api/v1/pricing/erf/${ERF_A}`,
    `/api/v1/pricing/erf?customer=${encodeURIComponent(CUSTOMER.slice(0, 8))}`,
    `/api/v1/quotes/${qn}/pricing-context`,
  ];

  it.each(DENIED)(
    '%s gets 403 on every route, with no pricing-app data in the body',
    async (role) => {
      await resetQuote({ erf: ERF_A, sfErf: ERF_B });
      for (const url of urls()) {
        const res = await as(role).get(url);
        expect(res.statusCode, url).toBe(403);
        expect(res.headers['content-type']).toMatch(/problem\+json/);
        for (const secret of [CUSTOMER, 'erfRecord', 'bprRecord', 'estRevenueUsd', 'sprHistory']) {
          expect(res.body, `${role} ${url}`).not.toContain(secret);
        }
      }
    },
  );

  it.each(ALLOWED)('%s reads every route', async (role) => {
    await resetQuote({ erf: ERF_A, sfErf: null });
    for (const url of urls()) {
      const res = await as(role).get(url);
      expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
    }
    const ctx = await context(role);
    // The figures are there (unknown = null, still a key) for every commercial role.
    expect(ctx.erfRecords[0]).toHaveProperty('estRevenueUsd');
    expect(ctx.erfRecords[0]).toHaveProperty('estNetCapitalUsd');
  });
});

describe('lookups', () => {
  it('a legacy ERF by number (prefix tolerated); B-26: no BPRs', async () => {
    const res = await as('Pricing').get(`/api/v1/pricing/erf/ERF-${ERF_A}`);
    expect(res.statusCode, res.body).toBe(200);
    const body = PricingErfResponse.parse(res.json());
    expect(body.erfRecord.erfNumber).toBe(ERF_A);
    expect(res.json()).not.toHaveProperty('bprRecords');
    expect(body.source).toMatchObject({ mode: 'fake', available: true, error: null });
  });

  it('404 for an unknown ERF; 400 for a malformed number; B-26: the BPR route is gone', async () => {
    const erf = await as('Pricing').get('/api/v1/pricing/erf/9999990');
    expect(erf.statusCode).toBe(404);
    expect(erf.json()).toMatchObject({ code: 'not_found' });
    expect((await as('Pricing').get(`/api/v1/pricing/bpr/${BPR_X}`)).statusCode).toBe(404);
    expect(
      (await as('Pricing').get(`/api/v1/pricing/erf/${encodeURIComponent("1';--")}`)).statusCode,
    ).toBe(400);
  });

  it('search by customer and text; a filter is required and the cap is 50', async () => {
    const res = await as('Pricing').get(
      `/api/v1/pricing/erf?customer=${encodeURIComponent(CUSTOMER)}&limit=50`,
    );
    expect(res.statusCode, res.body).toBe(200);
    const body = PricingErfSearchResponse.parse(res.json());
    expect(body.erfRecords.map((e) => e.erfNumber)).toContain(ERF_A);
    expect(body.erfRecords.every((e) => e.customerName === CUSTOMER)).toBe(true);

    const all = PricingErfSearchResponse.parse(
      (await as('Pricing').get('/api/v1/pricing/erf?q=synthetic&limit=50')).json(),
    );
    expect(all.erfRecords).toHaveLength(50);
    expect(all.truncated).toBe(true);

    expect((await as('Pricing').get('/api/v1/pricing/erf')).statusCode).toBe(400);
    expect((await as('Pricing').get('/api/v1/pricing/erf?q=x&limit=51')).statusCode).toBe(400);
  });
});

describe('the quote pricing context', () => {
  it('resolves quote.erf_number, the legacy ERF numbers and the SF ERF number, with SPR history (B-26: no BPR)', async () => {
    await resetQuote({ erf: ERF_A, sfErf: ERF_B });
    const save = await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
      erfRefs: [ERF_A, '7777770'],
    });
    expect(save.statusCode, save.body).toBe(200);
    // BPR references are no longer accepted (strict body).
    const bpr = await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
      bprRefs: [BPR_X],
    });
    expect(bpr.statusCode).toBe(400);

    const ctx = await context();
    expect(ctx.refs).toEqual({
      quoteErfNumber: ERF_A,
      sfErfNumber: ERF_B,
      erfRefs: [ERF_A, '7777770'],
    });
    expect(ctx.erfRecords.map((e) => e.erfNumber).sort()).toEqual([ERF_A, ERF_B].sort());
    expect(ctx.notFound).toEqual({ erf: ['7777770'] });
    expect(ctx).not.toHaveProperty('bprRecords');
    expect(ctx.sprHistory.map((s) => s.sprNumber)).toContain('SPR-90001');
    expect(ctx.linkage).toEqual({ status: 'mismatch', mismatch: true });
    expect(ctx.canUseAsReference).toBe(true);
    expect(ctx.source).toMatchObject({ mode: 'fake', available: true, error: null });

    // Read-only roles see it but can't add references.
    expect((await context('EngLead')).canUseAsReference).toBe(false);
    expect((await context('Leadership')).canUseAsReference).toBe(false);
  });

  it('an SF ERF number that matches (ignoring an ERF prefix) is not a mismatch', async () => {
    await resetQuote({ erf: ERF_A, sfErf: `ERF-${ERF_A}` });
    const ctx = await context();
    expect(ctx.linkage).toEqual({ status: 'match', mismatch: false });
    expect(ctx.erfRecords).toHaveLength(1);
  });

  it('404 for a quote out of scope or unknown', async () => {
    const res = await as('Pricing').get('/api/v1/quotes/CCQ-2099-99999/pricing-context');
    expect(res.statusCode).toBe(404);
  });

  it('writes a debounced quote-view audit row', async () => {
    await resetQuote({ erf: ERF_A, sfErf: null });
    await context('Approver');
    await app.audit.flush();
    const rows = await db.db.execute<{ n: number }>(sql`
      select count(*)::int as n from audit_event a join quote q on q.id = a.quote_id
      where q.quote_number = ${qn} and a.action = 'view'`);
    expect(rows[0]!.n).toBeGreaterThan(0);
  });
});

describe('"Use as reference" and quote.erf_number', () => {
  it('the first ERF reference becomes quote.erf_number when it is empty (audited), and never overwrites', async () => {
    await resetQuote({ erf: null, sfErf: ERF_B });
    const res = await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
      erfRefs: [ERF_A],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(QuotingDetail.parse(res.json()).pricingRecord?.erfRefs).toEqual([ERF_A]);
    const [q] = await db.db.select().from(schema.quote).where(eq(schema.quote.quoteNumber, qn));
    expect(q!.erfNumber).toBe(ERF_A);
    const [audit] = await db.db
      .select()
      .from(schema.auditEvent)
      .where(and(eq(schema.auditEvent.entity, 'quote'), eq(schema.auditEvent.entityId, q!.id)))
      .orderBy(desc(schema.auditEvent.at))
      .limit(1);
    expect(audit).toMatchObject({
      action: 'update',
      before: { erfNumber: null },
      after: { erfNumber: ERF_A },
    });

    // The SF ERF number differs: the context warns.
    expect((await context()).linkage.status).toBe('mismatch');

    // A later reference does not replace it.
    const again = await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
      erfRefs: [ERF_B, ERF_A],
    });
    expect(again.statusCode, again.body).toBe(200);
    const [after] = await db.db.select().from(schema.quote).where(eq(schema.quote.quoteNumber, qn));
    expect(after!.erfNumber).toBe(ERF_A);
  });

  it('only Pricing can add a reference (KAM 403 on the B-11 route)', async () => {
    const res = await as('KAM').put(`/api/v1/quotes/${qn}/pricing-record`, { erfRefs: [ERF_A] });
    expect(res.statusCode).toBe(403);
  });
});

describe('cache, fallback and usage counts', () => {
  it('caches reads for 5 minutes', async () => {
    await resetQuote({ erf: ERF_A, sfErf: null });
    await context();
    const calls = { ...reader.calls };
    await context();
    await as('Pricing').get(`/api/v1/pricing/erf/${ERF_A}`);
    expect(reader.calls).toEqual(calls);
    tick(PRICING_CACHE_MS);
    await context();
    expect(reader.calls.getErf).toBe(calls.getErf! + 1);
  });

  it('falls back to manual references when the reader is down, and recovers (failures are not cached)', async () => {
    await resetQuote({ erf: ERF_A, sfErf: null });
    reader.failWith = Object.assign(new Error(`connect failed for ${CUSTOMER}`), {
      code: 'ESOCKET',
    });
    const ctx = await context();
    expect(ctx.source).toMatchObject({
      available: false,
      error: 'Pricing app unavailable (ESOCKET)',
      readAt: null,
    });
    expect(ctx.refs.quoteErfNumber).toBe(ERF_A);
    expect(ctx.erfRecords).toEqual([]);
    expect(ctx.canUseAsReference).toBe(true);

    const lookup = await as('Pricing').get(`/api/v1/pricing/erf/${ERF_A}`);
    expect(lookup.statusCode).toBe(503);
    expect(lookup.json()).toMatchObject({ code: 'pricing_app_unavailable' });
    expect(lookup.body).toMatch(/enter legacy ERF numbers manually/i);
    expect(lookup.body).not.toContain(CUSTOMER);

    // Manual references still save while the reader is down.
    const save = await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
      erfRefs: [ERF_A],
    });
    expect(save.statusCode, save.body).toBe(200);

    reader.failWith = null;
    const back = await context();
    expect(back.source.available).toBe(true);
    expect(back.erfRecords.map((e) => e.erfNumber)).toEqual([ERF_A]);
  });

  it('counts usage in one integration_run row per hour, not per call', async () => {
    await app.pricingUsage.flush();
    clock = new Date('2026-11-05T09:05:00Z');
    await resetQuote({ erf: ERF_A, sfErf: null });
    await context();
    await context(); // cache hits
    await as('Pricing').get(`/api/v1/pricing/erf/${ERF_A}`);
    await app.pricingUsage.flush();
    tick(20 * 60_000);
    reader.failWith = Object.assign(new Error('x'), { code: 'ETIMEOUT' });
    await as('Pricing').get('/api/v1/pricing/erf?q=abc');
    await app.pricingUsage.flush();

    const hour = await db.db
      .select()
      .from(schema.integrationRun)
      .where(
        and(
          eq(schema.integrationRun.source, 'pricing'),
          eq(schema.integrationRun.startedAt, new Date('2026-11-05T09:00:00Z')),
        ),
      );
    expect(hour).toHaveLength(1);
    const counts = hour[0]!.counts as Record<string, number>;
    expect(counts.requests).toBe(4);
    expect(counts.failed).toBe(1);
    expect(counts.cacheHits).toBeGreaterThan(0);
    expect(counts.calls).toBeGreaterThan(1);
    expect(hour[0]).toMatchObject({ status: 'partial', error: 'ETIMEOUT' });
    expect(hour[0]!.finishedAt?.toISOString()).toBe('2026-11-05T09:25:00.000Z');

    // The next hour gets its own row.
    reader.failWith = null;
    tick(60 * 60_000);
    await context();
    await app.pricingUsage.flush();
    const rows = await db.db
      .select()
      .from(schema.integrationRun)
      .where(eq(schema.integrationRun.source, 'pricing'));
    const starts = rows.map((r) => r.startedAt.toISOString());
    expect(starts).toContain('2026-11-05T10:00:00.000Z');
    expect(new Set(starts).size).toBe(starts.length);

    // Admin → Integrations lists them.
    const admin = await as('Admin').get('/api/v1/admin/integrations?source=pricing');
    expect(admin.statusCode, admin.body).toBe(200);
    expect(IntegrationRunsResponse.parse(admin.json()).items).toHaveLength(rows.length);
  });
});
