import {
  IntakeDraft,
  MeResponse,
  QuoteDetail,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
  type IntakeItemData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import { ROLES, type Role } from '@ccq/domain';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { uploadBom } from './model-helpers';
import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * FB-23 (N18-03 to N18-10, N18-14; Jim Zweifel, 2026-11-18; Ben's D4, D5, D6): the engineering cost
 * estimate and pack-out, per item, on `PUT /quotes/:qn/eng-review`. Synthetic figures only.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
const clock = new Date('2026-11-19T15:00:00Z');

let free: string[] = [];
const nextFree = () => {
  const id = free.shift();
  if (!id) throw new Error('test ran out of free opportunities');
  return id;
};
const as = (role: Role) => asRole(app, role);
const ids: Partial<Record<Role, string>> = {};
async function userId(role: Role): Promise<string> {
  ids[role] ??= MeResponse.parse((await as(role).get('/api/v1/me')).json()).user.id;
  return ids[role];
}
const ok = (res: { statusCode: number; body: string }, status = 200) =>
  expect(res.statusCode, res.body).toBe(status);
const putReview = (qn: string, body: Record<string, unknown>, role: Role = 'EngLead') =>
  as(role).put(`/api/v1/quotes/${qn}/eng-review`, body);
const detail = async (qn: string, role: Role = 'EngLead') => {
  const res = await as(role).get(`/api/v1/quotes/${qn}`);
  ok(res);
  return QuoteDetail.parse(res.json());
};

const KEY = (n: number) => `0193f2a0-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function request(sfOpportunityId: string, over: IntakeDraftData = {}) {
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
    market: 'FOOD',
    subMarket: 'FOOD_SNACKS',
    estAnnualRevenue: 300_000,
    quoteNeededBy: '2026-12-15',
    ...over,
  } satisfies IntakeDraftData;
}

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
  standardDescription: '16 oz Bottle, HDPE',
  drawingStatus: 'HAVE_DRAWING',
  ...over,
});

/** A quote in Engineering Review (one item, or three), the engineer assigned. */
async function inEngineering(items: IntakeItemData[], over: IntakeDraftData = {}) {
  const res = await as('KAM').post('/api/v1/quotes/drafts', {
    data: { ...(await request(nextFree(), over)), items },
  });
  ok(res, 201);
  const sub = await as('KAM').post(
    `/api/v1/quotes/drafts/${IntakeDraft.parse(res.json()).id}/submit`,
  );
  ok(sub, 201);
  const { quoteNumber: qn, quoteId } = SubmitIntakeResponse.parse(sub.json());
  ok(
    await as('SalesLeader').post(`/api/v1/quotes/${qn}/gates/G1/decisions`, {
      outcomeKey: 'advance',
    }),
    201,
  );
  return { qn, quoteId };
}
const threeItems = () => [
  item(KEY(1)),
  item(KEY(2), { label: '24 oz bottle', containerSize: '24 oz' }),
  item(KEY(3), { label: '32 oz bottle', containerSize: '32 oz' }),
];
const assignEngineer = async (qn: string) =>
  ok(
    await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, {
      engineerId: await userId('Engineer'),
    }),
  );

beforeAll(async () => {
  const fresh = await freshSfDatabase('fb23_engineering_cost');
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
  expect(free.length).toBeGreaterThanOrEqual(6);
}, 180_000);
afterAll(async () => {
  await app.close();
});

describe('FB-23: cost lines, labor and pack-out per item on a three-item quote', () => {
  it('saves and reads each item’s own figures, with totals, the pack-out calculation and labor', async () => {
    const { qn, quoteId } = await inEngineering(threeItems(), { returnableDunnage: true });
    await assignEngineer(qn);
    const items = (await detail(qn)).engineering.items;
    expect(items).toHaveLength(3);
    const [one, two, three] = items as [(typeof items)[0], (typeof items)[0], (typeof items)[0]];

    // Item 1: tooling lines, a 15 % markup noted, labor and a bagged pack-out (Jim's first example).
    ok(
      await putReview(
        qn,
        {
          itemId: one.id,
          processType: 'EBM',
          moldLeadTime: ' 16-18 weeks ',
          toolingMarkupPct: 15,
          packersPerLine: 0.68,
          operatorsPerLine: 1,
          packMethod: 'BAGGED',
          packContainerItemNo: 'BAG-0001',
          packContainerDescription: 'Poly bag, 4 mil',
          unitsPerBag: 84,
          unitsPerCase: null,
          containersPerLayer: 2,
          layersPerPallet: 22,
          palletBuildHeight: '96 in',
          palletType: 'PALLET_40X48',
          palletsPerTrailer: 28,
          specialPackagingNote: 'Corner boards',
          returnableDunnageDescription: 'Plastic totes',
          returnableDunnageCostUsd: 1_250.5,
          costLines: [
            { lineKey: 'molds', amountUsd: 252_000 },
            { lineKey: 'freight', amountUsd: 1_500 },
            { lineKey: 'start_up', amountUsd: 5_500 },
            { lineKey: 'head_tooling', amountUsd: 12_000 },
            { lineKey: 'blow_molders', amountUsd: 1_000_000 },
          ],
        },
        'Engineer',
      ),
    );
    // Item 2: a carton pack-out (Jim's second example), lower blow molds freight, no markup noted.
    ok(
      await putReview(
        qn,
        {
          itemId: two.id,
          packMethod: 'CARTON',
          unitsPerCase: 256,
          containersPerLayer: 4,
          layersPerPallet: 5,
          palletsPerTrailer: 28,
          costLines: [
            { lineKey: 'molds', amountUsd: 40_000 },
            { lineKey: 'freight', amountUsd: 3_000, quantity: 4 },
            { lineKey: 'other', amountUsd: 900.25, description: 'Inspection fixture' },
          ],
        },
        'Engineer',
      ),
    );

    const eng = (await detail(qn, 'Pricing')).engineering;
    const r1 = eng.items[0]!.review;
    expect(r1).toMatchObject({
      moldLeadTime: '16-18 weeks',
      toolingMarkupPct: 15,
      unitsPerBag: 84,
      unitsPerPallet: 3_696, // written by the server from the calculation
      laborTotalPerLine: 1.68,
      returnableDunnageCostUsd: 1_250.5,
      costTotals: {
        projectTotalUsd: 1_271_000,
        customerFundedUsd: 259_000,
        netCostUsd: 1_012_000,
        markupPct: 15,
        markupNoted: true,
        customerToolingPriceUsd: 297_850,
      },
      packOut: {
        piecesPerContainer: 84,
        containersPerPallet: 44,
        piecesPerPallet: 3_696,
        piecesPerPalletCalculated: true,
        piecesPerTrailer: 103_488,
      },
    });
    expect(r1.costLines.map((l) => [l.lineKey, l.label, l.amountUsd])).toEqual([
      ['molds', 'Molds', 252_000],
      ['head_tooling', 'Head tooling', 12_000],
      ['freight', 'Freight', 1_500],
      ['start_up', 'Start-up assistance (3 days)', 5_500],
      ['blow_molders', 'Blow molders', 1_000_000],
    ]);
    const r2 = eng.items[1]!.review;
    expect(r2.packOut).toMatchObject({
      containersPerPallet: 20,
      piecesPerPallet: 5_120,
      piecesPerTrailer: 143_360,
    });
    expect(r2.costTotals).toMatchObject({
      customerFundedUsd: 43_000,
      netCostUsd: 900.25,
      markupNoted: false,
      customerToolingPriceUsd: 43_000, // no markup noted: equals customer funded (D5)
    });
    expect(r2.costLines.find((l) => l.lineKey === 'freight')?.quantity).toBe(4);
    expect(eng.items[2]!.review.costTotals).toBeNull();
    expect(eng.items[2]!.review.packOut?.piecesPerPallet).toBeNull();
    // The quote's totals are the sum over items; returnable dunnage was ticked at intake.
    expect(eng.costTotals).toEqual({
      projectTotalUsd: 1_314_900.25,
      customerFundedUsd: 302_000,
      netCostUsd: 1_012_900.25,
      customerToolingPriceUsd: 340_850,
    });
    expect(eng.returnableDunnage).toBe(true);
    // The budgetary capital estimate is not changed by the cost lines.
    expect(r1.prelimCapitalUsd).toBeNull();

    // Stored per item: one row per (item, line).
    const stored = await db.db
      .select()
      .from(schema.engCostLine)
      .where(eq(schema.engCostLine.quoteId, quoteId));
    expect(stored).toHaveLength(8);
    expect(new Set(stored.map((r) => r.quoteItemId))).toEqual(new Set([one.id, two.id]));
    void three;
  });

  it('removes a blank line, audits every line change and writes field names only to the timeline', async () => {
    const { qn, quoteId } = await inEngineering([item(KEY(1))]);
    ok(await putReview(qn, { costLines: [{ lineKey: 'molds', amountUsd: 10_000 }] }));
    ok(await putReview(qn, { costLines: [{ lineKey: 'molds', amountUsd: 12_000 }] }));
    ok(await putReview(qn, { costLines: [{ lineKey: 'molds', amountUsd: null }] }));
    // Sending the same value again changes nothing (no audit row).
    ok(await putReview(qn, { costLines: [{ lineKey: 'molds', amountUsd: null }] }));
    expect((await detail(qn)).engineering.review.costLines).toEqual([]);

    const audits = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.quoteId, quoteId), eq(schema.auditEvent.entity, 'eng_cost_line')),
      )
      .orderBy(schema.auditEvent.at, schema.auditEvent.id);
    expect(
      audits.map((a) => [a.action, (a.after as { amountUsd: number | null }).amountUsd]),
    ).toEqual([
      ['create', 10_000],
      ['update', 12_000],
      ['update', null],
    ]);
    expect((audits[2]!.after as { removed?: boolean }).removed).toBe(true);
    const events = await db.db
      .select()
      .from(schema.activityEvent)
      .where(
        and(
          eq(schema.activityEvent.quoteId, quoteId),
          eq(schema.activityEvent.type, 'eng_review_updated'),
        ),
      );
    expect(events).toHaveLength(3);
    for (const e of events) expect(e.payload).toEqual({ fields: ['costLines'] });
  });

  it('refuses an unknown line, Other without a description, and a pallet over the count limit', async () => {
    const { qn } = await inEngineering([item(KEY(1))]);
    const bad = await putReview(qn, {
      costLines: [
        { lineKey: 'nope', amountUsd: 1 },
        { lineKey: 'other', amountUsd: 5 },
      ],
    });
    expect(bad.statusCode, bad.body).toBe(422);
    expect(JSON.stringify(bad.json())).toMatch(/not a cost line/);
    expect(JSON.stringify(bad.json())).toMatch(/say what the cost is for/);
    const tooMany = await putReview(qn, {
      packMethod: 'BAGGED',
      unitsPerBag: 9_999_999,
      containersPerLayer: 10,
      layersPerPallet: 10,
    });
    expect(tooMany.statusCode, tooMany.body).toBe(422);
    expect(JSON.stringify(tooMany.json())).toMatch(/Pieces per pallet comes to/);
    expect((await putReview(qn, { packMethod: 'NOT_A_METHOD' })).statusCode).toBe(422);
    expect((await putReview(qn, { toolingMarkupPct: 100.5 })).statusCode).toBe(400);
  });

  it('with a method chosen keeps only its count; floor loaded uses the typed pieces per pallet', async () => {
    const { qn } = await inEngineering([item(KEY(1))]);
    ok(await putReview(qn, { unitsPerTray: 12, unitsPerPallet: 4_000 }));
    ok(
      await putReview(qn, {
        packMethod: 'BULK',
        palletType: 'FLOOR_LOADED',
        palletsPerTrailer: 26,
      }),
    );
    const r = (await detail(qn)).engineering.review;
    expect(r.unitsPerTray).toBeNull(); // bulk asks for no container count
    expect(r.packOut).toMatchObject({
      piecesPerPallet: 4_000,
      piecesPerPalletCalculated: false,
      piecesPerTrailer: 104_000,
    });
  });
});

describe('FB-23: locks and who may edit', () => {
  it('is read-only after G2 like the solution', async () => {
    const { qn } = await inEngineering([item(KEY(1))]);
    ok(
      await putReview(qn, {
        processType: 'EBM',
        machineType: 'EBM',
        plantCode: 'AURORA',
        cavitation: 8,
        cycleTimeS: 14.5,
        prelimCapitalUsd: 250_000,
        costLines: [{ lineKey: 'molds', amountUsd: 1 }],
      }),
    );
    ok(
      await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
        rows: [
          {
            site: 'AURORA',
            assumedEffectivenessPct: 70,
            cycleTimeS: 14.5,
            utilizationBeforePct: 62,
            analysisDate: '2026-11-19',
            analystId: await userId('Engineer'),
          },
        ],
      }),
    );
    ok(await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-signoff`, { status: 'approved' }));
    ok(await uploadBom(app, qn), 201);
    ok(
      await as('EngLead').post(`/api/v1/quotes/${qn}/gates/G2/decisions`, {
        outcomeKey: 'proceed',
      }),
      201,
    );
    const after = await putReview(qn, { costLines: [{ lineKey: 'molds', amountUsd: 2 }] });
    expect(after.statusCode, after.body).toBe(409);
    const still = await putReview(qn, { moldLeadTime: '20 weeks' });
    expect(still.statusCode).toBe(409);
    // Pricing still reads the figures.
    expect((await detail(qn, 'Pricing')).engineering.review.costLines[0]?.amountUsd).toBe(1);
  });

  it('is locked for the engineer while their part is submitted to the lead; the lead may still edit', async () => {
    const { qn } = await inEngineering([item(KEY(1))]);
    await assignEngineer(qn);
    ok(await as('Engineer').post(`/api/v1/quotes/${qn}/eng-review/accept`));
    ok(
      await putReview(
        qn,
        {
          processType: 'EBM',
          machineType: 'EBM',
          plantCode: 'AURORA',
          cavitation: 8,
          cycleTimeS: 14.5,
          prelimCapitalUsd: 0,
        },
        'Engineer',
      ),
    );
    ok(
      await as('Engineer').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
        rows: [
          {
            site: 'AURORA',
            assumedEffectivenessPct: 70,
            cycleTimeS: 14.5,
            utilizationBeforePct: 62,
            analysisDate: '2026-11-19',
            analystId: await userId('Engineer'),
          },
        ],
      }),
    );
    const submitted = await as('Engineer').post(`/api/v1/quotes/${qn}/eng-review/submit`);
    if (submitted.statusCode !== 200) {
      // The submit's own rules are FB-22's; this test is about the lock once submitted.
      throw new Error(`submit: ${submitted.statusCode} ${submitted.body}`);
    }
    const locked = await putReview(
      qn,
      { costLines: [{ lineKey: 'molds', amountUsd: 5 }] },
      'Engineer',
    );
    expect(locked.statusCode, locked.body).toBe(409);
    ok(await putReview(qn, { costLines: [{ lineKey: 'molds', amountUsd: 5 }] }, 'EngLead'));
  });

  it('permission matrix: EngLead and the assigned Engineer edit; every other role is refused; all read', async () => {
    const { qn } = await inEngineering([item(KEY(1))]);
    const body = (n: number) => ({
      costLines: [{ lineKey: 'molds', amountUsd: n }],
      moldLeadTime: `${n} weeks`,
    });
    // The Engineer is refused until assigned.
    expect((await putReview(qn, body(1), 'Engineer')).statusCode).toBe(403);
    ok(
      await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, {
        engineerId: await userId('Engineer'),
        schedulerId: await userId('ProductionScheduler'),
      }),
    );
    ok(await putReview(qn, body(2), 'EngLead'));
    let n = 3;
    // PostAward is P2 and has no dev persona (it holds no engReview.edit; matrix.int.test.ts covers the gate).
    for (const role of ROLES.filter((r) => r !== 'PostAward')) {
      const res = await putReview(qn, body(n++), role);
      if (role === 'EngLead' || role === 'Engineer') {
        expect(res.statusCode, `${role}: ${res.body}`).toBe(200);
      } else {
        // The production scheduler assigned to the quote edits capacity only, never the cost estimate.
        expect(res.statusCode, `${role}: ${res.body}`).toBe(403);
      }
      const read = await as(role).get(`/api/v1/quotes/${qn}`);
      if (read.statusCode === 200) {
        const eng = QuoteDetail.parse(read.json()).engineering;
        // Rule 2: every role that reads the quote sees the figures.
        expect(eng.review.costLines[0]?.amountUsd, role).toEqual(expect.any(Number));
        expect(eng.costTotals?.projectTotalUsd, role).toEqual(expect.any(Number));
      }
    }
  });
});
