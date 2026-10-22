import { randomUUID } from 'node:crypto';

import {
  DEV_USER_HEADER,
  IntegrationRunsResponse,
  PricingContext,
  PricingErfResponse,
  PricingHistoryImportResponse,
  PricingHistorySearchResponse,
  PricingHistoryStatusResponse,
  QuotingDetail,
} from '@ccq/contracts';
import { schema, withRequestContext, type DbClient } from '@ccq/db';
import type { Role } from '@ccq/domain';
import {
  syntheticExportSheets,
  syntheticPricingExport,
  writeExportXlsx,
  type SyntheticExport,
} from '@ccq/integrations';
import { and, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole, personaFor } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * B-15 (F-11), revised 2026-10-22: the legacy pricing app's history, imported into CCQ (no live
 * connection). The synthetic seed loads the synthetic export through the same mapper. Covers:
 * commercial-only reads (403 + nothing leaked, RLS as the second layer), ERF lookup, search per kind,
 * the quote context (refs, customer ERFs, SPR history, no BPR, linkage, "Use as reference"), the
 * Admin import (check vs apply, idempotent re-import, changed and new rows, bad files, audit,
 * integration_run).
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
const as = (role: Role) => asRole(app, role);

const ALLOWED: Role[] = ['Pricing', 'PricingLead', 'EngLead', 'Approver', 'Leadership', 'Admin'];
const DENIED: Role[] = ['KAM', 'Engineer', 'SalesLeader'];

let qn: string;
let customer: string;
/** Two of the quote customer's ERFs (export format numbers). */
let erfA: string;
let erfB: string;

function multipart(file: { name: string; content: Buffer }) {
  const boundary = `----ccq${Math.random().toString(16).slice(2)}`;
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
    ),
    file.content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, contentType: `multipart/form-data; boundary=${boundary}` };
}

const upload = (content: Buffer, apply: boolean, role: Role = 'Admin', name = 'exports.xlsx') => {
  const body = multipart({ name, content });
  return app.inject({
    method: 'POST',
    url: `/api/v1/admin/pricing-history/import?apply=${apply}`,
    headers: { [DEV_USER_HEADER]: personaFor(role, 'all'), 'content-type': body.contentType },
    payload: body.payload,
  });
};

const xlsx = (x: SyntheticExport) => writeExportXlsx(syntheticExportSheets(x));

async function context(role: Role = 'Pricing') {
  const res = await as(role).get(`/api/v1/quotes/${qn}/pricing-context`);
  expect(res.statusCode, res.body).toBe(200);
  return PricingContext.parse(res.json());
}

async function setRefs(fields: { quoteErf: string | null; sfErf: string | null }) {
  await db.db.execute(
    sql`update quote set erf_number = ${fields.quoteErf} where quote_number = ${qn}`,
  );
  await db.db.execute(sql`
    update sf_opportunity_snapshot s set erf_number_sf = ${fields.sfErf}
    from quote q where q.quote_number = ${qn} and q.sf_opportunity_id = s.sf_opportunity_id`);
  await db.db.execute(sql`
    update pricing_record p set pricing_refs = '{"erf": []}'::jsonb
    from quote q where q.quote_number = ${qn} and p.quote_id = q.id and p.quote_version = q.version`);
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('pricing_history');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url }), { db });
  await app.ready();
  // An open seeded quote in Quoting whose customer has at least two ERFs and an SPR in the history.
  const [row] = await db.db.execute<{ quote_number: string; name: string; customer_key: string }>(
    sql`
    select q.quote_number, c.name, h.customer_key from quote q
    join customer c on c.id = q.customer_id
    join pricing_history_record h on h.kind = 'erf' and h.customer = c.name
    where q.stage_key = 'QUOTING' and q.status <> 'closed'
      and h.request_number like 'ERF%'
      and exists (select 1 from pricing_history_record s where s.kind = 'spr' and s.customer_key = h.customer_key)
    group by q.quote_number, c.name, h.customer_key
    having count(*) >= 2
    order by q.quote_number limit 1`,
  );
  expect(row, 'a seeded Quoting quote whose customer has ERF and SPR history').toBeDefined();
  qn = row!.quote_number;
  customer = row!.name;
  const erfs = await db.db.execute<{ request_number: string }>(sql`
    select request_number from pricing_history_record
    where kind = 'erf' and customer_key = ${row!.customer_key} and request_number like 'ERF%'
    order by request_id limit 2`);
  [erfA, erfB] = erfs.map((e) => e.request_number) as [string, string];
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('access: commercial roles read, Admin imports (server-enforced)', () => {
  const reads = () => [
    `/api/v1/pricing/erf/${erfA}`,
    `/api/v1/pricing/history?kind=bpr&customer=${encodeURIComponent(customer.slice(0, 10))}`,
    `/api/v1/quotes/${qn}/pricing-context`,
  ];

  it.each(DENIED)('%s gets 403 on every read, with no history in the body', async (role) => {
    for (const url of reads()) {
      const res = await as(role).get(url);
      expect(res.statusCode, url).toBe(403);
      // The problem body echoes the URL the caller sent (`instance`); nothing else may come back.
      for (const secret of [
        customer,
        'historyRecords',
        'erfRecord',
        'customerErfs',
        'priceAgreedTo',
      ]) {
        expect(res.body, `${role} ${url}`).not.toContain(secret);
      }
    }
  });

  it.each(ALLOWED)('%s reads every route', async (role) => {
    for (const url of reads()) {
      const res = await as(role).get(url);
      expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
    }
  });

  it('only Admin imports or reads the import status', async () => {
    const file = await xlsx(syntheticPricingExport());
    for (const role of ['Pricing', 'PricingLead', 'Leadership'] as const) {
      expect((await upload(file, false, role)).statusCode, role).toBe(403);
      expect((await as(role).get('/api/v1/admin/pricing-history')).statusCode).toBe(403);
    }
  });

  it('RLS: the table is invisible to a KAM context and read-only for Pricing', async () => {
    const ctx = (roles: Role[]) => ({
      userId: randomUUID(),
      roles,
      scope: { type: 'all' as const },
    });
    const count = (roles: Role[]) =>
      withRequestContext(db.db, ctx(roles), async (tx) =>
        Number(
          (
            await tx.execute<{ n: number }>(
              sql`select count(*)::int as n from pricing_history_record`,
            )
          )[0]!.n,
        ),
      );
    expect(await count(['KAM'])).toBe(0);
    expect(await count(['Engineer', 'SalesLeader'])).toBe(0);
    expect(await count(['Pricing'])).toBeGreaterThan(0);
    await expect(
      withRequestContext(db.db, ctx(['Pricing']), (tx) =>
        tx.execute(sql`update pricing_history_record set comments = 'x' where kind = 'erf'`),
      ).then((r) => r.count),
    ).resolves.toBe(0);
    const denied = await withRequestContext(db.db, ctx(['Admin']), (tx) =>
      tx.execute(sql`delete from pricing_history_record where kind = 'erf'`),
    ).catch((e: unknown) => e as Error & { cause?: Error });
    expect(String((denied as { cause?: Error }).cause?.message)).toMatch(/permission denied/);
  });
});

describe('lookup and search', () => {
  it('an ERF by number, tolerating case and spaces; unknown → 404', async () => {
    const res = await as('Pricing').get(
      `/api/v1/pricing/erf/${encodeURIComponent(` ${erfA.toLowerCase()} `)}`,
    );
    expect(res.statusCode, res.body).toBe(200);
    const body = PricingErfResponse.parse(res.json());
    expect(body.erfRecord).toMatchObject({ kind: 'erf', requestNumber: erfA, customer });
    expect(body.source.imported).toBe(true);
    expect(body.source.counts.bpr).toBeGreaterThan(0);
    expect((await as('Pricing').get('/api/v1/pricing/erf/ERF99-999')).statusCode).toBe(404);
  });

  it('a repeated request number returns the newest and says how many share it', async () => {
    const [dup] = await db.db.execute<{ request_number: string }>(sql`
      select request_number from pricing_history_record where kind = 'erf'
      group by request_number having count(*) > 1 limit 1`);
    const body = PricingErfResponse.parse(
      (await as('Approver').get(`/api/v1/pricing/erf/${dup!.request_number}`)).json(),
    );
    expect(body.sameNumber).toBe(1);
  });

  it('search per kind by customer and text, newest first; a filter is required', async () => {
    for (const kind of ['erf', 'bpr', 'spr'] as const) {
      const res = await as('Pricing').get(
        `/api/v1/pricing/history?kind=${kind}&customer=${encodeURIComponent(customer)}&limit=50`,
      );
      expect(res.statusCode, res.body).toBe(200);
      const body = PricingHistorySearchResponse.parse(res.json());
      expect(body.historyRecords.every((r) => r.kind === kind && r.customer === customer)).toBe(
        true,
      );
      const dates = body.historyRecords.map((r) => r.submittedOn ?? '');
      expect([...dates].sort().reverse()).toEqual(dates);
    }
    const byNumber = PricingHistorySearchResponse.parse(
      (await as('Pricing').get(`/api/v1/pricing/history?kind=erf&q=${erfB}`)).json(),
    );
    expect(byNumber.historyRecords.map((r) => r.requestNumber)).toContain(erfB);
    const capped = PricingHistorySearchResponse.parse(
      (await as('Pricing').get('/api/v1/pricing/history?kind=bpr&q=synthetic&limit=5')).json(),
    );
    expect(capped.historyRecords).toHaveLength(5);
    expect(capped.truncated).toBe(true);
    expect((await as('Pricing').get('/api/v1/pricing/history?kind=erf')).statusCode).toBe(400);
    expect((await as('Pricing').get('/api/v1/pricing/history?q=ab&limit=51')).statusCode).toBe(400);
  });

  it('BPR prices and zero-as-unknown estimates come through', async () => {
    const body = PricingHistorySearchResponse.parse(
      (await as('Pricing').get('/api/v1/pricing/history?kind=bpr&q=synthetic&limit=50')).json(),
    );
    const bprs = body.historyRecords.filter((r) => r.kind === 'bpr');
    expect(bprs.some((b) => b.priceAgreedTo !== null && b.priceAgreedTo > 0)).toBe(true);
    expect(bprs.every((b) => b.priceAgreedTo !== 0 && b.estVolume !== 0)).toBe(true);
  });
});

describe('the quote pricing context', () => {
  it('resolves the legacy ERF numbers and lists the customer history (no BPR)', async () => {
    await setRefs({ quoteErf: erfA, sfErf: erfB });
    const save = await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
      erfRefs: [erfA, 'ERF99-999'],
    });
    expect(save.statusCode, save.body).toBe(200);

    const ctx = await context();
    expect(ctx.refs).toEqual({
      quoteErfNumber: erfA,
      sfErfNumber: erfB,
      erfRefs: [erfA, 'ERF99-999'],
    });
    expect(ctx.erfRecords.map((e) => e.requestNumber)).toEqual([erfA, erfB]);
    expect(ctx.notFound).toEqual({ erf: ['ERF99-999'] });
    expect(ctx.customerMatch).toBe(customer);
    // The customer's other ERFs leave out the referenced ones.
    expect(ctx.customerErfs.map((e) => e.requestNumber)).not.toContain(erfA);
    expect(ctx.customerErfs.every((e) => e.customer === customer)).toBe(true);
    expect(ctx.sprHistory.length).toBeGreaterThan(0);
    expect(ctx.sprHistory.every((s) => s.kind === 'spr')).toBe(true);
    expect(ctx).not.toHaveProperty('bprHistory');
    expect(ctx.linkage).toEqual({ status: 'mismatch', mismatch: true });
    expect(ctx.canUseAsReference).toBe(true);
    expect(ctx.source.imported).toBe(true);

    expect((await context('EngLead')).canUseAsReference).toBe(false);
    expect((await context('Leadership')).canUseAsReference).toBe(false);
  });

  it('"Use as reference" sets an empty quote.erf_number (audited) and never overwrites it', async () => {
    await setRefs({ quoteErf: null, sfErf: null });
    const res = await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
      erfRefs: [erfB.toLowerCase()],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(QuotingDetail.parse(res.json()).pricingRecord?.erfRefs).toEqual([erfB]);
    const [q] = await db.db.select().from(schema.quote).where(eq(schema.quote.quoteNumber, qn));
    expect(q!.erfNumber).toBe(erfB);
    const [audit] = await db.db
      .select()
      .from(schema.auditEvent)
      .where(and(eq(schema.auditEvent.entity, 'quote'), eq(schema.auditEvent.entityId, q!.id)))
      .orderBy(desc(schema.auditEvent.at))
      .limit(1);
    expect(audit).toMatchObject({ before: { erfNumber: null }, after: { erfNumber: erfB } });

    await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, { erfRefs: [erfA, erfB] });
    const [after] = await db.db.select().from(schema.quote).where(eq(schema.quote.quoteNumber, qn));
    expect(after!.erfNumber).toBe(erfB);
  });

  it('a Legacy ERF # in another format is refused by the format setting', async () => {
    const res = await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
      erfRefs: ['26367'],
    });
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('ERF25-123');
  });

  it('404 for an unknown quote; writes the quote-view audit row', async () => {
    expect(
      (await as('Pricing').get('/api/v1/quotes/CCQ-2099-99999/pricing-context')).statusCode,
    ).toBe(404);
    await context('Approver');
    await app.audit.flush();
    const [n] = await db.db.execute<{ n: number }>(sql`
      select count(*)::int as n from audit_event a join quote q on q.id = a.quote_id
      where q.quote_number = ${qn} and a.action = 'view'`);
    expect(n!.n).toBeGreaterThan(0);
  });
});

describe('the Admin import', () => {
  it('checks a file without writing anything', async () => {
    const before = await db.db.select().from(schema.integrationRun);
    const res = await upload(await xlsx(syntheticPricingExport()), false);
    expect(res.statusCode, res.body).toBe(200);
    const body = PricingHistoryImportResponse.parse(res.json());
    expect(body).toMatchObject({
      applied: false,
      written: null,
      runId: null,
      fileName: 'exports.xlsx',
    });
    const erf = body.sheets.find((s) => s.kind === 'erf')!;
    expect(erf).toMatchObject({ sheet: 'ERF Export', skipped: 0, newRows: 0, missingColumns: [] });
    expect(erf.duplicateNumbers).toBeGreaterThanOrEqual(1);
    expect(erf.zeroAsUnknown).toBeGreaterThan(0);
    expect(erf.existingRows).toBe(erf.valid);
    expect(body.sheets.map((s) => s.kind).sort()).toEqual(['bpr', 'erf', 'spr']);
    expect(await db.db.select().from(schema.integrationRun)).toHaveLength(before.length);
  });

  it('applies: unchanged rows stay, changed rows update, new rows insert; one run + one audit row', async () => {
    const x = syntheticPricingExport();
    x.erf[0] = { ...x.erf[0]!, Comments: 'Updated in the corrected export (synthetic).' };
    x.bpr.push({ ...x.bpr[0]!, Request_ID: 990_001, Request_Number: 'BPR26-9001' });
    const res = await upload(await xlsx(x), true);
    expect(res.statusCode, res.body).toBe(200);
    const body = PricingHistoryImportResponse.parse(res.json());
    const total = x.erf.length + x.bpr.length + x.spr.length;
    expect(body.written).toEqual({ inserted: 1, updated: 1, unchanged: total - 2 });
    expect(body.runId).not.toBeNull();

    const [changed] = await db.db
      .select()
      .from(schema.pricingHistoryRecord)
      .where(
        and(
          eq(schema.pricingHistoryRecord.kind, 'erf'),
          eq(schema.pricingHistoryRecord.requestId, Number(x.erf[0].Request_ID)),
        ),
      );
    expect(changed!.comments).toBe('Updated in the corrected export (synthetic).');
    expect(changed!.importRunId).toBe(body.runId);

    const [run] = await db.db
      .select()
      .from(schema.integrationRun)
      .where(eq(schema.integrationRun.id, body.runId!));
    expect(run).toMatchObject({ source: 'pricing', status: 'succeeded' });
    expect(run!.counts).toMatchObject({ inserted: 1, updated: 1, erfRows: x.erf.length });
    const [audit] = await db.db
      .select()
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.entityId, body.runId!));
    expect(audit).toMatchObject({ action: 'upload', entity: 'pricing_history_import' });

    // The same file again writes nothing.
    const again = PricingHistoryImportResponse.parse((await upload(await xlsx(x), true)).json());
    expect(again.written).toEqual({ inserted: 0, updated: 0, unchanged: total });

    const status = PricingHistoryStatusResponse.parse(
      (await as('Admin').get('/api/v1/admin/pricing-history')).json(),
    );
    expect(status.imports[0]).toMatchObject({ runId: again.runId, status: 'succeeded' });
    expect(status.source.counts.bpr).toBe(x.bpr.length);
    const runs = IntegrationRunsResponse.parse(
      (await as('Admin').get('/api/v1/admin/integrations?source=pricing')).json(),
    );
    expect(runs.items.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses a file that is not the export (422), and records a failed run on apply', async () => {
    const notXlsx = await upload(Buffer.from('Request_ID,Request_Number\n1,ERF25-1\n'), true);
    expect(notXlsx.statusCode).toBe(422);
    expect(notXlsx.json()).toMatchObject({ code: 'pricing_history_invalid_file' });
    const [failed] = await db.db
      .select()
      .from(schema.integrationRun)
      .where(eq(schema.integrationRun.source, 'pricing'))
      .orderBy(desc(schema.integrationRun.startedAt))
      .limit(1);
    expect(failed).toMatchObject({ status: 'failed', error: 'INVALID_FILE' });

    const noKey = await writeExportXlsx([
      { name: 'ERF Export', rows: [{ Request_Number: 'ERF25-1', Fiscal_Year: 2025 }] },
    ]);
    const missing = await upload(noKey, false);
    expect(missing.statusCode).toBe(422);
    expect(missing.body).toContain('Request_ID');

    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/pricing-history/import',
      headers: { [DEV_USER_HEADER]: personaFor('Admin', 'all') },
    });
    expect(empty.statusCode).toBe(422);
  });
});
