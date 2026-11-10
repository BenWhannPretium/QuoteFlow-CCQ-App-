import {
  IntakeDraft,
  PublicConfigResponse,
  QuoteDetail,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import type { Role } from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * FB-13 (F-057): Jim Zweifel's 22 plants and 14 machine types (2026-11-10). The Engineering Review takes
 * the new codes; the retired placeholders are refused on a write but stay readable on an old quote; and
 * the FB-06 routing suggestion keys on the process type, so it is unchanged by the new machine types.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let free: string[] = [];
const as = (role: Role) => asRole(app, role);
const ok = (res: { statusCode: number; body: string }, status = 200) =>
  expect(res.statusCode, res.body).toBe(status);
const putReview = (qn: string, body: Record<string, unknown>, role: Role = 'EngLead') =>
  as(role).put(`/api/v1/quotes/${qn}/eng-review`, body);
const errorPaths = (res: { json: () => unknown }) =>
  ((res.json() as { errors?: { path: string }[] }).errors ?? []).map((e) => e.path).sort();

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

/** A quote that cleared G1 and waits in Engineering Review. */
async function inEngReview(over: IntakeDraftData = {}) {
  const id = free.shift();
  if (!id) throw new Error('test ran out of free opportunities');
  const res = await as('KAM').post('/api/v1/quotes/drafts', { data: await prefill(id, over) });
  ok(res, 201);
  const sub = await as('KAM').post(
    `/api/v1/quotes/drafts/${IntakeDraft.parse(res.json()).id}/submit`,
  );
  ok(sub, 201);
  const { quoteNumber: qn } = SubmitIntakeResponse.parse(sub.json());
  ok(
    await as('SalesLeader').post(`/api/v1/quotes/${qn}/gates/G1/decisions`, {
      outcomeKey: 'advance',
    }),
    201,
  );
  return qn;
}

const detail = async (qn: string, role: Role = 'EngLead') => {
  const res = await as(role).get(`/api/v1/quotes/${qn}`);
  ok(res);
  return QuoteDetail.parse(res.json());
};
const publicConfig = async () => {
  const res = await as('KAM').get('/api/v1/config/public');
  ok(res);
  return PublicConfigResponse.parse(res.json());
};

beforeAll(async () => {
  const fresh = await freshSfDatabase('fb13_plants');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url, RATE_LIMIT_MAX: '100000' }), { db });
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

describe('FB-13: what the pickers offer', () => {
  it('the plant picker offers Jim’s 22 locations as sent; the placeholders are not offered', async () => {
    const cfg = await publicConfig();
    const plants = cfg.valueLists.plant ?? [];
    expect(plants).toHaveLength(22);
    expect(plants.map((p) => p.label)).toEqual([
      'Aurora',
      'Bethlehem',
      'Boxmore',
      'Carrollton',
      'Cleveland, OH',
      'Cleveland, TN',
      'Lerma, Ediplast',
      'Lerma, Ediprint',
      'Etten.Leur',
      'Greensboro',
      'Hazleton',
      'Hillsborough',
      'Leipsic',
      'Manchester',
      'Peru',
      'Salt Lake City',
      'St. Charles',
      'St. Laurent',
      'St. Louis',
      'Toronto',
      'Troy',
      'Vancouver',
    ]);
    expect(plants.map((p) => p.code)).not.toContain('PLANT_01');
  });

  it('the machine-type picker offers Jim’s 14 types; the placeholders are not offered', async () => {
    const cfg = await publicConfig();
    expect((cfg.valueLists.machine_type ?? []).map((m) => m.code)).toEqual([
      'EBM',
      'IBM',
      'ISBM',
      'RHB',
      'INJ-CAP',
      'INJ-PREFORM',
      'INJ-OTHER',
      'DECO',
      'PAD PRINTING',
      '12B',
      'DIE CUTTING',
      'LAMINATION',
      'PRINTING',
      'STAMPING',
    ]);
    expect(cfg.retiredValues?.machine_type?.EBM_SHUTTLE).toBe('EBM shuttle');
    expect(cfg.retiredValues?.plant?.PLANT_01).toBe('Placeholder plant 01');
  });
});

describe('FB-13: an Engineering Review with the new codes', () => {
  it('saves a new plant, machine type, preform plant and blow plant, and reads them back', async () => {
    const qn = await inEngReview();
    ok(
      await putReview(qn, {
        processType: 'IMM',
        machineType: 'INJ-PREFORM',
        plantCode: 'CLEVELAND_OH',
        twoStep: true,
        preformPlantCode: 'LERMA_EDIPLAST',
        blowPlantCode: 'ETTEN_LEUR',
        preformNumber: 'PF-13',
      }),
    );
    const r = (await detail(qn)).engineering.review;
    expect(r).toMatchObject({
      processType: 'IMM',
      machineType: 'INJ-PREFORM',
      plantCode: 'CLEVELAND_OH',
      preformPlantCode: 'LERMA_EDIPLAST',
      blowPlantCode: 'ETTEN_LEUR',
    });
    // Codes that carry a space or a digit, exactly as Jim sent them.
    ok(await putReview(qn, { machineType: 'PAD PRINTING', plantCode: 'ST_CHARLES' }));
    ok(await putReview(qn, { machineType: '12B' }));
    expect((await detail(qn)).engineering.review.machineType).toBe('12B');
  });

  it('refuses a placeholder plant and a retired machine type on a write', async () => {
    const qn = await inEngReview();
    for (const body of [
      { plantCode: 'PLANT_01' },
      { preformPlantCode: 'PLANT_02' },
      { blowPlantCode: 'PLANT_03' },
      { machineType: 'EBM_SHUTTLE' },
      { machineType: 'OTHER' },
    ]) {
      const res = await putReview(qn, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(422);
    }
    expect(errorPaths(await putReview(qn, { machineType: 'INJECTION_PRESS' }))).toEqual([
      '/machineType',
    ]);
  });

  it('a retired code is still readable on an old quote, and other edits still work', async () => {
    const qn = await inEngReview();
    const id = (await detail(qn)).id;
    ok(await putReview(qn, { cavitation: 4 }));
    await db.db.execute(
      sql`update eng_review set plant_code = 'PLANT_01', machine_type = 'ISBM_2STEP'
          where quote_id = ${id}`,
    );
    const r = (await detail(qn)).engineering.review;
    expect(r).toMatchObject({ plantCode: 'PLANT_01', machineType: 'ISBM_2STEP' });
    expect((await detail(qn)).engineering.selectedLabels).toMatchObject({
      plantCode: 'Placeholder plant 01',
      machineType: 'ISBM two-stage',
    });
    ok(await putReview(qn, { cavitation: 6 }));
    // The new value replaces it.
    ok(await putReview(qn, { plantCode: 'PERU', machineType: 'ISBM' }));
    expect((await detail(qn)).engineering.review).toMatchObject({
      plantCode: 'PERU',
      machineType: 'ISBM',
    });
  });
});

describe('FB-13: the FB-06 routing suggestion does not change', () => {
  let neiberger = '';
  let pasillas = '';

  beforeAll(async () => {
    const make = async (oid: string, displayName: string) => {
      const [u] = await db.db
        .insert(schema.appUser)
        .values({ entraOid: oid, upn: `${oid}@example.test`, displayName })
        .returning({ id: schema.appUser.id });
      await db.db.insert(schema.userRole).values({ userId: u!.id, role: 'Engineer' });
      return u!.id;
    };
    neiberger = await make('oid-neiberger-13', 'Randy Neiberger');
    pasillas = await make('oid-pasillas-13', 'Rafael Pasillas');
  });

  it('ISBM, RHB and IMM still go to the PET engineer, EBM and IBM to the polyolefin engineer, whatever the machine type', async () => {
    const qn = await inEngReview({ resin: 'HDPE' });
    const cases: [processType: string, machineType: string, engineer: () => string][] = [
      ['ISBM', 'ISBM', () => neiberger],
      ['RHB', 'RHB', () => neiberger],
      ['IMM', 'INJ-CAP', () => neiberger],
      ['IMM', 'INJ-PREFORM', () => neiberger],
      ['IMM', 'INJ-OTHER', () => neiberger],
      ['EBM', 'EBM', () => pasillas],
      ['IBM', 'IBM', () => pasillas],
      // The machine type is not the routing key: the process type decides.
      ['EBM', 'INJ-CAP', () => pasillas],
      ['ISBM', 'EBM', () => neiberger],
    ];
    for (const [processType, machineType, engineer] of cases) {
      ok(await putReview(qn, { processType, machineType }));
      expect(
        (await detail(qn)).engineering.suggestedEngineer,
        `${processType} / ${machineType}`,
      ).toMatchObject({ userId: engineer(), processType });
    }
  });
});
