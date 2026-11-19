/**
 * FB-24 (Nov 17 and 18 feedback): the intake on the server. A concept / innovation request submitted end
 * to end (N17-03), several decoration types round-tripped (N17-02), the 120-character item name (N17-05),
 * the tooling commitment (N18-02) and the stocking agreement (D4) stored on the quote. Synthetic data only;
 * its own database so the free SF opportunities go further.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEV_USER_HEADER,
  IntakeDraft,
  QuoteDetail,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
  type IntakeItemData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole, personaFor } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let filesRoot = '';
const clock = new Date('2026-11-19T15:00:00Z');

let free: string[] = [];
const nextFree = () => {
  const id = free.shift();
  if (!id) throw new Error('test ran out of free opportunities');
  return id;
};
const kam = () => asRole(app, 'KAM');
const ok = (res: { statusCode: number; body: string }, status = 200) =>
  expect(res.statusCode, res.body).toBe(status);

const KEY = (n: number) => `0193f2a0-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);

async function request(sfOpportunityId: string): Promise<IntakeDraftData> {
  const sf = SfOpportunityDetail.parse(
    (await kam().get(`/api/v1/salesforce/opportunities/${sfOpportunityId}`)).json(),
  );
  const shipTo = { line1: null, city: 'Testville', state: 'MO', postal: null, country: 'US' };
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
    market: 'FOOD',
    subMarket: 'FOOD_SNACKS',
    estAnnualRevenue: 300_000,
    quoteNeededBy: '2026-12-15',
  };
}

/** A complete standard item (the minimum spec filled). */
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
  productNeededBy: '2027-03-01',
  containerSize: '16 oz',
  ...over,
});

/** A concept item: no dimensions, no neck (the customer sent a render). */
const conceptItem = (key: string): IntakeItemData => ({
  key,
  label: 'Concept jar',
  productFamily: 'BOTTLE',
  components: ['CONTAINER'],
  resin: 'HDPE',
  estAnnualVolume: 500_000,
  productNeededBy: '2027-03-01',
});

async function createDraft(data: IntakeDraftData) {
  const res = await kam().post('/api/v1/quotes/drafts', { data });
  ok(res, 201);
  return IntakeDraft.parse(res.json());
}
const submit = (id: string) => kam().post(`/api/v1/quotes/drafts/${id}/submit`);
const blocking = (d: IntakeDraft) => d.evaluation.blocking.map((b) => `${b.code}:${b.field}`);

function uploadPhoto(draftId: string) {
  const boundary = `----ccq${Math.random().toString(16).slice(2)}`;
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nsample_photo\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n${PNG.length}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="render.png"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    PNG,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: 'POST',
    url: `/api/v1/quotes/drafts/${draftId}/attachments`,
    headers: {
      [DEV_USER_HEADER]: personaFor('KAM'),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('fb24_intake');
  db = fresh.client;
  filesRoot = await mkdtemp(join(tmpdir(), 'ccq-fb24-'));
  app = await buildApp(
    testConfig({
      DATABASE_URL: fresh.url,
      RATE_LIMIT_MAX: '100000',
      FILESTORE_LOCAL_DIR: join(filesRoot, 'local'),
    }),
    { db, now: () => clock },
  );
  await app.ready();
  const rows = await db.db.execute<{ id: string }>(sql`
    select s.sf_opportunity_id as id from sf_opportunity_snapshot s
    where not s.is_closed and s.account_id is not null
      and not exists (select 1 from quote q where q.sf_opportunity_id = s.sf_opportunity_id and q.status <> 'closed')
    order by s.sf_opportunity_id`);
  free = rows.map((r) => r.id);
  expect(free.length).toBeGreaterThanOrEqual(6);
}, 180_000);
afterAll(async () => {
  await app.close();
  await rm(filesRoot, { recursive: true, force: true });
});

describe('N17-03: a concept / innovation request', () => {
  it('is held to a render, photo or drawing and its assumptions, not the minimum spec', async () => {
    const draft = await createDraft({
      ...(await request(nextFree())),
      requestClass: 'CONCEPT',
      items: [conceptItem(KEY(1))],
    });
    expect(blocking(draft)).toEqual([
      'MISSING_FIELD:concept_assumptions',
      'RENDER_OR_DRAWING_REQUIRED:drawing_or_render',
    ]);
    const res = await submit(draft.id);
    expect(res.statusCode).toBe(422);
    expect(res.json<{ blocking: { code: string }[] }>().blocking.map((b) => b.code)).toContain(
      'RENDER_OR_DRAWING_REQUIRED',
    );
  });

  it('is submitted end to end with a render and its assumptions; Engineering and Pricing read them', async () => {
    const assumptions = '16 oz round jar, about 30 g, HDPE natural; pack-out and cycle estimated.';
    const draft = await createDraft({
      ...(await request(nextFree())),
      requestClass: 'CONCEPT',
      conceptAssumptions: assumptions,
      items: [conceptItem(KEY(2))],
    });
    ok(await uploadPhoto(draft.id), 201);
    const res = await submit(draft.id);
    ok(res, 201);
    const out = SubmitIntakeResponse.parse(res.json());
    const [quote] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, out.quoteId));
    expect(quote).toMatchObject({ requestClass: 'CONCEPT', conceptAssumptions: assumptions });
    for (const role of ['EngLead', 'Pricing', 'Approver'] as const) {
      const detail = QuoteDetail.parse(
        (await asRole(app, role).get(`/api/v1/quotes/${out.quoteNumber}`)).json(),
      );
      expect(detail.intakeFacts.conceptAssumptions, role).toBe(assumptions);
    }
    const [audit] = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.entity, 'quote'), eq(schema.auditEvent.entityId, out.quoteId)),
      );
    expect(
      (audit!.after as { commercialInputs: { conceptAssumptions: string } }).commercialInputs
        .conceptAssumptions,
    ).toBe(assumptions);
  });

  it('a standard request drops assumptions left over from a concept', async () => {
    const draft = await createDraft({
      ...(await request(nextFree())),
      conceptAssumptions: 'left over',
      items: [item(KEY(3), { drawingStatus: 'HAVE_DRAWING' })],
    });
    const res = await submit(draft.id);
    ok(res, 201);
    const out = SubmitIntakeResponse.parse(res.json());
    const [quote] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, out.quoteId));
    expect(quote!.conceptAssumptions).toBeNull();
  });
});

describe('N17-02, N17-05, N18-02, D4: stored on the quote and its items', () => {
  it('round-trips several decoration types, a 120-character name, the tooling answer and the stocking agreement', async () => {
    const longName = `${'Wide-mouth jar, natural, '.repeat(4)}`.padEnd(120, 'x');
    expect(longName).toHaveLength(120);
    const draft = await createDraft({
      ...(await request(nextFree())),
      toolingCommitment: true,
      stockHoldRequested: true,
      stockHoldWeeks: 12,
      stockHoldNote: 'Two months of safety stock at the plant',
      items: [
        item(KEY(4), {
          label: longName,
          components: ['CONTAINER', 'DECORATION'],
          decorationTypes: ['SILK_SCREEN', 'OTHER'],
          decorationTypeOther: 'Embossed logo',
          decorationPrintColors: 2,
          packagingType: 'SOLDIER_PACK',
        }),
      ],
    });
    expect(blocking(draft)).toEqual([]);
    const res = await submit(draft.id);
    ok(res, 201);
    const out = SubmitIntakeResponse.parse(res.json());
    const [quote] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, out.quoteId));
    expect(quote).toMatchObject({
      decorationTypes: ['SILK_SCREEN', 'OTHER'],
      decorationType: null,
      decorationTypeOther: 'Embossed logo',
      packagingType: 'SOLDIER_PACK',
      termsToolingCommitment: true,
      stockHoldRequested: true,
      stockHoldWeeks: 12,
      stockHoldNote: 'Two months of safety stock at the plant',
    });
    const [row] = await db.db
      .select()
      .from(schema.quoteItem)
      .where(eq(schema.quoteItem.quoteId, out.quoteId));
    expect(row).toMatchObject({ label: longName, decorationTypes: ['SILK_SCREEN', 'OTHER'] });
    // Fabric (rule 10): the array's text companion is kept by the trigger.
    const [companion] = await db.db.execute<{ json: string }>(
      sql`select decoration_types_json as json from quote_item where id = ${row!.id}`,
    );
    expect(JSON.parse(companion!.json)).toEqual(['SILK_SCREEN', 'OTHER']);

    const detail = QuoteDetail.parse((await kam().get(`/api/v1/quotes/${out.quoteNumber}`)).json());
    expect(detail.intakeFacts).toMatchObject({
      decorationTypes: ['SILK_SCREEN', 'OTHER'],
      toolingCommitment: true,
      stockHoldRequested: true,
      stockHoldWeeks: 12,
    });
  });

  it('refuses a 121-character name and an unknown decoration type', async () => {
    const data = await request(nextFree());
    const long = await kam().post('/api/v1/quotes/drafts', {
      data: { ...data, items: [item(KEY(5), { label: 'x'.repeat(121) })] },
    });
    expect(long.statusCode).toBe(400);
    const unknown = await kam().post('/api/v1/quotes/drafts', {
      data: {
        ...data,
        items: [
          item(KEY(6), {
            components: ['CONTAINER', 'DECORATION'],
            decorationTypes: ['EMBOSS'],
            decorationPrintColors: 1,
          }),
        ],
      },
    });
    expect(unknown.statusCode).toBe(422);
  });

  it('weeks and the note are dropped unless the customer wants stock held', async () => {
    const draft = await createDraft({
      ...(await request(nextFree())),
      stockHoldRequested: false,
      stockHoldWeeks: 4,
      stockHoldNote: 'not applicable',
      items: [item(KEY(7), { drawingStatus: 'HAVE_DRAWING' })],
    });
    const res = await submit(draft.id);
    ok(res, 201);
    const out = SubmitIntakeResponse.parse(res.json());
    const [quote] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, out.quoteId));
    expect(quote).toMatchObject({
      stockHoldRequested: false,
      stockHoldWeeks: null,
      stockHoldNote: null,
      termsToolingCommitment: null,
    });
  });
});
