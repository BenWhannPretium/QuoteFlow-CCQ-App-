import {
  AttachmentListResponse,
  AttachmentUploadResponse,
  IntakeDraft,
  MeResponse,
  QuoteDetail,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import type { Role } from '@ccq/domain';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prepareBom, uploadModel } from './model-helpers';
import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * FB-07 (D-001, D-031; F-031, F-032, F-074, F-081, F-083; T-017 upload part, T-034): costing, then
 * ROI, then price approved, as steps inside Quoting. Pricing uploads the costing model, Finance the ROI
 * model (only when capital is required), the pricing lead approves the price (G3), optionally with an
 * updated price table. Each model is one record per quote with version history.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-11-09T15:00:00Z');
const HOUR = 3_600_000;
const tick = (ms = HOUR) => {
  clock = new Date(clock.getTime() + ms);
};

let free: string[] = [];
const as = (role: Role) => asRole(app, role);
const ids: Partial<Record<Role, string>> = {};
async function userId(role: Role): Promise<string> {
  ids[role] ??= MeResponse.parse((await as(role).get('/api/v1/me')).json()).user.id;
  return ids[role];
}
const decide = (qn: string, gate: string, body: Record<string, unknown>, role: Role) =>
  as(role).post(`/api/v1/quotes/${qn}/gates/${gate}/decisions`, body);
const ok = (res: { statusCode: number; body: string }, status = 201) =>
  expect(res.statusCode, res.body).toBe(status);
const code = (res: { json: () => unknown }) => (res.json() as { code?: string }).code;

async function prefill(sfOpportunityId: string, over: IntakeDraftData = {}) {
  const sf = SfOpportunityDetail.parse(
    (await as('KAM').get(`/api/v1/salesforce/opportunities/${sfOpportunityId}`)).json(),
  );
  const shipTo = {
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
      status: 'existing' as const,
      sfAccountId: sf.account?.id ?? sf.opportunity.accountId,
      name: sf.account?.name ?? sf.opportunity.accountName,
    },
    shipTo,
    shipToDefault: shipTo,
    requestClass: 'CCQ',
    productFamily: 'BOTTLE',
    components: ['CONTAINER'],
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
    estAnnualVolume: 750_000,
    estAnnualRevenue: 150_000,
    quoteNeededBy: '2026-12-15',
    productNeededBy: '2027-03-01',
    containerSize: '16 oz',
    standardDescription: '16 oz Bottle, HDPE',
    drawingStatus: 'HAVE_DRAWING',
    ...over,
  };
}

/** A quote Engineering cleared into Quoting with the given G2 outcome. */
async function inQuoting(g2: 'proceed' | 'capital_required' = 'proceed') {
  const id = free.shift();
  if (!id) throw new Error('test ran out of free opportunities');
  const res = await as('KAM').post('/api/v1/quotes/drafts', { data: await prefill(id) });
  ok(res);
  const sub = await as('KAM').post(
    `/api/v1/quotes/drafts/${IntakeDraft.parse(res.json()).id}/submit`,
  );
  ok(sub);
  const { quoteNumber: qn } = SubmitIntakeResponse.parse(sub.json());
  ok(await decide(qn, 'G1', { outcomeKey: 'advance' }, 'SalesLeader'));
  ok(
    await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, {
      processType: 'EBM',
      machineType: 'EBM',
      plantCode: 'AURORA',
      cavitation: 8,
      cycleTimeS: 14.5,
      prelimCapitalUsd: 250_000,
    }),
    200,
  );
  ok(
    await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
      rows: [
        {
          site: 'AURORA',
          assumedEffectivenessPct: 70,
          cycleTimeS: 14.5,
          utilizationBeforePct: 62,
          analysisDate: '2026-10-26',
          analystId: await userId('Engineer'),
        },
      ],
    }),
    200,
  );
  ok(await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-signoff`, { status: 'approved' }), 200);
  // FB-06 (F-058): "Capital required" needs the equipment BOM on file.
  if (g2 === 'capital_required') await prepareBom(app, qn);
  ok(
    await decide(
      qn,
      'G2',
      g2 === 'proceed' ? { outcomeKey: g2 } : { outcomeKey: g2, note: 'New mold set' },
      'EngLead',
    ),
  );
  tick();
  return qn;
}

async function detail(qn: string, role: Role = 'Pricing') {
  const res = await as(role).get(`/api/v1/quotes/${qn}`);
  ok(res, 200);
  return QuoteDetail.parse(res.json());
}
const steps = async (qn: string, role: Role = 'Pricing') => (await detail(qn, role)).quoting.steps;
async function files(qn: string, role: Role = 'Pricing') {
  const res = await as(role).get(`/api/v1/quotes/${qn}/attachments`);
  ok(res, 200);
  return AttachmentListResponse.parse(res.json()).items;
}
const quoteId = async (qn: string) =>
  (await db.db.select().from(schema.quote).where(eq(schema.quote.quoteNumber, qn)))[0]!.id;
async function notified(qn: string, type: string) {
  const rows = await db.db
    .select({ userId: schema.notification.userId, channel: schema.notification.channel })
    .from(schema.notification)
    .where(
      and(eq(schema.notification.quoteId, await quoteId(qn)), eq(schema.notification.type, type)),
    );
  return rows;
}
async function usersWithRole(role: string) {
  const rows = await db.db.execute<{ id: string }>(sql`
    select distinct u.id from app_user u join user_role r on r.user_id = u.id
    where r.role = ${role} and u.active`);
  return rows.map((r) => r.id).sort();
}

/** The pricer's part, ready for the lead: approval named, costing attested, capital status. */
async function pricingRecorded(qn: string) {
  ok(
    await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
      approvedBy: await userId('Pricing'),
      approvedAt: new Date(clock.getTime() - HOUR).toISOString(),
      costingCompleted: true,
    }),
    200,
  );
  ok(
    await as('Pricing').put(`/api/v1/quotes/${qn}/capital-readiness`, {
      capitalReadiness: 'pre_approved',
    }),
    200,
  );
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('quoting_steps');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url, RATE_LIMIT_MAX: '100000' }), {
    db,
    now: () => clock,
  });
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

describe('F-083: the Finance role', () => {
  it('signs in with quote.read, quote.read.commercialFields and roi.upload, and nothing else', async () => {
    const me = MeResponse.parse((await as('Finance').get('/api/v1/me')).json());
    expect(me.roles).toEqual(['Finance']);
    expect([...me.permissions].sort()).toEqual([
      'quote.read',
      'quote.read.commercialFields',
      'roi.upload',
    ]);
  });

  it('reads the quote, its Quoting tab and its files; changes nothing else', async () => {
    const qn = await inQuoting('capital_required');
    ok(await uploadModel(app, qn, 'cost_model', 'Pricing'));
    const d = await detail(qn, 'Finance');
    // The upload completes the costing step (Bailey Schmitt, 2026-11-12), so the payback step is next.
    expect(d.quoting.steps.roi).toMatchObject({
      required: true,
      status: 'waiting',
      canUpload: true,
    });
    expect(d.quoting.commercialRedacted).toBe(false);
    const list = await files(qn, 'Finance');
    expect(list.map((f) => f.kind)).toContain('cost_model');
    expect(
      (await as('Finance').get(`/api/v1/attachments/${list[0]!.id}/download?format=json`))
        .statusCode,
    ).toBe(200);
    // Everything else is refused at the route gate.
    expect((await as('Finance').put(`/api/v1/quotes/${qn}/pricing-record`, {})).statusCode).toBe(
      403,
    );
    expect(
      (
        await as('Finance').put(`/api/v1/quotes/${qn}/capital-readiness`, {
          capitalReadiness: 'pending',
        })
      ).statusCode,
    ).toBe(403);
    expect((await uploadModel(app, qn, 'cost_model', 'Finance')).statusCode).toBe(403);
    expect((await as('Finance').get('/api/v1/queue/pricing')).statusCode).toBe(403);
    expect((await decide(qn, 'G3', { outcomeKey: 'submit' }, 'Finance')).statusCode).toBe(403);
    expect((await as('Finance').post('/api/v1/quotes/drafts', { data: {} })).statusCode).toBe(403);
  });
});

describe('D-001: costing, then ROI, then price approved (capital required)', () => {
  it('runs the sequence, versions every model, tells the next person and locks after G3', async () => {
    const qn = await inQuoting('capital_required');
    let s = await steps(qn);
    expect(s.current).toBe('costing');
    expect(s.roi.reasons).toEqual(['Engineering’s decision: Advance – capital required']);
    expect([s.costing.status, s.roi.status, s.price.status]).toEqual([
      'waiting',
      'blocked',
      'blocked',
    ]);

    // Step 2 cannot start before step 1, and costing cannot be attested without its model.
    const early = await uploadModel(app, qn, 'roi_model', 'Finance');
    expect(early.statusCode).toBe(409);
    expect(early.body).toContain('Costing comes first');
    const attest = await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
      costingCompleted: true,
    });
    expect(attest.statusCode).toBe(422);
    expect(attest.body).toContain('Upload the costing model first');

    // Who may upload the costing model: Pricing and the pricing lead only.
    for (const role of ['KAM', 'SalesLeader', 'EngLead', 'Engineer'] as Role[]) {
      expect((await uploadModel(app, qn, 'cost_model', role)).statusCode, role).toBe(403);
    }

    // Step 1: costing. Version 1, then version 2 (T-034: one record, history kept, latest flagged).
    const v1 = await uploadModel(app, qn, 'cost_model', 'Pricing', 'Costing model.xlsx');
    ok(v1);
    expect(AttachmentUploadResponse.parse(v1.json()).item).toMatchObject({
      kind: 'cost_model',
      version: 1,
      current: true,
    });
    const finance = await usersWithRole('Finance');
    expect(
      (await notified(qn, 'quote.ready_for_roi'))
        .filter((n) => n.channel === 'in_app')
        .map((n) => n.userId)
        .sort(),
    ).toEqual(finance);
    tick();
    const v2 = await uploadModel(app, qn, 'cost_model', 'Pricing', 'Costing model.xlsx');
    ok(v2);
    const second = AttachmentUploadResponse.parse(v2.json()).item;
    expect(second).toMatchObject({ version: 2, current: true });
    const models = (await files(qn)).filter((f) => f.kind === 'cost_model');
    expect(models.map((f) => [f.version, f.current, f.supersededById])).toEqual([
      [1, false, second.id],
      [2, true, null],
    ]);
    ok(await as('Pricing').get(`/api/v1/attachments/${models[0]!.id}/download?format=json`), 200);
    await pricingRecorded(qn);
    s = await steps(qn);
    expect(s.costing).toMatchObject({ status: 'done', attested: true });
    expect(s.costing.model).toMatchObject({
      version: 2,
      versions: 2,
      fileName: 'Costing model.xlsx',
    });
    expect(s.costing.attestedByName).toBeTruthy();
    expect([s.current, s.roi.status, s.price.status]).toEqual(['roi', 'waiting', 'blocked']);

    // The lead cannot approve the price yet: the ROI model is missing.
    const noRoi = await decide(qn, 'G3', { outcomeKey: 'submit' }, 'PricingLead');
    expect(noRoi.statusCode).toBe(422);
    expect(noRoi.body).toContain('roi_required,roi_model_on_file');

    // Step 2: ROI. Pricing cannot upload it (no roi.upload); Finance can, and the lead is told.
    expect((await uploadModel(app, qn, 'roi_model', 'Pricing')).statusCode).toBe(403);
    tick();
    ok(await uploadModel(app, qn, 'roi_model', 'Finance', 'ROI board template.xlsx'));
    expect(
      (await notified(qn, 'quote.roi_uploaded'))
        .filter((n) => n.channel === 'in_app')
        .map((n) => n.userId)
        .sort(),
    ).toEqual(await usersWithRole('PricingLead'));
    s = await steps(qn);
    expect(s.roi).toMatchObject({ status: 'done', olderThanCostModel: false });
    expect(s.roi.model).toMatchObject({ version: 1, fileName: 'ROI board template.xlsx' });
    expect([s.current, s.price.status]).toEqual(['price', 'waiting']);
    expect(s.price.canUploadPriceTable).toBe(false); // the pricer is not the lead
    expect((await steps(qn, 'PricingLead')).price.canUploadPriceTable).toBe(true);

    // Step 3: the optional price table is the lead's; then the lead approves the price.
    expect((await uploadModel(app, qn, 'price_table', 'Pricing')).statusCode).toBe(403);
    ok(await uploadModel(app, qn, 'price_table', 'PricingLead'));
    const g3 = await decide(qn, 'G3', { outcomeKey: 'submit' }, 'PricingLead');
    ok(g3);
    s = await steps(qn);
    expect(s.current).toBe('done');
    expect(s.price).toMatchObject({ status: 'done' });
    expect(s.price.confirmedByName).toBeTruthy();
    expect(s.price.priceTable).toMatchObject({ version: 1 });

    // Locked after G3 (FB-01): 409 SECTION_LOCKED for every model, and the uploads are refused.
    for (const [kind, role] of [
      ['cost_model', 'Pricing'],
      ['roi_model', 'Finance'],
      ['price_table', 'PricingLead'],
    ] as const) {
      const locked = await uploadModel(app, qn, kind, role);
      expect(locked.statusCode, kind).toBe(409);
      expect(code(locked), kind).toBe('SECTION_LOCKED');
    }
    const fin = await steps(qn, 'Finance');
    expect([fin.costing.canUpload, fin.roi.canUpload, fin.price.canUploadPriceTable]).toEqual([
      false,
      false,
      false,
    ]);

    // Every step is on the timeline: who uploaded which version, and the approval.
    const events = await db.db
      .select({ type: schema.activityEvent.type, payload: schema.activityEvent.payload })
      .from(schema.activityEvent)
      .where(
        and(
          eq(schema.activityEvent.quoteId, await quoteId(qn)),
          eq(schema.activityEvent.type, 'attachment_uploaded'),
        ),
      );
    expect(
      events
        .map((e) => {
          const p = e.payload as { kind: string; version: number };
          return `${p.kind} v${p.version}`;
        })
        // The query has no ORDER BY and the test clock is fixed, so the rows can come back in any order:
        // compare as a set (this failed on CI when roi_model and price_table swapped).
        .sort(),
      // FB-06: Engineering's equipment BOM (uploaded before G2 "Capital required") is on the timeline too.
    ).toEqual(
      [
        'equipment_bom v1',
        'cost_model v1',
        'cost_model v2',
        'roi_model v1',
        'price_table v1',
      ].sort(),
    );
    const audits = await db.db
      .select({ action: schema.auditEvent.action, entity: schema.auditEvent.entity })
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.quoteId, await quoteId(qn)),
          eq(schema.auditEvent.entity, 'attachment'),
        ),
      );
    // 4 uploads + 1 supersede.
    // Four model uploads and the equipment BOM (FB-06).
    expect(audits.filter((a) => a.action === 'upload')).toHaveLength(5);
    expect(audits.filter((a) => a.action === 'update')).toHaveLength(1);

    // A send-back to Quoting reopens the steps: a new version, costing to attest again, uploads open.
    tick();
    ok(
      await decide(
        qn,
        'G4',
        { outcomeKey: 'return', note: 'Re-check the price', targetStageKey: 'QUOTING' },
        'Approver',
      ),
    );
    s = await steps(qn);
    expect([s.current, s.costing.status, s.price.status]).toEqual([
      'costing',
      'waiting',
      'blocked',
    ]);
    expect(s.costing.model).toMatchObject({ version: 2 });
    expect(s.costing.canUpload).toBe(true);
    expect((await steps(qn, 'Finance')).roi.status).toBe('done');
  });
});

describe('ROI not required (no capital)', () => {
  it('shows "not required" and why, refuses an ROI upload and lets the lead approve without it', async () => {
    const qn = await inQuoting('proceed');
    const s0 = await steps(qn);
    expect(s0.roi).toMatchObject({ required: false, status: 'not_required', canUpload: false });
    expect(s0.roi.notRequiredText).toMatch(/^Not required/);
    ok(await uploadModel(app, qn, 'cost_model', 'Pricing'));
    // Finance is not paged when no ROI is needed.
    expect(await notified(qn, 'quote.ready_for_roi')).toEqual([]);
    const roi = await uploadModel(app, qn, 'roi_model', 'Finance');
    expect(roi.statusCode).toBe(409);
    expect(roi.body).toContain('does not need a payback model');
    await pricingRecorded(qn);
    expect((await steps(qn)).current).toBe('price');
    ok(await decide(qn, 'G3', { outcomeKey: 'submit' }, 'PricingLead'));
  });

  it('a $0 CER funding model or the capital-likely flag requires the ROI (roi_required_when)', async () => {
    const qn = await inQuoting('proceed');
    const id = await quoteId(qn);
    await db.db.execute(sql`update quote set tooling_funding_model = 'ZERO_CER' where id = ${id}`);
    expect((await steps(qn)).roi.reasons).toEqual([
      'Tooling funding: $0 CER (customer-reimbursed capital)',
    ]);
    await db.db.execute(
      sql`update quote set tooling_funding_model = 'COMPANY_FUNDED', capital_likely = true where id = ${id}`,
    );
    expect((await steps(qn)).roi.reasons).toEqual(['Capital is flagged likely']);
  });
});

describe('versions (F-074)', () => {
  it('removing the current version (within the window) makes the previous one current again', async () => {
    const qn = await inQuoting('proceed');
    ok(await uploadModel(app, qn, 'cost_model', 'Pricing', 'v1.xlsx'));
    const v2 = AttachmentUploadResponse.parse(
      (await uploadModel(app, qn, 'cost_model', 'Pricing', 'v2.xlsx')).json(),
    ).item;
    ok(await as('Pricing').delete(`/api/v1/attachments/${v2.id}`), 204);
    const left = (await files(qn)).filter((f) => f.kind === 'cost_model');
    expect(left.map((f) => [f.fileName, f.version, f.current])).toEqual([['v1.xlsx', 1, true]]);
    expect((await steps(qn)).costing.model).toMatchObject({ version: 1, versions: 1 });
    // The next upload is version 3: numbers never repeat.
    expect(
      AttachmentUploadResponse.parse((await uploadModel(app, qn, 'cost_model', 'Pricing')).json())
        .item.version,
    ).toBe(3);
  });

  it('the models are uploaded on the Quoting tab, never on an intake draft or before Quoting', async () => {
    const draft = await as('KAM').post('/api/v1/quotes/drafts', {
      data: await prefill(free.shift()!),
    });
    ok(draft);
    const body = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);
    const boundary = '----ccqdraft';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\ncost_model\r\n--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n${body.length}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="c.xlsx"\r\n\r\n`,
      ),
      body,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/quotes/drafts/${IntakeDraft.parse(draft.json()).id}/attachments`,
      headers: { 'x-dev-user': 'kam', 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('uploaded on the Quoting tab');
  });
});

describe('open quotes from before FB-07 (grandfathered)', () => {
  it('keep working without a costing model and show "no model on file"', async () => {
    const qn = await inQuoting('proceed');
    const id = await quoteId(qn);
    // As migration 0031 leaves them: costing attested, no model, requirement grandfathered.
    await db.db.execute(sql`
      update pricing_record set costing_completed = true, costing_attested_at = now(),
        cost_model_requirement = 'grandfathered'
      where quote_id = ${id}`);
    const s = await steps(qn);
    expect(s.costing).toMatchObject({ status: 'done', noModelOnFile: true, model: null });
    const d = await detail(qn);
    expect(d.quoting.pricingRecord!.warnings.map((w) => w.code)).toContain('NO_COST_MODEL_ON_FILE');
    ok(
      await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
        approvedBy: await userId('Pricing'),
      }),
      200,
    );
    ok(
      await as('Pricing').put(`/api/v1/quotes/${qn}/capital-readiness`, {
        capitalReadiness: 'not_required',
      }),
      200,
    );
    ok(await decide(qn, 'G3', { outcomeKey: 'submit' }, 'PricingLead'));
  });
});

describe('F-081: "Price approved"', () => {
  it('the gate and its Advance say it', async () => {
    const qn = await inQuoting('proceed');
    const d = await detail(qn, 'PricingLead');
    const action = d.availableActions.find((a) => a.gateKey === 'G3' && a.outcomeKey === 'submit');
    expect(action?.outcomeLabel).toBe('Advance – price approved');
    expect(action?.gateLabel).toBe('Price approved');
    const cfg = await as('PricingLead').get('/api/v1/config/public');
    expect(cfg.body).toContain('"Price approved"');
    expect(cfg.body).not.toContain('capital ready');
  });
});
