import {
  DEV_USER_HEADER,
  GenerateOfferLetterResponse,
  IntakeDraft,
  MeResponse,
  OfferLetterResponse,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
  type IntakeItemData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import type { Role } from '@ccq/domain';
import {
  buildJunkWorkbook,
  buildOfferCostingWorkbook,
  offerCostingMap,
  type OfferCostingItem,
} from '@ccq/integrations/test/synthetic-workbooks';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmCapitalTerms, uploadModelFile } from './model-helpers';
import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * FB-20 (F-070): the customer offer letter, end to end on a real Postgres. Every quote is driven through
 * the API to Customer Decision (G1 → G2 per item → costing upload → G3 → G4 Approve); the costing
 * workbook is synthetic (one column per item) and read with a map that is active in this test only.
 * Refusals that need a state the API cannot reach after G4 (a costing upload after the approval) set
 * that state in the database, as noted where they do.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-11-16T15:00:00Z');
const HOUR = 3_600_000;
const tick = (ms = HOUR) => {
  clock = new Date(clock.getTime() + ms);
};

let free: string[] = [];
const nextFree = () => {
  const id = free.shift();
  if (!id) throw new Error('test ran out of free opportunities');
  return id;
};
const as = (role: Role, scope?: 'all' | 'owner') => asRole(app, role, scope);
const ids: Record<string, string> = {};
async function userId(role: Role): Promise<string> {
  ids[role] ??= MeResponse.parse((await as(role).get('/api/v1/me')).json()).user.id;
  return ids[role];
}
const ok = (res: { statusCode: number; body: string }, status = 200) =>
  expect(res.statusCode, res.body).toBe(status);

const KEY = (n: number) => `0193f2a0-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function request(sfOpportunityId: string) {
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
    priceBasis: 'FOB_PLANT',
    freightType: 'VAN',
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

const ITEMS = (n: number): IntakeItemData[] =>
  [
    item(KEY(1)),
    item(KEY(2), { label: '24 oz bottle', containerSize: '24 oz', estAnnualVolume: 600_000 }),
    item(KEY(3), { label: '38 mm closure', containerSize: '38 mm', estAnnualVolume: 1_850_000 }),
  ].slice(0, n);

/** The synthetic workbook used unless a test says otherwise: a price for every item, molds on two. */
const PRICES: OfferCostingItem[] = [
  { piece: 0.0825, mold: 45_000 },
  { piece: 0.091, mold: 52_500, changeParts: 6_800 },
  { piece: 0.105 },
];

const itemIds = async (quoteId: string) =>
  (
    await db.db
      .select()
      .from(schema.quoteItem)
      .where(eq(schema.quoteItem.quoteId, quoteId))
      .orderBy(asc(schema.quoteItem.itemNo))
  ).map((i) => i.id);

async function setSetting(key: string, value: unknown) {
  await db.db.update(schema.appSetting).set({ value }).where(eq(schema.appSetting.key, key));
}

/** Submitted, G1 advanced and every item engineered (plants per item), G2 decided: in Quoting. */
async function inQuoting(n = 3, plants = ['AURORA', 'AURORA', 'BETHLEHEM']) {
  const draft = await as('KAM').post('/api/v1/quotes/drafts', {
    data: { ...(await request(nextFree())), items: ITEMS(n) },
  });
  ok(draft, 201);
  const sub = await as('KAM').post(
    `/api/v1/quotes/drafts/${IntakeDraft.parse(draft.json()).id}/submit`,
  );
  ok(sub, 201);
  const { quoteNumber: qn, quoteId } = SubmitIntakeResponse.parse(sub.json());
  ok(
    await as('SalesLeader').post(`/api/v1/quotes/${qn}/gates/G1/decisions`, {
      outcomeKey: 'advance',
    }),
    201,
  );
  const items = await itemIds(quoteId);
  for (const [i, itemId] of items.entries()) {
    ok(
      await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, {
        itemId,
        plantCode: plants[i] ?? 'AURORA',
        machineType: 'EBM',
        processType: 'EBM',
        cavitation: 8,
        cycleTimeS: 14.5,
        prelimCapitalUsd: 0,
      }),
    );
    ok(
      await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
        itemId,
        rows: [
          {
            site: plants[i] ?? 'AURORA',
            assumedEffectivenessPct: 70,
            cycleTimeS: 14.5,
            utilizationBeforePct: 62,
            analysisDate: '2026-11-16',
            analystId: await userId('Engineer'),
          },
        ],
      }),
    );
  }
  ok(await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-signoff`, { status: 'approved' }));
  ok(
    await as('EngLead').post(`/api/v1/quotes/${qn}/gates/G2/decisions`, { outcomeKey: 'proceed' }),
    201,
  );
  tick();
  return { qn, quoteId, items };
}

/** Pricing uploads the costing workbook, attests and approves the price; G3 sends it to Final Review. */
async function priced(qn: string, workbook: Buffer) {
  ok(
    await uploadModelFile(app, qn, 'cost_model', 'Pricing', 'costing.synthetic.xlsx', workbook),
    201,
  );
  ok(
    await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
      approvedBy: await userId('Pricing'),
      approvedAt: new Date(clock.getTime() - HOUR).toISOString(),
      erfRefs: ['ERF26-213'],
      costingCompleted: true,
    }),
  );
  ok(
    await as('Pricing').put(`/api/v1/quotes/${qn}/capital-readiness`, {
      capitalReadiness: 'pre_approved',
    }),
  );
  ok(
    await as('PricingLead').post(`/api/v1/quotes/${qn}/gates/G3/decisions`, {
      outcomeKey: 'submit',
    }),
    201,
  );
  tick();
}

/** The terms checked, the capital terms confirmed and G4 approved: in Customer Decision. */
async function released(qn: string) {
  ok(
    await as('KAM').put(`/api/v1/quotes/${qn}/terms`, {
      termsPaymentTermsCode: 'NET_30',
      termsToolingCommitment: false,
      checked: true,
    }),
  );
  await confirmCapitalTerms(app, qn);
  ok(
    await as('Approver').post(`/api/v1/quotes/${qn}/gates/G4/decisions`, { outcomeKey: 'approve' }),
    201,
  );
  tick();
}

async function inCustomerDecision(
  o: { n?: number; prices?: OfferCostingItem[]; workbook?: Buffer; plants?: string[] } = {},
) {
  const q = await inQuoting(o.n ?? 3, o.plants);
  await priced(q.qn, o.workbook ?? (await buildOfferCostingWorkbook(o.prices ?? PRICES)));
  await released(q.qn);
  return q;
}

async function view(qn: string, role: Role = 'KAM') {
  const res = await as(role).get(`/api/v1/quotes/${qn}/offer-letter`);
  ok(res);
  return OfferLetterResponse.parse(res.json());
}
const generate = (qn: string, body: Record<string, unknown> = {}, role: Role = 'KAM') =>
  as(role).post(`/api/v1/quotes/${qn}/offer-letter`, {
    attention: 'Alex Buyer',
    items: [],
    acknowledgedWarnings: ['wording_not_approved', 'no_attention', 'no_part_number'],
    ...body,
  });
const blockerCodes = (res: { json: () => unknown }) =>
  ((res.json() as { blockers?: { code: string }[] }).blockers ?? []).map((b) => b.code);

beforeAll(async () => {
  const fresh = await freshSfDatabase('fb20_offer_letter');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url, RATE_LIMIT_MAX: '100000' }), {
    db,
    now: () => clock,
  });
  await app.ready();
  // The synthetic one-column-per-item costing map, active in this test only (the seeded real-layout
  // map stays inactive).
  const [maps] = await db.db
    .select()
    .from(schema.appSetting)
    .where(eq(schema.appSetting.key, 'model_summary_templates'));
  await setSetting('model_summary_templates', [...(maps!.value as unknown[]), offerCostingMap(3)]);
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

describe('FB-20: before Final Review approves, there is no letter', () => {
  it('says "not available" in Quoting and refuses to generate', async () => {
    const { qn } = await inQuoting(1);
    const v = await view(qn);
    expect(v).toMatchObject({ available: false, canGenerate: false, preview: null, letters: [] });
    expect(v.blockers.map((b) => b.code)).toEqual(['not_customer_decision']);
    const res = await generate(qn);
    expect(res.statusCode).toBe(409);
    expect(blockerCodes(res)).toEqual(['not_customer_decision']);
  });
});

describe('FB-20: a three-item letter from the synthetic costing workbook', () => {
  let qn = '';
  let quoteId = '';
  let items: string[] = [];
  let firstLetter: GenerateOfferLetterResponse['letter'];

  beforeAll(async () => {
    ({ qn, quoteId, items } = await inCustomerDecision());
  }, 120_000);

  it('previews the read-only prices per item, per 1,000, with their source', async () => {
    const v = await view(qn);
    expect(v).toMatchObject({
      available: true,
      canGenerate: true,
      mayGenerate: true,
      blockers: [],
    });
    expect(v.warnings.map((w) => w.code)).toEqual(['wording_not_approved']);
    expect(v.draftText).toBe('DRAFT: wording not yet approved by Legal');
    expect(v.source!.text).toMatch(
      /^Read from costing\.synthetic\.xlsx v1, uploaded by .+ on 2026-11-1\d$/,
    );
    expect(
      v.preview!.items.map((i) => [
        i.itemNo,
        i.placeOfManufacture,
        i.piecePricePer1000,
        i.moldCharge,
        i.changePartsCharge,
      ]),
    ).toEqual([
      [1, expect.any(String), '$82.50', '$45,000.00', null],
      [2, expect.any(String), '$91.00', '$52,500.00', '$6,800.00'],
      [3, expect.any(String), '$105.00', null, null],
    ]);
    expect(v.preview!.items[2]!.placeOfManufacture).not.toBe(
      v.preview!.items[0]!.placeOfManufacture,
    );
    const texts = v.preview!.assumptions.map((a) => a.text);
    expect(texts).toContain('Payment terms: Net 30 from date of invoice.');
    expect(texts).toContain('Pricing is FOB Pretium plant.');
    // Freight is kept only for a delivered price (FB-11), so its sentence is left out, never blank.
    expect(texts.some((t) => t.startsWith('Freight'))).toBe(false);
    // Engineering and Finance read the letter; only the generators may make one.
    expect((await view(qn, 'Engineer')).mayGenerate).toBe(false);
    expect((await view(qn, 'Pricing')).mayGenerate).toBe(true);
  });

  it('needs every warning ticked, then makes letter 1: stored, snapshotted and audited', async () => {
    const unticked = await generate(qn, { acknowledgedWarnings: [] });
    expect(unticked.statusCode, unticked.body).toBe(409);
    expect(
      unticked.json<{ type: string; warnings: { code: string }[] }>().warnings.map((w) => w.code),
    ).toEqual(['wording_not_approved', 'no_part_number']);
    const res = await generate(qn, {
      attention: 'Alex Buyer <Procurement> & Co',
      items: [
        { itemId: items[0], partNumber: 'SB-100' },
        { itemId: items[1], partNumber: 'SB-200' },
        { itemId: items[2], partNumber: 'SB-300' },
      ],
      acknowledgedWarnings: ['wording_not_approved'],
    });
    ok(res, 201);
    const out = GenerateOfferLetterResponse.parse(res.json());
    firstLetter = out.letter;
    expect(out.letter).toMatchObject({
      letterNo: 1,
      itemCount: 3,
      superseded: false,
      wordingApproved: false,
      attention: 'Alex Buyer <Procurement> & Co',
      costModelVersion: 1,
      quoteVersion: 1,
    });
    expect(out.letter.fileName).toBe(`${qn} Offer Letter 1.docx`);
    expect(out.downloadPath).toBe(`/api/v1/attachments/${out.letter.attachmentId}/download`);

    // The file: an offer_letter attachment, a Word document, downloadable through the audited route.
    const [file] = await db.db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.id, out.letter.attachmentId));
    expect(file).toMatchObject({ kind: 'offer_letter', version: null, quoteId });
    expect(file!.mime).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    const dl = await as('Engineer').get(`${out.downloadPath}?format=json`);
    ok(dl);
    const link = dl.json<{ url: string; fileName: string }>();
    expect(link.fileName).toBe(`${qn} Offer Letter 1.docx`);
    const bytes = await app.inject({
      method: 'GET',
      url: link.url.replace(/^https?:\/\/[^/]+/, ''),
    });
    ok(bytes);
    expect(bytes.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK');

    // The snapshot: per-1,000 piece prices with four decimals, the charges, the typed Part #s.
    const lines = await db.db
      .select()
      .from(schema.offerLetterItem)
      .where(eq(schema.offerLetterItem.offerLetterId, out.letter.id))
      .orderBy(asc(schema.offerLetterItem.itemNo));
    expect(
      lines.map((l) => [
        l.itemNo,
        l.quoteItemId,
        l.partNumber,
        l.piecePricePer1000,
        l.moldCharge,
        l.changePartsCharge,
      ]),
    ).toEqual([
      [1, items[0], 'SB-100', '82.5000', '45000.0000', null],
      [2, items[1], 'SB-200', '91.0000', '52500.0000', '6800.0000'],
      [3, items[2], 'SB-300', '105.0000', null, null],
    ]);

    // The audit row: what was made and from which file; no price, no customer text.
    const audit = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.entity, 'offer_letter'),
          eq(schema.auditEvent.entityId, out.letter.id),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'create', quoteId });
    expect(audit[0]!.after).toMatchObject({
      event: 'offer_letter.generated',
      letterNo: 1,
      quoteVersion: 1,
      itemCount: 3,
      templateVersion: 'fb20-2026-11-16',
      wordingApproved: false,
      costModelVersion: 1,
    });
    const auditText = JSON.stringify(audit[0]);
    for (const secret of [
      '82.5',
      '45000',
      '91.0',
      '52500',
      'Alex Buyer',
      'SB-100',
      'Procurement',
    ]) {
      expect(auditText).not.toContain(secret);
    }
    // The timeline.
    const events = await db.db
      .select()
      .from(schema.activityEvent)
      .where(
        and(
          eq(schema.activityEvent.quoteId, quoteId),
          eq(schema.activityEvent.type, 'offer_letter_generated'),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ letterNo: 1, itemCount: 3, wordingApproved: false });
  });

  it('makes letter 2 on a second call; the list shows both, newest first', async () => {
    tick();
    ok(await generate(qn), 201);
    const v = await view(qn);
    expect(v.letters.map((l) => [l.letterNo, l.superseded])).toEqual([
      [2, false],
      [1, false],
    ]);
    expect(v.letters[1]!.id).toBe(firstLetter.id);
  });

  it('a concurrent double POST makes two whole letters (the quote row is locked), never half a letter', async () => {
    const [a, b] = await Promise.all([generate(qn), generate(qn)]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect([
      [201, 201],
      [201, 409],
    ]).toContainEqual(statuses);
    const letters = await db.db
      .select()
      .from(schema.offerLetter)
      .where(eq(schema.offerLetter.quoteId, quoteId));
    const nos = letters.map((l) => l.letterNo).sort();
    expect(new Set(nos).size).toBe(nos.length);
    for (const l of letters) {
      const n = await db.db.execute<{ n: number }>(
        sql`select count(*)::int as n from offer_letter_item where offer_letter_id = ${l.id}`,
      );
      expect(n[0]!.n).toBe(3);
    }
    const files = await db.db
      .select()
      .from(schema.attachment)
      .where(
        and(eq(schema.attachment.quoteId, quoteId), eq(schema.attachment.kind, 'offer_letter')),
      );
    expect(files).toHaveLength(letters.length);
  });

  it('refuses on hold', async () => {
    await db.db.update(schema.quote).set({ status: 'on_hold' }).where(eq(schema.quote.id, quoteId));
    try {
      const res = await generate(qn);
      expect(res.statusCode).toBe(409);
      expect(blockerCodes(res)).toEqual(['on_hold']);
    } finally {
      await db.db
        .update(schema.quote)
        .set({ status: 'active' })
        .where(eq(schema.quote.id, quoteId));
    }
  });

  it('refuses when an Admin hides the figures read from models', async () => {
    await setSetting('model_summary_visible', false);
    try {
      const v = await view(qn);
      expect(v.blockers.map((b) => b.code)).toEqual(['summary_hidden']);
      // No figure leaves the server.
      expect(v.preview!.items.every((i) => i.piecePricePer1000 === null)).toBe(true);
      expect(blockerCodes(await generate(qn))).toEqual(['summary_hidden']);
    } finally {
      await setSetting('model_summary_visible', true);
    }
  });

  it('requires molds on every item when the customer funds tooling (config)', async () => {
    await db.db
      .update(schema.quote)
      .set({ toolingFundingModel: 'CUSTOMER_FUNDED' })
      .where(eq(schema.quote.id, quoteId));
    try {
      const v = await view(qn);
      expect(v.blockers).toEqual([
        expect.objectContaining({ code: 'missing_required_row', itemNo: 3 }),
      ]);
    } finally {
      await db.db
        .update(schema.quote)
        .set({ toolingFundingModel: 'COMPANY_FUNDED' })
        .where(eq(schema.quote.id, quoteId));
    }
  });

  it('refuses when the costing workbook is newer than the G4 approval, unless switched off', async () => {
    // A costing upload after G4 cannot happen through the API (the section is locked after G3), so the
    // current version's upload time is moved past the approval to stand in for one.
    const [cost] = await db.db
      .select()
      .from(schema.attachment)
      .where(and(eq(schema.attachment.quoteId, quoteId), eq(schema.attachment.kind, 'cost_model')));
    const original = cost!.createdAt;
    await db.db
      .update(schema.attachment)
      .set({ createdAt: new Date(clock.getTime() + HOUR) })
      .where(eq(schema.attachment.id, cost!.id));
    try {
      expect(blockerCodes(await generate(qn))).toEqual(['costing_changed']);
      await setSetting('offer_letter_block_if_costing_changed', false);
      expect((await view(qn)).canGenerate).toBe(true);
    } finally {
      await setSetting('offer_letter_block_if_costing_changed', true);
      await db.db
        .update(schema.attachment)
        .set({ createdAt: original })
        .where(eq(schema.attachment.id, cost!.id));
    }
  });

  it('refuses with a clear reason when the template setting is broken by a hand edit', async () => {
    const [row] = await db.db
      .select()
      .from(schema.appSetting)
      .where(eq(schema.appSetting.key, 'offer_letter_template'));
    await setSetting('offer_letter_template', {
      ...(row!.value as object),
      title: 'Offer {{secret}}',
    });
    try {
      const v = await view(qn);
      expect(v.blockers.map((b) => b.code)).toEqual(['config_invalid']);
    } finally {
      await setSetting('offer_letter_template', row!.value);
    }
  });

  it('drops the DRAFT line once Legal approves the wording; the letter records it', async () => {
    await setSetting('offer_letter_wording_approved', true);
    try {
      const v = await view(qn);
      expect(v.warnings).toEqual([]);
      expect(v.draftText).toBeNull();
      const res = await generate(qn, { acknowledgedWarnings: ['no_part_number'] });
      ok(res, 201);
      expect(GenerateOfferLetterResponse.parse(res.json()).letter.wordingApproved).toBe(true);
    } finally {
      await setSetting('offer_letter_wording_approved', false);
    }
  });

  it('only a generator may make one; another KAM cannot even see the quote', async () => {
    expect((await generate(qn, {}, 'Engineer')).statusCode).toBe(403);
    expect((await generate(qn, {}, 'Approver')).statusCode).toBe(403);
    ok(await generate(qn, {}, 'Pricing'), 201);
    ok(await generate(qn, {}, 'SalesLeader'), 201);
    // The owner-scoped KAM persona is another KAM: RLS hides the quote (404 either way).
    expect((await as('KAM', 'owner').get(`/api/v1/quotes/${qn}/offer-letter`)).statusCode).toBe(
      404,
    );
    expect(
      (await as('KAM', 'owner').post(`/api/v1/quotes/${qn}/offer-letter`, {})).statusCode,
    ).toBe(404);
  });

  it('refuses an item that is not on the quote', async () => {
    const res = await generate(qn, {
      items: [{ itemId: '0193f2a0-0000-7000-8000-00000000dead', partNumber: 'X' }],
    });
    expect(res.statusCode).toBe(422);
  });

  it('a re-quote makes the earlier letters Superseded; their prices never change', async () => {
    const before = await db.db
      .select()
      .from(schema.offerLetterItem)
      .where(eq(schema.offerLetterItem.quoteId, quoteId))
      .orderBy(asc(schema.offerLetterItem.id));
    ok(
      await as('KAM').post(`/api/v1/quotes/${qn}/gates/G5/decisions`, {
        outcomeKey: 'requote',
        reasonCode: 'volume_change',
        targetStageKey: 'QUOTING',
        note: 'Volume changed',
      }),
      201,
    );
    tick();
    // A new costing workbook with other prices, for version 2.
    await priced(
      qn,
      await buildOfferCostingWorkbook([{ piece: 0.2 }, { piece: 0.3 }, { piece: 0.4 }]),
    );
    const v = await view(qn);
    expect(v.available).toBe(false);
    expect(v.letters.length).toBeGreaterThanOrEqual(2);
    expect(v.letters.every((l) => l.superseded && l.quoteVersion === 1)).toBe(true);
    const after = await db.db
      .select()
      .from(schema.offerLetterItem)
      .where(eq(schema.offerLetterItem.quoteId, quoteId))
      .orderBy(asc(schema.offerLetterItem.id));
    expect(after).toEqual(before);
    // Released again: a letter for v2 reads the new workbook and is not superseded.
    await released(qn);
    const res = await generate(qn);
    ok(res, 201);
    const letter = GenerateOfferLetterResponse.parse(res.json()).letter;
    expect(letter).toMatchObject({ quoteVersion: 2, superseded: false, costModelVersion: 2 });
    const [line] = await db.db
      .select()
      .from(schema.offerLetterItem)
      .where(
        and(
          eq(schema.offerLetterItem.offerLetterId, letter.id),
          eq(schema.offerLetterItem.itemNo, 1),
        ),
      );
    expect(line!.piecePricePer1000).toBe('200.0000');
  });
});

describe('FB-20: refusals that come from the workbook', () => {
  it('an item with no piece price in the workbook', async () => {
    const { qn } = await inCustomerDecision({
      prices: [{ piece: 0.1 }, { piece: 'blank' }, { piece: 0.2 }],
    });
    const v = await view(qn);
    expect(v.blockers).toEqual([
      expect.objectContaining({ code: 'missing_piece_price', itemNo: 2, fixAt: 'quoting' }),
    ]);
    expect((await generate(qn)).statusCode).toBe(409);
  });

  it('a costing workbook with no readable summary', async () => {
    const { qn } = await inCustomerDecision({ n: 1, workbook: await buildJunkWorkbook() });
    const v = await view(qn);
    expect(v.blockers.map((b) => b.code)).toEqual(['summary_not_complete']);
    expect(v.blockers[0]!.message).toMatch(
      /^The costing workbook has no readable price summary \(.+\)\. Ask Pricing to fix the workbook or an Admin to set up the template\.$/,
    );
  });
});

describe('FB-20: an offer letter is generated, never uploaded', () => {
  it('the attachments route refuses the kind', async () => {
    const { qn } = await inQuoting(1);
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(128, 1)]);
    const boundary = '----ccqfb20';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\noffer_letter\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n${docx.length}\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="letter.docx"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      docx,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/quotes/${qn}/attachments`,
      headers: {
        [DEV_USER_HEADER]: as('KAM').persona,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.body).toContain('generated');
  });
});
