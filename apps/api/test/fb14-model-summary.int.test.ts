import {
  AttachmentUploadResponse,
  IntakeDraft,
  MeResponse,
  ModelSummaryListResponse,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import type { Role } from '@ccq/domain';
import {
  buildCostingWorkbook,
  buildJunkWorkbook,
  buildPaybackWorkbook,
} from '@ccq/integrations/test/synthetic-workbooks';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prepareBom, uploadModel, uploadModelFile, XLSX } from './model-helpers';
import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * FB-14 (F-031 summary half, D-013, T-017 summary half): the one-page summary of an uploaded costing
 * or payback model, read from the workbook at upload against the config maps
 * (`app_setting.model_summary_templates`). Every workbook here is synthetic (ExcelJS, made-up round
 * numbers). A failed read never blocks the upload or G3; each version keeps its own summary.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-11-12T15:00:00Z');
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
const ok = (res: { statusCode: number; body: string }, status = 201) =>
  expect(res.statusCode, res.body).toBe(status);

async function prefill(sfOpportunityId: string): Promise<IntakeDraftData> {
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
  };
}

/** A quote Engineering cleared into Quoting with capital required (so it needs a payback model). */
async function inQuoting(): Promise<string> {
  const id = free.shift();
  if (!id) throw new Error('test ran out of free opportunities');
  const res = await as('KAM').post('/api/v1/quotes/drafts', { data: await prefill(id) });
  ok(res);
  const sub = await as('KAM').post(
    `/api/v1/quotes/drafts/${IntakeDraft.parse(res.json()).id}/submit`,
  );
  ok(sub);
  const { quoteNumber: qn } = SubmitIntakeResponse.parse(sub.json());
  ok(
    await as('SalesLeader').post(`/api/v1/quotes/${qn}/gates/G1/decisions`, {
      outcomeKey: 'advance',
    }),
  );
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
  await prepareBom(app, qn);
  ok(
    await as('EngLead').post(`/api/v1/quotes/${qn}/gates/G2/decisions`, {
      outcomeKey: 'capital_required',
      note: 'New mold set',
    }),
  );
  tick();
  return qn;
}

async function summaries(qn: string, role: Role = 'Pricing') {
  const res = await as(role).get(`/api/v1/quotes/${qn}/model-summaries`);
  ok(res, 200);
  return ModelSummaryListResponse.parse(res.json());
}
const summaryOf = async (qn: string, kind: string, role: Role = 'Pricing') =>
  (await summaries(qn, role)).summaries.find((s) => s.kind === kind)!;
const fieldsOf = (s: {
  fields: { key: string; state: string; number: number | null; text: string | null }[];
}) => Object.fromEntries(s.fields.map((f) => [f.key, f]));

const quoteId = async (qn: string) =>
  (await db.db.select().from(schema.quote).where(eq(schema.quote.quoteNumber, qn)))[0]!.id;

async function setSetting(key: string, value: unknown) {
  await db.db.update(schema.appSetting).set({ value }).where(eq(schema.appSetting.key, key));
}
async function costModelFirst(qn: string) {
  ok(await uploadModel(app, qn, 'cost_model', 'Pricing'));
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('fb14_model_summary');
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
  expect(free.length).toBeGreaterThanOrEqual(5);
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('FB-14: the payback summary', () => {
  let qn: string;

  it('Finance uploads the synthetic payback workbook: the summary is read, stored and audited', async () => {
    qn = await inQuoting();
    await costModelFirst(qn);
    const up = await uploadModelFile(
      app,
      qn,
      'roi_model',
      'Finance',
      'payback.synthetic.xlsx',
      await buildPaybackWorkbook({ definedNames: true }),
    );
    ok(up);
    const s = await summaryOf(qn, 'roi_model');
    expect(s).toMatchObject({
      status: 'complete',
      reason: null,
      templateId: 'payback_calculator',
      mapProvisional: true,
      version: 1,
      fileName: 'payback.synthetic.xlsx',
    });
    expect(typeof s.uploadedByName).toBe('string');
    const f = fieldsOf(s);
    expect(f.payback_years).toMatchObject({ state: 'ok', number: 2.5 });
    expect(f.incremental_annual_units).toMatchObject({ state: 'ok', number: 1_000_000 });
    expect(f.discount_rate).toMatchObject({ state: 'ok', number: 0.1 });
    expect(f.irr).toMatchObject({ state: 'ok', number: 0.25 });
    // The defined name was used where the workbook has it.
    expect(s.fields.find((x) => x.key === 'payback_years')!.definedName).toBe('QF_Payback');
    expect(s.warnings).toEqual([]);
    // The audit row says what was read, never a figure.
    const audit = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.entity, 'model_summary'), eq(schema.auditEvent.action, 'create')),
      );
    const mine = audit.filter(
      (a) => (a.after as { attachmentId?: string }).attachmentId === s.attachmentId,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]!.after).toEqual({
      attachmentId: s.attachmentId,
      kind: 'roi_model',
      version: 1,
      templateId: 'payback_calculator',
      status: 'complete',
      reason: null,
      fieldCount: 14,
    });
    expect(JSON.stringify(mine[0]!.after)).not.toContain('2.5');
  });

  it('carries an Excel error, a negative payback and a blank headline through, flagged, not blocking', async () => {
    tick();
    ok(
      await uploadModelFile(
        app,
        qn,
        'roi_model',
        'Finance',
        'payback-v2.synthetic.xlsx',
        await buildPaybackWorkbook({ irr: { error: '#NUM!' }, payback: -1.5, units: 'blank' }),
      ),
    );
    const s = await summaryOf(qn, 'roi_model');
    expect(s).toMatchObject({ version: 2, status: 'complete' });
    const f = fieldsOf(s);
    expect(f.irr).toMatchObject({ state: 'error', number: null });
    expect(f.payback_years).toMatchObject({ state: 'ok', number: -1.5 });
    expect(f.incremental_annual_units).toMatchObject({ state: 'blank', number: null });
    expect(s.warnings.map((w) => [w.code, w.fieldKey])).toEqual([
      ['blank', 'incremental_annual_units'],
      ['excel_error', 'irr'],
      ['non_positive', 'payback_years'],
    ]);
    expect(s.warnings[1]!.message).toBe(
      'The workbook shows an error in IRR. Ask Finance to check it.',
    );
  });

  it('a changed layout or a junk file is stored with "summary unavailable" and a reason', async () => {
    tick();
    ok(
      await uploadModelFile(
        app,
        qn,
        'roi_model',
        'Finance',
        'other.xlsx',
        await buildJunkWorkbook(),
      ),
    );
    let s = await summaryOf(qn, 'roi_model');
    expect(s).toMatchObject({
      version: 3,
      status: 'unavailable',
      reason: 'not_recognised',
      fields: [],
    });
    expect(s.reasonText).toMatch(/does not match a known template/);
    tick();
    ok(
      await uploadModelFile(
        app,
        qn,
        'roi_model',
        'Finance',
        'renamed.xlsx',
        await buildPaybackWorkbook({ title: 'SOMETHING ELSE' }),
      ),
    );
    expect((await summaryOf(qn, 'roi_model')).reason).toBe('not_recognised');
    tick();
    // Not a workbook at all (the content check only reads the zip header).
    ok(await uploadModelFile(app, qn, 'roi_model', 'Finance', 'broken.xlsx', XLSX));
    s = await summaryOf(qn, 'roi_model');
    expect(s).toMatchObject({ version: 5, status: 'unavailable', reason: 'unreadable' });
  });

  it('each version keeps its summary; removing the current one restores the previous summary', async () => {
    const before = await summaryOf(qn, 'roi_model');
    const rows = await db.db
      .select({ id: schema.modelSummary.id })
      .from(schema.modelSummary)
      .where(
        and(
          eq(schema.modelSummary.quoteId, await quoteId(qn)),
          eq(schema.modelSummary.kind, 'roi_model'),
        ),
      );
    expect(rows.length).toBeGreaterThanOrEqual(5);
    ok(await as('Finance').delete(`/api/v1/attachments/${before.attachmentId}`), 204);
    const after = await summaryOf(qn, 'roi_model');
    expect(after).toMatchObject({ version: 4, status: 'unavailable', reason: 'not_recognised' });
    // The removed version's summary is still on file (insert-only).
    const kept = await db.db
      .select()
      .from(schema.modelSummary)
      .where(eq(schema.modelSummary.attachmentId, before.attachmentId));
    expect(kept).toHaveLength(1);
  });

  it('the app role cannot change or delete a stored summary (insert-only)', async () => {
    for (const stmt of [
      sql`update model_summary set status = 'complete'`,
      sql`delete from model_summary_field`,
    ]) {
      const err = await db.db
        .transaction(async (tx) => {
          await tx.execute(sql`set local role ccq_app`);
          await tx.execute(stmt);
        })
        .then(
          () => null,
          (e: unknown) => e as { message: string; cause?: { message?: string } },
        );
      expect(err?.cause?.message ?? err?.message).toMatch(/permission denied/);
    }
  });

  it('the pricing lead may upload the payback model too, and its summary is read', async () => {
    const q2 = await inQuoting();
    await costModelFirst(q2);
    ok(
      await uploadModelFile(
        app,
        q2,
        'roi_model',
        'PricingLead',
        'lead.synthetic.xlsx',
        await buildPaybackWorkbook(),
      ),
    );
    expect((await summaryOf(q2, 'roi_model')).status).toBe('complete');
  });
});

describe('FB-14: the costing map is inactive; the framework works once a map is active', () => {
  it('a costing upload is quietly "not configured", then read when an Admin activates a map', async () => {
    const qn = await inQuoting();
    ok(
      await uploadModelFile(
        app,
        qn,
        'cost_model',
        'Pricing',
        'cost.synthetic.xlsx',
        await buildCostingWorkbook(),
      ),
    );
    let s = await summaryOf(qn, 'cost_model');
    expect(s).toMatchObject({ status: 'not_configured', reason: null, warnings: [] });
    const [row] = await db.db
      .select({ value: schema.appSetting.value })
      .from(schema.appSetting)
      .where(eq(schema.appSetting.key, 'model_summary_templates'));
    const maps = row!.value as { templateId: string; active: boolean }[];
    await setSetting(
      'model_summary_templates',
      maps.map((m) => (m.templateId === 'erf_costing_pre_makeover' ? { ...m, active: true } : m)),
    );
    try {
      tick();
      ok(
        await uploadModelFile(
          app,
          qn,
          'cost_model',
          'Pricing',
          'cost-v2.synthetic.xlsx',
          await buildCostingWorkbook(),
        ),
      );
      s = await summaryOf(qn, 'cost_model');
      expect(s).toMatchObject({
        version: 2,
        status: 'complete',
        templateId: 'erf_costing_pre_makeover',
      });
      expect(fieldsOf(s).unit_cost).toMatchObject({ state: 'ok', number: 100 });
      expect(fieldsOf(s).contribution_margin_pct).toMatchObject({ state: 'ok', number: 0.3 });
    } finally {
      await setSetting('model_summary_templates', maps);
    }
  });
});

describe('FB-14: limits, visibility and who reads it', () => {
  it('a file over the size cap is stored, with "too large"', async () => {
    const qn = await inQuoting();
    await costModelFirst(qn);
    await setSetting('model_summary_limits', {
      maxBytes: 2048,
      timeoutMs: 5000,
      maxCells: 200_000,
    });
    try {
      ok(
        await uploadModelFile(
          app,
          qn,
          'roi_model',
          'Finance',
          'big.xlsx',
          await buildPaybackWorkbook(),
        ),
      );
      expect(await summaryOf(qn, 'roi_model')).toMatchObject({
        status: 'unavailable',
        reason: 'too_large',
      });
    } finally {
      await setSetting('model_summary_limits', {
        maxBytes: 15_728_640,
        timeoutMs: 5000,
        maxCells: 200_000,
      });
    }
  });

  it('every role that reads the quote reads its summary; nothing more is denied than the quote', async () => {
    const qn = await inQuoting();
    await costModelFirst(qn);
    ok(
      await uploadModelFile(
        app,
        qn,
        'roi_model',
        'Finance',
        'p.synthetic.xlsx',
        await buildPaybackWorkbook(),
      ),
    );
    const roles: Role[] = [
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
    for (const role of roles) {
      const quote = await as(role).get(`/api/v1/quotes/${qn}`);
      const res = await as(role).get(`/api/v1/quotes/${qn}/model-summaries`);
      expect(res.statusCode, `${role}: ${res.body}`).toBe(quote.statusCode);
      if (res.statusCode === 200) {
        const body = ModelSummaryListResponse.parse(res.json());
        expect(body.visible).toBe(true);
        expect(body.summaries.find((s) => s.kind === 'roi_model')!.status).toBe('complete');
      }
    }
    const anon = await app.inject({ method: 'GET', url: `/api/v1/quotes/${qn}/model-summaries` });
    expect(anon.statusCode).toBe(401);
  });

  it('model_summary_visible off sends no figure to any role', async () => {
    const qn = await inQuoting();
    await costModelFirst(qn);
    ok(
      await uploadModelFile(
        app,
        qn,
        'roi_model',
        'Finance',
        'p.synthetic.xlsx',
        await buildPaybackWorkbook(),
      ),
    );
    await setSetting('model_summary_visible', false);
    try {
      for (const role of ['Pricing', 'Finance', 'Approver', 'KAM'] as Role[]) {
        const res = await as(role).get(`/api/v1/quotes/${qn}/model-summaries`);
        if (res.statusCode !== 200) continue;
        const body = ModelSummaryListResponse.parse(res.json());
        expect(body).toMatchObject({ visible: false, summaries: [] });
        expect(body.hiddenText).toMatch(/turned off/);
      }
    } finally {
      await setSetting('model_summary_visible', true);
    }
  });

  it('a version uploaded before FB-14 (no summary row) says so', async () => {
    const qn = await inQuoting();
    const up = AttachmentUploadResponse.parse(
      (await uploadModel(app, qn, 'cost_model', 'Pricing')).json(),
    );
    const [summary] = await db.db
      .select({ id: schema.modelSummary.id })
      .from(schema.modelSummary)
      .where(eq(schema.modelSummary.attachmentId, up.item.id));
    await db.db
      .delete(schema.modelSummaryField)
      .where(eq(schema.modelSummaryField.summaryId, summary!.id));
    await db.db.delete(schema.modelSummary).where(eq(schema.modelSummary.attachmentId, up.item.id));
    expect(await summaryOf(qn, 'cost_model')).toMatchObject({ status: 'none', fields: [] });
  });
});
