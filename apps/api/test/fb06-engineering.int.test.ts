import {
  DEV_USER_HEADER,
  AttachmentListResponse,
  AttachmentUploadResponse,
  EngineeringDetail,
  EngQueueResponse,
  IntakeDraft,
  MeResponse,
  QuoteDetail,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import { ROLES, type Role } from '@ccq/domain';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { uploadBom } from './model-helpers';
import { asRole, personaFor } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * FB-06 (F-058, F-062, F-024, F-025; T-008, T-033): the equipment BOM upload, the routing suggestion in
 * the assign dialog, the two-step process and the pack-out quantities, on the Engineering Review.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-11-09T15:00:00Z');
const tick = (ms = 3_600_000) => {
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
const ok = (res: { statusCode: number; body: string }, status = 200) =>
  expect(res.statusCode, res.body).toBe(status);
const putReview = (qn: string, body: Record<string, unknown>, role: Role = 'EngLead') =>
  as(role).put(`/api/v1/quotes/${qn}/eng-review`, body);

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
  ok(await decide(qn, 'G1', { outcomeKey: 'advance' }, 'SalesLeader'), 201);
  return qn;
}

async function assign(qn: string, engineerId: string, role: Role = 'EngLead') {
  return as(role).post(`/api/v1/quotes/${qn}/assignment`, { engineerId });
}

const detail = async (qn: string, role: Role = 'EngLead') => {
  const res = await as(role).get(`/api/v1/quotes/${qn}`);
  ok(res);
  return QuoteDetail.parse(res.json());
};

const attachments = async (qn: string, role: Role = 'EngLead') => {
  const res = await as(role).get(`/api/v1/quotes/${qn}/attachments`);
  ok(res);
  return AttachmentListResponse.parse(res.json()).items;
};

/** Everything G2 "proceed" needs except the BOM, so a test can then decide the outcome it wants. */
async function readyForG2(qn: string) {
  ok(
    await putReview(qn, {
      processType: 'EBM',
      machineType: 'EBM',
      plantCode: 'AURORA',
      cavitation: 8,
      cycleTimeS: 14.5,
      prelimCapitalUsd: 250_000,
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
          analysisDate: '2026-11-09',
          analystId: await userId('Engineer'),
        },
      ],
    }),
  );
  ok(await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-signoff`, { status: 'approved' }));
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('fb06_engineering');
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
  expect(free.length).toBeGreaterThanOrEqual(12);
}, 120_000);
afterAll(async () => {
  await app.close();
});

// ── F-058: the equipment BOM ─────────────────────────────────────────────────────────────────────

describe('F-058: the equipment BOM upload', () => {
  it('is versioned: the latest is current, earlier versions stay, and every reader sees who and when', async () => {
    const qn = await inEngReview();
    const first = await uploadBom(app, qn, 'EngLead', 'CSR BOM v1.xlsx');
    ok(first, 201);
    expect(AttachmentUploadResponse.parse(first.json()).item).toMatchObject({
      kind: 'equipment_bom',
      version: 1,
      current: true,
    });
    tick();
    const second = await uploadBom(app, qn, 'EngLead', 'CSR BOM v2.xlsx');
    ok(second, 201);
    expect(AttachmentUploadResponse.parse(second.json()).item).toMatchObject({
      version: 2,
      current: true,
    });

    const files = (await attachments(qn))
      .filter((f) => f.kind === 'equipment_bom')
      .sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
    expect(files.map((f) => [f.version, f.current])).toEqual([
      [2, true],
      [1, false],
    ]);

    // Engineering, Pricing and Final Review read it from the quote: file, version, uploader, date.
    for (const role of ['EngLead', 'Pricing', 'PricingLead', 'Approver', 'KAM'] as Role[]) {
      const bom = (await detail(qn, role)).engineering.equipmentBom;
      expect(bom.current, role).toMatchObject({
        version: 2,
        current: true,
        fileName: 'CSR BOM v2.xlsx',
        uploadedByName: expect.stringMatching(/\S/) as string,
        uploadedAt: expect.stringMatching(/^\d{4}-/) as string,
      });
      expect(
        bom.versions.map((v) => v.version),
        role,
      ).toEqual([2, 1]);
      expect(bom.requiredForCapital, role).toBe(true);
    }
    // Only the review's editors are offered the upload.
    expect((await detail(qn, 'EngLead')).engineering.equipmentBom.canUpload).toBe(true);
    expect((await detail(qn, 'Pricing')).engineering.equipmentBom.canUpload).toBe(false);
    expect((await detail(qn, 'KAM')).engineering.equipmentBom.canUpload).toBe(false);
  });

  it('every role but the EngLead and the assigned engineer is refused (permission matrix)', async () => {
    const qn = await inEngReview();
    ok(await assign(qn, await userId('Engineer')), 200);
    const allowed: Role[] = ['EngLead', 'Engineer'];
    for (const role of ROLES) {
      let persona: string;
      try {
        persona = personaFor(role);
      } catch {
        continue; // no single-role dev persona for this role
      }
      const res = await uploadBom(app, qn, role, `BOM ${role}.xlsx`, persona);
      if (allowed.includes(role)) {
        expect(res.statusCode, `${role}: ${res.body}`).toBe(201);
        tick();
      } else {
        expect(res.statusCode, `${role}: ${res.body}`).toBe(403);
      }
    }
    // An engineer who is not assigned to it (the owner-scoped one) may not either: the quote is out of
    // their scope or the upload is refused.
    const notAssigned = await uploadBom(
      app,
      qn,
      'Engineer',
      'BOM other.xlsx',
      personaFor('Engineer', 'owner'),
    );
    expect([403, 404], notAssigned.body).toContain(notAssigned.statusCode);
  });

  it('is not an intake file: a draft refuses the kind', async () => {
    const id = free.shift()!;
    const draft = await as('KAM').post('/api/v1/quotes/drafts', { data: await prefill(id) });
    ok(draft, 201);
    const draftId = IntakeDraft.parse(draft.json()).id;
    const XLSX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 7)]);
    const boundary = '----ccqbom';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nequipment_bom\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n${XLSX.length}\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="b.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      XLSX,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/quotes/drafts/${draftId}/attachments`,
      headers: {
        [DEV_USER_HEADER]: personaFor('KAM'),
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(res.statusCode, res.body).toBe(422);
  });

  it('G2 "Capital required" needs it on file; removing the current version brings the previous one back', async () => {
    const qn = await inEngReview();
    ok(await assign(qn, await userId('Engineer')), 200);
    await readyForG2(qn);
    const body = { outcomeKey: 'capital_required', note: 'A second cavity set is needed' };
    const blocked = await decide(qn, 'G2', body, 'EngLead');
    expect(blocked.statusCode).toBe(422);
    expect(JSON.stringify(blocked.json())).toContain('equipment_bom_on_file');

    // The other outcomes do not need it.
    expect(
      (await detail(qn)).availableActions.find((a) => a.outcomeKey === 'proceed')?.missing,
    ).toEqual([]);

    ok(await uploadBom(app, qn, 'EngLead', 'BOM 1.xlsx'), 201);
    tick();
    const v2 = AttachmentUploadResponse.parse(
      (await uploadBom(app, qn, 'EngLead', 'BOM 2.xlsx')).json(),
    ).item;
    // The uploader removes the current version: version 1 is current again (and G2 is still satisfied).
    ok(await as('EngLead').delete(`/api/v1/attachments/${v2.id}`), 204);
    const bom = (await detail(qn)).engineering.equipmentBom;
    expect(bom.current).toMatchObject({ version: 1, fileName: 'BOM 1.xlsx' });
    // Removing the only one blocks it again.
    ok(await as('EngLead').delete(`/api/v1/attachments/${bom.current!.id}`), 204);
    expect((await detail(qn)).engineering.equipmentBom.current).toBeNull();
    expect((await decide(qn, 'G2', body, 'EngLead')).statusCode).toBe(422);

    ok(await uploadBom(app, qn, 'EngLead', 'BOM 3.xlsx'), 201);
    const advanced = await decide(qn, 'G2', body, 'EngLead');
    expect(advanced.statusCode, advanced.body).toBe(201);
  });

  it('locks with the engineering section after G2: no upload, no removal (409 SECTION_LOCKED)', async () => {
    const qn = await inEngReview();
    ok(await assign(qn, await userId('Engineer')), 200);
    await readyForG2(qn);
    const up = AttachmentUploadResponse.parse((await uploadBom(app, qn)).json()).item;
    ok(await decide(qn, 'G2', { outcomeKey: 'proceed' }, 'EngLead'), 201);

    const late = await uploadBom(app, qn);
    expect(late.statusCode, late.body).toBe(409);
    expect(late.json<{ code?: string }>().code).toBe('SECTION_LOCKED');
    const removal = await as('EngLead').delete(`/api/v1/attachments/${up.id}`);
    expect(removal.statusCode, removal.body).toBe(409);
    // Pricing still reads it.
    expect((await detail(qn, 'Pricing')).engineering.equipmentBom.current).toMatchObject({
      version: 1,
    });
  });

  it('is audited and on the timeline', async () => {
    const qn = await inEngReview();
    ok(await uploadBom(app, qn), 201);
    const audit = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.action, 'upload'), eq(schema.auditEvent.entity, 'attachment')),
      );
    expect(audit.some((a) => (a.after as { kind?: string } | null)?.kind === 'equipment_bom')).toBe(
      true,
    );
    const q = await detail(qn);
    const events = await db.db
      .select()
      .from(schema.activityEvent)
      .where(
        and(
          eq(schema.activityEvent.quoteId, q.id),
          eq(schema.activityEvent.type, 'attachment_uploaded'),
        ),
      );
    expect(events.map((e) => (e.payload as { kind?: string }).kind)).toContain('equipment_bom');
  });
});

// ── F-024 / F-025: two-step and pack-out ─────────────────────────────────────────────────────────

// One quote for the two-step and pack-out tests (each test sets the state it needs).
let reviewQn = '';
beforeAll(async () => {
  reviewQn = await inEngReview();
});

describe('F-024: the two-step (preform) process', () => {
  it('saves the checkbox and its four details; Pricing reads them (T-008)', async () => {
    const qn = reviewQn;
    const res = await putReview(qn, {
      twoStep: true,
      preformPlantCode: 'AURORA',
      blowPlantCode: 'BETHLEHEM',
      preformNumber: 'PF-2210',
      twoStepFreightNote: 'Preforms ship by truck, weekly.',
    });
    ok(res);
    expect(EngineeringDetail.parse(res.json()).review).toMatchObject({
      twoStep: true,
      preformPlantCode: 'AURORA',
      blowPlantCode: 'BETHLEHEM',
      preformNumber: 'PF-2210',
      twoStepFreightNote: 'Preforms ship by truck, weekly.',
    });
    for (const role of ['Pricing', 'PricingLead', 'Approver', 'KAM'] as Role[]) {
      expect((await detail(qn, role)).engineering.review, role).toMatchObject({
        twoStep: true,
        preformNumber: 'PF-2210',
      });
    }
  });

  it('unticking clears the four details, and the change is audited with before and after', async () => {
    const qn = reviewQn;
    ok(await putReview(qn, { twoStep: true, preformPlantCode: 'AURORA', preformNumber: 'PF-1' }));
    tick();
    // The details are sent along with the unticked box: none of them is kept.
    const res = await putReview(qn, { twoStep: false, preformNumber: 'PF-IGNORED' });
    ok(res);
    expect(EngineeringDetail.parse(res.json()).review).toMatchObject({
      twoStep: false,
      preformPlantCode: null,
      blowPlantCode: null,
      preformNumber: null,
      twoStepFreightNote: null,
    });
    const q = await detail(qn);
    const rows = await db.db
      .select()
      .from(schema.auditEvent)
      .where(and(eq(schema.auditEvent.quoteId, q.id), eq(schema.auditEvent.entity, 'eng_review')));
    const last = rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).at(-1)!;
    expect(last.before).toMatchObject({
      twoStep: true,
      preformPlantCode: 'AURORA',
      preformNumber: 'PF-1',
    });
    expect(last.after).toMatchObject({
      twoStep: false,
      preformPlantCode: null,
      preformNumber: null,
    });
  });

  it('checks lengths and the plant list (preform number ≤ 40, freight note ≤ 300)', async () => {
    const qn = reviewQn;
    expect((await putReview(qn, { twoStep: true, preformNumber: 'x'.repeat(41) })).statusCode).toBe(
      400,
    );
    expect(
      (await putReview(qn, { twoStep: true, twoStepFreightNote: 'x'.repeat(301) })).statusCode,
    ).toBe(400);
    ok(
      await putReview(qn, {
        twoStep: true,
        preformNumber: 'x'.repeat(40),
        twoStepFreightNote: 'y'.repeat(300),
      }),
    );
    const bad = await putReview(qn, { twoStep: true, blowPlantCode: 'NOT_A_PLANT' });
    expect(bad.statusCode, bad.body).toBe(422);
    expect(JSON.stringify(bad.json())).toContain('/blowPlantCode');
  });

  it('only the review’s editors may change it', async () => {
    const qn = reviewQn;
    for (const role of [
      'KAM',
      'SalesLeader',
      'Pricing',
      'PricingLead',
      'Finance',
      'Approver',
      'Leadership',
      'Admin',
    ] as Role[]) {
      const res = await putReview(qn, { twoStep: true }, role);
      expect(res.statusCode, role).toBe(403);
    }
    // An Engineer who is not assigned to it: no.
    expect((await putReview(qn, { twoStep: true }, 'Engineer')).statusCode).toBe(403);
    // Once assigned, the Engineer may.
    ok(await assign(qn, await userId('Engineer')), 200);
    ok(await putReview(qn, { twoStep: true }, 'Engineer'));
  });
});

describe('F-025: pack-out quantities', () => {
  it('saves optional whole numbers; Pricing sees them; null clears one', async () => {
    const qn = reviewQn;
    const res = await putReview(qn, {
      unitsPerBag: 50,
      unitsPerTray: 240,
      unitsPerCase: 600,
      unitsPerPallet: 14_400,
    });
    ok(res);
    expect(EngineeringDetail.parse(res.json()).review).toMatchObject({
      unitsPerBag: 50,
      unitsPerTray: 240,
      unitsPerCase: 600,
      unitsPerPallet: 14_400,
    });
    expect((await detail(qn, 'Pricing')).engineering.review).toMatchObject({
      unitsPerCase: 600,
      unitsPerPallet: 14_400,
    });
    const cleared = await putReview(qn, { unitsPerTray: null });
    ok(cleared);
    expect(EngineeringDetail.parse(cleared.json()).review).toMatchObject({
      unitsPerTray: null,
      unitsPerBag: 50,
    });
  });

  it('refuses anything that is not a whole number of at least 1', async () => {
    const qn = reviewQn;
    for (const bad of [0, -5, 2.5, 10_000_000]) {
      const res = await putReview(qn, { unitsPerCase: bad });
      expect(res.statusCode, String(bad)).toBe(400);
    }
    expect((await putReview(qn, { unitsPerBag: 'many' })).statusCode).toBe(400);
  });
});

// ── F-062: the routing suggestion ────────────────────────────────────────────────────────────────

describe('F-062: the suggested engineer (the lead still assigns)', () => {
  const setRules = (rules: unknown) =>
    db.db.execute(
      sql`update app_setting set value = ${JSON.stringify(rules)}::jsonb where key = 'engineering_assignment_rules'`,
    );
  let neiberger = '';
  let pasillas = '';
  let petQn = '';

  beforeAll(async () => {
    const make = async (oid: string, displayName: string) => {
      const [u] = await db.db
        .insert(schema.appUser)
        .values({ entraOid: oid, upn: `${oid}@example.test`, displayName })
        .returning({ id: schema.appUser.id });
      await db.db.insert(schema.userRole).values({ userId: u!.id, role: 'Engineer' });
      return u!.id;
    };
    // Paul Slomkowski's email spells the first name "Rany"; the directory may say "Randy". Matched by surname.
    neiberger = await make('oid-neiberger', 'Randy Neiberger');
    pasillas = await make('oid-pasillas', 'Rafael Pasillas');
    petQn = await inEngReview({ resin: 'PET' });
  });

  const suggestionOn = async (qn: string, role: Role = 'EngLead') =>
    (await detail(qn, role)).engineering.suggestedEngineer;
  const queueSuggestion = async (qn: string) => {
    const res = await as('EngLead').get('/api/v1/queue/engineering');
    ok(res);
    return EngQueueResponse.parse(res.json()).items.find((i) => i.quoteNumber === qn)
      ?.suggestedEngineer;
  };

  it('is seeded from Paul Slomkowski’s email, marked provisional', async () => {
    const [row] = await db.db
      .select()
      .from(schema.appSetting)
      .where(eq(schema.appSetting.key, 'engineering_assignment_rules'));
    expect(row?.provisional).toBe(true);
    const rules = (row!.value as { rules: { processTypes: string[]; engineerName: string }[] })
      .rules;
    expect(rules.find((r) => r.processTypes.includes('ISBM'))?.engineerName).toBe('Neiberger');
    expect(rules.find((r) => r.processTypes.includes('EBM'))?.engineerName).toBe('Pasillas');
  });

  it('suggests by resin while the process type is not chosen, then by process type', async () => {
    const pet = await inEngReview({ resin: 'PET' });
    expect(await suggestionOn(pet)).toMatchObject({
      userId: neiberger,
      name: 'Randy Neiberger',
      resin: 'PET',
    });
    expect(await queueSuggestion(pet)).toMatchObject({ userId: neiberger });

    const hdpe = await inEngReview({ resin: 'HDPE' });
    expect(await suggestionOn(hdpe)).toMatchObject({ userId: pasillas, name: 'Rafael Pasillas' });

    // The process type, once Engineering has chosen it, wins over the resin.
    ok(await putReview(hdpe, { processType: 'ISBM' }));
    expect(await suggestionOn(hdpe)).toMatchObject({
      userId: neiberger,
      processType: 'ISBM',
      resin: null,
    });
    ok(await putReview(hdpe, { processType: 'EBM' }));
    expect(await suggestionOn(hdpe)).toMatchObject({ userId: pasillas, processType: 'EBM' });
  });

  it('is only a suggestion: the lead assigns whom they choose, and the queue stops suggesting once assigned', async () => {
    const qn = await inEngReview({ resin: 'PET' });
    expect(await queueSuggestion(qn)).toMatchObject({ userId: neiberger });
    ok(await assign(qn, pasillas), 200);
    expect((await detail(qn)).engineering.assignedEngineerId).toBe(pasillas);
    expect(await queueSuggestion(qn)).toBeNull();
  });

  it('is shown only to people who can assign', async () => {
    const qn = petQn;
    for (const role of ['Engineer', 'KAM', 'Pricing', 'Approver', 'Leadership'] as Role[]) {
      expect(await suggestionOn(qn, role), role).toBeNull();
    }
    expect(await suggestionOn(qn, 'EngLead')).not.toBeNull();
  });

  it('suggests nobody when the name has no user, the rules are empty, or no rule fits', async () => {
    const qn = petQn;
    await setRules({
      rules: [
        {
          processTypes: [],
          resins: ['PET'],
          engineerName: 'Nobody',
          engineerUserId: null,
          note: null,
        },
      ],
    });
    expect(await suggestionOn(qn)).toBeNull();
    await setRules({ rules: [] });
    expect(await suggestionOn(qn)).toBeNull();
    await setRules({
      rules: [
        {
          processTypes: ['ASSEMBLY'],
          resins: [],
          engineerName: 'Neiberger',
          engineerUserId: null,
          note: null,
        },
      ],
    });
    expect(await suggestionOn(qn)).toBeNull();
    // A malformed value falls back to the seed rather than breaking the tab.
    await setRules({ rules: 'oops' });
    expect(await suggestionOn(qn)).toMatchObject({ userId: neiberger });
  });
});
