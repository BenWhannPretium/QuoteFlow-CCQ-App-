/**
 * FB-02 intake overhaul (§3–5): product facts, component follow-ups, the drawing-or-minimum-spec rule,
 * the RFP link and mold modification. Its own database so the free SF opportunities go further.
 */
import {
  INTAKE_PROBLEM_CODES,
  IntakeDraft,
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
    subMarket: 'FOOD_SNACKS', // FB-15 (W13-02): required
    resin: 'HDPE',
    neckDiameter: '38',
    neckFinishType: '400',
    pcrLevel: '0',
    colorType: 'NATURAL',
    // F-016: the minimum spec, so these intakes submit without a drawing file.
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

async function createDraft(data: IntakeDraftData, role: Parameters<typeof asRole>[1] = 'KAM') {
  const res = await asRole(app, role).post('/api/v1/quotes/drafts', { data });
  expect(res.statusCode, res.body).toBe(201);
  return IntakeDraft.parse(res.json());
}

const submit = (id: string, role: Parameters<typeof asRole>[1] = 'KAM') =>
  asRole(app, role).post(`/api/v1/quotes/drafts/${id}/submit`);

beforeAll(async () => {
  const fresh = await freshSfDatabase('intake_fb02');
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
      // F-016: the minimum spec, so these intakes submit without a drawing file.
      heightMm: 180,
      widthOrDiameterMm: 65,
      depthMm: 65,
      gramWeightG: 24,
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

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n', 'latin1');

/** Uploads a file to a draft as the KAM (multipart: kind and size first, then the file). */
async function uploadToDraft(draftId: string, kind: string, name = 'drawing.pdf') {
  const boundary = `----ccq${Math.random().toString(16).slice(2)}`;
  const field = (k: string, v: string) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  const payload = Buffer.concat([
    Buffer.from(field('kind', kind) + field('size', String(PDF.length))),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
    PDF,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: 'POST',
    url: `/api/v1/quotes/drafts/${draftId}/attachments`,
    headers: {
      'x-dev-user': 'kam',
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
}

describe('drawing or minimum spec (FB-02 §5: F-016, D-018, T-022)', () => {
  const noSpec = {
    heightMm: null,
    widthOrDiameterMm: null,
    depthMm: null,
    gramWeightG: null,
  };

  it('no drawing and a missing gram weight: 422 DRAWING_OR_MIN_SPEC_REQUIRED naming the field', async () => {
    const data = { ...(await prefill(nextFree())), drawingStatus: 'NONE', gramWeightG: null };
    const draft = await createDraft(data);
    expect(draft.evaluation.blocking).toHaveLength(1);
    const [issue] = draft.evaluation.blocking;
    expect(issue).toMatchObject({
      code: 'DRAWING_OR_MIN_SPEC_REQUIRED',
      missing: ['gram_weight_g'],
    });
    expect(issue!.message).toContain('Missing: gram weight.');
    const res = await submit(draft.id);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: INTAKE_PROBLEM_CODES.drawingOrMinSpecRequired,
      missing: ['gram_weight_g'],
    });
    // Filling it in submits (no drawing: amber only).
    await kam().patch(`/api/v1/quotes/drafts/${draft.id}`, { data: { gramWeightG: 24.5 } });
    const ok = await submit(draft.id);
    expect(ok.statusCode, ok.body).toBe(201);
    const body = SubmitIntakeResponse.parse(ok.json());
    expect(body.warnings.map((w) => w.code)).toContain('DRAWING_MISSING');
    const [quote] = await db.db
      .select()
      .from(schema.quote)
      .where(eq(schema.quote.id, body.quoteId));
    expect(quote).toMatchObject({ heightMm: 180, gramWeightG: 24.5 });
  });

  it('a drawing status alone no longer counts; an attached competitor drawing does', async () => {
    const data = { ...(await prefill(nextFree())), ...noSpec, drawingStatus: 'HAVE_DRAWING' };
    const draft = await createDraft(data);
    expect(draft.evaluation.blocking.map((b) => b.code)).toEqual(['DRAWING_OR_MIN_SPEC_REQUIRED']);
    expect((await submit(draft.id)).statusCode).toBe(422);

    // F-014: the new kinds upload; a bid file or brief is not a drawing, a competitor drawing is.
    for (const kind of ['bid_file', 'project_brief']) {
      const up = await uploadToDraft(draft.id, kind, `${kind}.pdf`);
      expect(up.statusCode, up.body).toBe(201);
    }
    const still = IntakeDraft.parse((await kam().get(`/api/v1/quotes/drafts/${draft.id}`)).json());
    expect(still.evaluation.ready).toBe(false);
    const drawing = await uploadToDraft(draft.id, 'competitor_drawing', 'incumbent.pdf');
    expect(drawing.statusCode, drawing.body).toBe(201);
    const now = IntakeDraft.parse((await kam().get(`/api/v1/quotes/drafts/${draft.id}`)).json());
    expect(now.evaluation.ready).toBe(true);
    expect(now.evaluation.warnings.map((w) => w.code)).not.toContain('DRAWING_MISSING');
    const res = await submit(draft.id);
    expect(res.statusCode, res.body).toBe(201);
  });

  it('the minimum spec is config: without gramWeight in the setting the same intake submits', async () => {
    const [before] = await db.db.execute<{ value: unknown }>(
      sql`select value from app_setting where key = 'intake_min_spec_fields'`,
    );
    const without = (before!.value as string[]).filter((k) => k !== 'gramWeight');
    await db.db.execute(
      sql`update app_setting set value = ${JSON.stringify(without)}::jsonb where key = 'intake_min_spec_fields'`,
    );
    try {
      const data = { ...(await prefill(nextFree())), drawingStatus: 'NONE', gramWeightG: null };
      expect((await submit((await createDraft(data)).id)).statusCode).toBe(201);
    } finally {
      await db.db.execute(
        sql`update app_setting set value = ${JSON.stringify(before!.value)}::jsonb where key = 'intake_min_spec_fields'`,
      );
    }
  });
});

describe('RFP link and mold modification (FB-02 §5: F-014, F-015)', () => {
  it('the RFP link must be https; it is stored and every role that reads the quote sees it', async () => {
    const data = await prefill(nextFree());
    const draft = await createDraft({ ...data, rfpLink: 'http://portal.example.com/rfp/9' });
    expect(draft.evaluation.blocking.map((b) => `${b.code}:${b.field}`)).toEqual([
      'INVALID_VALUE:rfp_link',
    ]);
    expect((await submit(draft.id)).statusCode).toBe(422);
    await kam().patch(`/api/v1/quotes/drafts/${draft.id}`, {
      data: { rfpLink: 'https://portal.example.com/rfp/9' },
    });
    const res = await submit(draft.id);
    expect(res.statusCode, res.body).toBe(201);
    const { quoteNumber } = SubmitIntakeResponse.parse(res.json());
    for (const role of [
      'KAM',
      'SalesLeader',
      'EngLead',
      'Pricing',
      'Approver',
      'Leadership',
    ] as const) {
      const detail = await asRole(app, role).get(`/api/v1/quotes/${quoteNumber}`);
      expect(detail.statusCode, role).toBe(200);
      expect(QuoteDetail.parse(detail.json()).intakeFacts.rfpLink).toBe(
        'https://portal.example.com/rfp/9',
      );
    }
  });

  it('modify an existing mold needs the mold / part number and what changes; stored when ticked', async () => {
    const data = { ...(await prefill(nextFree())), modifyExistingMold: true };
    const draft = await createDraft(data);
    expect(draft.evaluation.blocking.map((b) => `${b.code}:${b.field}`)).toEqual([
      'MISSING_FIELD:existing_mold_ref',
      'MISSING_FIELD:mold_change_description',
    ]);
    await kam().patch(`/api/v1/quotes/drafts/${draft.id}`, {
      data: { existingMoldRef: 'M-10421', moldChangeDescription: 'finish change 28-410 → 28-400' },
    });
    const res = await submit(draft.id);
    expect(res.statusCode, res.body).toBe(201);
    const [quote] = await db.db
      .select()
      .from(schema.quote)
      .where(eq(schema.quote.id, SubmitIntakeResponse.parse(res.json()).quoteId));
    expect(quote).toMatchObject({
      modifyExistingMold: true,
      existingMoldRef: 'M-10421',
      moldChangeDescription: 'finish change 28-410 → 28-400',
    });
  });
});
