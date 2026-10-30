import {
  BulkReassignResponse,
  GateDecisionResponse,
  IntakeDraft,
  MeResponse,
  PricerAssignmentResponse,
  PricingQueueResponse,
  QuoteDetail,
  QuotingDetail,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import { loadQuoteState } from '@ccq/db/repos';
import type { Role } from '@ccq/domain';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * B-11: the pricing queue, the Quoting tab (price approval record, pricing-app references, capital
 * readiness), commercial redaction for every other role, and G3 through the generic gate route,
 * including versioned pricing records on Rework.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-10-30T15:00:00Z');
const HOUR = 3_600_000;
const tick = (ms = HOUR) => {
  clock = new Date(clock.getTime() + ms);
};

let free: string[] = [];
const created: string[] = [];
async function nextFree(): Promise<string> {
  const id = free.shift();
  if (id) return id;
  const old = created.shift();
  if (!old) throw new Error('test ran out of free opportunities');
  const [row] = await db.db.execute<{ id: string }>(sql`
    update quote set stage_key = 'DECLINED', status = 'closed', outcome = 'declined', closed_at = now(),
      outcome_reason_code = 'other', closure_owner_id = kam_user_id
    where quote_number = ${old} returning sf_opportunity_id as id`);
  return row!.id;
}

const as = (role: Role) => asRole(app, role);
const ids: Partial<Record<Role, string>> = {};
async function userId(role: Role): Promise<string> {
  ids[role] ??= MeResponse.parse((await as(role).get('/api/v1/me')).json()).user.id;
  return ids[role];
}

const decide = (qn: string, gate: string, body: Record<string, unknown>, role: Role) =>
  as(role).post(`/api/v1/quotes/${qn}/gates/${gate}/decisions`, body);

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
    neckFinish: '38-400',
    packagingType: 'BULK',
    estAnnualVolume: 750_000,
    estAnnualRevenue: 150_000,
    expectedCloseDate: '2026-12-15',
    containerSize: '16 oz',
    standardDescription: '16 oz Bottle, HDPE',
    drawingStatus: 'HAVE_DRAWING',
    ...over,
  };
}

/** A quote Engineering cleared into Quoting with the given G2 outcome. */
/** B-26: the capacity owner's G2 sign-off (seeded to the EngLead). */
async function signOff(qn: string) {
  const res = await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-signoff`, {
    status: 'approved',
  });
  expect(res.statusCode, res.body).toBe(200);
}

async function inQuoting(g2: 'proceed' | 'proceed_with_risk' | 'capital_required' = 'proceed') {
  const res = await as('KAM').post('/api/v1/quotes/drafts', {
    data: await prefill(await nextFree()),
  });
  expect(res.statusCode, res.body).toBe(201);
  const sub = await as('KAM').post(
    `/api/v1/quotes/drafts/${IntakeDraft.parse(res.json()).id}/submit`,
  );
  expect(sub.statusCode, sub.body).toBe(201);
  const { quoteNumber: qn } = SubmitIntakeResponse.parse(sub.json());
  created.push(qn);
  expect((await decide(qn, 'G1', { outcomeKey: 'advance' }, 'SalesLeader')).statusCode).toBe(201);
  const review = await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, {
    processType: 'EBM',
    machineType: 'EBM_SHUTTLE',
    plantCode: 'PLANT_01',
    cavitation: 8,
    cycleTimeS: 14.5,
    prelimCapitalUsd: 250_000,
  });
  expect(review.statusCode, review.body).toBe(200);
  const cap = await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
    rows: [
      {
        site: 'PLANT_01',
        assumedEffectivenessPct: 70,
        cycleTimeS: 14.5,
        utilizationPct: 62,
        analysisDate: '2026-10-26',
        analystId: await userId('Engineer'),
      },
    ],
  });
  expect(cap.statusCode, cap.body).toBe(200);
  await signOff(qn);
  const body =
    g2 === 'proceed_with_risk' ? { outcomeKey: g2, note: 'Tight on line 4' } : { outcomeKey: g2 };
  const adv = await decide(qn, 'G2', body, 'EngLead');
  expect(adv.statusCode, adv.body).toBe(201);
  tick();
  return qn;
}

async function detail(qn: string, role: Role = 'Pricing') {
  const res = await as(role).get(`/api/v1/quotes/${qn}`);
  expect(res.statusCode, res.body).toBe(200);
  return { dto: QuoteDetail.parse(res.json()), raw: res.body };
}

const putRecord = (qn: string, body: Record<string, unknown>, role: Role = 'Pricing') =>
  as(role).put(`/api/v1/quotes/${qn}/pricing-record`, body);
const putCapital = (qn: string, body: Record<string, unknown>, role: Role = 'Pricing') =>
  as(role).put(`/api/v1/quotes/${qn}/capital-readiness`, body);

async function queue(role: Role = 'Pricing', qs = '') {
  const res = await as(role).get(`/api/v1/queue/pricing${qs}`);
  expect(res.statusCode, res.body).toBe(200);
  return PricingQueueResponse.parse(res.json());
}

const errorPaths = (res: { json: () => unknown }) =>
  ((res.json() as { errors?: { path: string }[] }).errors ?? []).map((e) => e.path).sort();
const errorCodes = (res: { json: () => unknown }) =>
  ((res.json() as { errors?: { code: string }[] }).errors ?? []).map((e) => e.code).sort();

const quoteId = async (qn: string) =>
  (await db.db.select().from(schema.quote).where(eq(schema.quote.quoteNumber, qn)))[0]!.id;
const records = async (qn: string) =>
  db.db
    .select()
    .from(schema.pricingRecord)
    .where(eq(schema.pricingRecord.quoteId, await quoteId(qn)))
    .orderBy(asc(schema.pricingRecord.quoteVersion));

/** Everything Pricing types that a KAM must never read back. */
const SECRETS = {
  basis: 'March CDI index, FOB Chicago',
  range: 'Floor 168.50, walk-away 162 per thousand',
  capitalNotes: 'Apex CER in finance review',
  cer: 'CER-77731',
  justification: 'Board signs the CER on Nov 10',
  erf: 'ERF26-213',
};

/** A full approval: references, basis, range, costing. */
async function approve(qn: string, extra: Record<string, unknown> = {}) {
  const res = await putRecord(qn, {
    approvedBy: await userId('Pricing'),
    approvedAt: new Date(clock.getTime() - HOUR).toISOString(),
    pricingBasisNote: SECRETS.basis,
    approvedRangeNote: SECRETS.range,
    erfRefs: [SECRETS.erf],
    costingCompleted: true,
    ...extra,
  });
  expect(res.statusCode, res.body).toBe(200);
  return QuotingDetail.parse(res.json());
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('pricing');
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
  expect(free.length).toBeGreaterThanOrEqual(10);
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('the pricing queue', () => {
  it('lists every open QUOTING quote, ordered tier → score → longest in Quoting', async () => {
    const qn = await inQuoting('capital_required');
    const q = await queue();
    const open = await db.db.execute<{ n: number }>(
      sql`select count(*)::int as n from quote where stage_key = 'QUOTING' and status <> 'closed'`,
    );
    expect(q.total).toBe(open[0]!.n);
    expect(q.items.length).toBe(q.total);
    expect(q).toMatchObject({ canEdit: true, canDecide: true, stage: { key: 'QUOTING' } });

    const tiers = ['CRITICAL', 'HIGH', 'STANDARD', 'LOW'];
    for (let i = 1; i < q.items.length; i++) {
      const a = q.items[i - 1]!;
      const b = q.items[i]!;
      const ta = tiers.indexOf(a.priority.tier ?? '');
      const tb = tiers.indexOf(b.priority.tier ?? '');
      const ra = ta === -1 ? tiers.length : ta;
      const rb = tb === -1 ? tiers.length : tb;
      expect(ra, `${a.quoteNumber} before ${b.quoteNumber}`).toBeLessThanOrEqual(rb);
      if (ra === rb && a.priority.score !== b.priority.score) {
        expect(a.priority.score ?? -1).toBeGreaterThanOrEqual(b.priority.score ?? -1);
      }
      if (ra === rb && a.priority.score === b.priority.score) {
        expect(a.activeMsInStage).toBeGreaterThanOrEqual(b.activeMsInStage);
      }
    }

    const item = q.items.find((i) => i.quoteNumber === qn)!;
    expect(item).toMatchObject({
      g2Outcome: 'capital_required',
      g2OutcomeLabel: 'Advance – capital required',
      g2Flag: true,
      capitalReadiness: 'pending',
      priceApproved: false,
      productSummary: '16 oz Bottle, HDPE',
      estAnnualVolume: 750_000,
      canEdit: true,
    });
    expect(item.kamName).toBeTruthy();
    expect(item.activeMsInStage).toBe(HOUR);
    expect(q.counts.capitalPending).toBeGreaterThanOrEqual(1);
  });

  it('filters by G2 outcome, capital readiness, approval and text', async () => {
    const risky = await inQuoting('proceed_with_risk');
    const plain = await inQuoting('proceed');
    await approve(plain, { capitalReadiness: undefined });
    const flagged = await queue('Pricing', '?g2=capital_required,proceed_with_risk');
    expect(flagged.items.every((i) => i.g2Flag)).toBe(true);
    expect(flagged.items.map((i) => i.quoteNumber)).toContain(risky);
    expect(flagged.items.map((i) => i.quoteNumber)).not.toContain(plain);
    expect((await queue('Pricing', '?approved=yes')).items.map((i) => i.quoteNumber)).toContain(
      plain,
    );
    expect((await queue('Pricing', '?approved=no')).items.map((i) => i.quoteNumber)).not.toContain(
      plain,
    );
    expect((await queue('Pricing', `?q=${SECRETS.erf}`)).items.map((i) => i.quoteNumber)).toEqual(
      expect.arrayContaining([plain]),
    );
    expect(
      (await queue('Pricing', '?capital=none')).items.every((i) => i.capitalReadiness === null),
    ).toBe(true);
  });

  it('Pricing works it, Leadership and Admin read it; nobody else opens it', async () => {
    const pricing = await queue('Pricing');
    for (const role of ['Leadership', 'Admin'] as Role[]) {
      const q = await queue(role);
      expect(q, role).toMatchObject({ canEdit: false, canDecide: false, total: pricing.total });
      expect(q.items.every((i) => !i.canEdit)).toBe(true);
    }
    for (const role of ['KAM', 'SalesLeader', 'EngLead', 'Engineer', 'Approver'] as Role[]) {
      expect((await as(role).get('/api/v1/queue/pricing')).statusCode, role).toBe(403);
    }
  });

  it('arrival: the version gets a pricing record and the Pricing team is told', async () => {
    const qn = await inQuoting();
    const [row] = await records(qn);
    expect(row).toMatchObject({ quoteVersion: 1, priceApprovedBy: null, capitalReadiness: null });
    const notes = await db.db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.quoteId, await quoteId(qn)),
          eq(schema.notification.type, 'quote.ready_for_quoting'),
        ),
      );
    // B-26: the Pricing team includes the pricing lead.
    expect(notes.map((n) => n.userId).sort()).toEqual(
      [await userId('Pricing'), await userId('PricingLead')].sort(),
    );
  });
});

describe('the price approval record', () => {
  it('records approver, time, basis, range, references and the costing attestation', async () => {
    const qn = await inQuoting();
    const pricer = await userId('Pricing');
    const quoting = await approve(qn);
    expect(quoting.approval).toMatchObject({ approved: true, quoteVersion: 1 });
    expect(quoting.pricingRecord).toMatchObject({
      quoteVersion: 1,
      priceApprovedBy: pricer,
      pricingBasisNote: SECRETS.basis,
      approvedRangeNote: SECRETS.range,
      erfRefs: [SECRETS.erf],
      costingCompleted: true,
    });
    expect(quoting.pricingRecord).not.toHaveProperty('bprRefs');
    expect(quoting.pricingRecord!.costingAttestedByName).toBeTruthy();
    // B-26: the pricing lead is on the Pricing team too.
    expect(quoting.pricingUsers.map((u) => u.id).sort()).toEqual(
      [pricer, await userId('PricingLead')].sort(),
    );
    expect(quoting.refFormats.erf.example).toBe('ERF25-123');

    const timeline = await db.db
      .select()
      .from(schema.activityEvent)
      .where(eq(schema.activityEvent.quoteId, await quoteId(qn)))
      .orderBy(desc(schema.activityEvent.at));
    const types = timeline.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(['price_approval_recorded', 'pricing_record_updated']),
    );
    // Timeline payloads go to every reader: field names, never the notes or references.
    expect(JSON.stringify(timeline.map((e) => e.payload))).not.toContain(SECRETS.range);
    expect(JSON.stringify(timeline.map((e) => e.payload))).not.toContain(SECRETS.erf);

    const [audit] = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.quoteId, await quoteId(qn)),
          eq(schema.auditEvent.entity, 'pricing_record'),
        ),
      );
    expect(audit).toMatchObject({ action: 'update', actorId: pricer });
    expect(audit!.after).toMatchObject({ approvedRangeNote: SECRETS.range });
  });

  it('names an approver from the Pricing team only, checks formats, rejects a future time', async () => {
    const qn = await inQuoting();
    const bad = await putRecord(qn, {
      approvedBy: await userId('KAM'),
      approvedAt: new Date(clock.getTime() + 24 * HOUR).toISOString(),
      erfRefs: ['ERF twelve'],
    });
    expect(bad.statusCode).toBe(422);
    expect(errorPaths(bad)).toEqual(['/approvedAt', '/approvedBy', '/erfRefs/0']);
    // B-26: BPR references and the "no record yet" note are gone from the body.
    expect((await putRecord(qn, { bprRefs: ['BPR-1'] })).statusCode).toBe(400);
    expect((await putRecord(qn, { noPricingAppRecordNote: 'x' })).statusCode).toBe(400);
    // The formats are config: change the setting, not the code.
    const formats = (erf: object) =>
      db.db.execute(sql`
        update app_setting set value = jsonb_set(value, '{erf}', ${JSON.stringify(erf)}::jsonb)
        where key = 'pricing_ref_formats'`);
    await formats({ label: 'ERF number', pattern: '^ERF-\\d+$', example: 'ERF-1' });
    expect((await putRecord(qn, { erfRefs: ['erf-99'] })).statusCode).toBe(200);
    expect((await putRecord(qn, { erfRefs: ['26367'] })).statusCode).toBe(422);
    await formats({
      label: 'Legacy ERF number',
      pattern: '^(ERF|EP)\\d{2}-\\d{2,5}$',
      example: 'ERF25-123',
    });
  });

  it('only Pricing edits, and only while the quote is in Quoting', async () => {
    const qn = await inQuoting();
    for (const role of [
      'KAM',
      'EngLead',
      'Engineer',
      'Approver',
      'Leadership',
      'Admin',
    ] as Role[]) {
      expect((await putRecord(qn, { pricingBasisNote: 'x' }, role)).statusCode, role).toBe(403);
      expect((await putCapital(qn, { capitalReadiness: 'pending' }, role)).statusCode, role).toBe(
        403,
      );
    }
    const before = await decide(
      qn,
      'G3',
      { outcomeKey: 'rework', reasonCode: 'missing_information' },
      'Pricing',
    );
    expect(before.statusCode, before.body).toBe(201);
    const late = await putRecord(qn, { pricingBasisNote: 'x' });
    expect(late.statusCode).toBe(409);
    expect((await putCapital(qn, { capitalReadiness: 'pending' })).statusCode).toBe(409);
  });

  it('there is no price figure anywhere: unknown keys are rejected', async () => {
    const qn = await inQuoting();
    for (const key of ['price', 'pricePerThousand', 'approvedPrice', 'margin']) {
      const res = await putRecord(qn, { [key]: 174.98 });
      expect(res.statusCode, key).toBe(400);
    }
  });
});

describe('commercial redaction (architecture §3.3)', () => {
  it('a KAM, an Engineer and a SalesLeader read the pricing record too, but cannot edit it', async () => {
    const qn = await inQuoting('capital_required');
    await approve(qn);
    await putCapital(qn, {
      capitalReadiness: 'pending',
      cerReference: SECRETS.cer,
      capitalNotes: SECRETS.capitalNotes,
      capitalPendingJustification: SECRETS.justification,
    });
    const pricing = (await detail(qn)).dto.quoting;
    expect(pricing.pricingRecord).toMatchObject({
      capitalReadiness: 'pending',
      cerReference: SECRETS.cer,
    });

    for (const role of ['KAM', 'Engineer', 'SalesLeader'] as Role[]) {
      const { dto } = await detail(qn, role);
      expect(dto.quoting.approval, role).toMatchObject({
        approved: true,
        approvedAt: pricing.approval.approvedAt,
        approvedByName: pricing.approval.approvedByName,
      });
      // 2026-10-30: every role reads the whole record; editing stays Pricing's.
      expect(dto.quoting.commercialRedacted, role).toBe(false);
      expect(dto.quoting.pricingRecord, role).toEqual(pricing.pricingRecord);
      expect(dto.quoting.pricingRecords, role).toEqual(pricing.pricingRecords);
      expect(dto.quoting.canEdit, role).toBe(false);
      const tl = await as(role).get(`/api/v1/quotes/${qn}/timeline`);
      expect(tl.statusCode).toBe(200);
    }
    for (const role of ['Pricing', 'Approver', 'EngLead', 'Leadership', 'Admin'] as Role[]) {
      const { dto } = await detail(qn, role);
      expect(dto.quoting.commercialRedacted, role).toBe(false);
      expect(dto.quoting.pricingRecord, role).toMatchObject({ approvedRangeNote: SECRETS.range });
    }
  });

  it('the write routes answer with the redacted view for anyone else (none can call them)', async () => {
    const qn = await inQuoting();
    const res = await putRecord(qn, { pricingBasisNote: SECRETS.basis }, 'KAM');
    expect(res.statusCode).toBe(403);
    expect(res.body.includes(SECRETS.basis)).toBe(false);
  });
});

describe('capital readiness', () => {
  it('after G2 "Capital required" it starts pending and cannot be "not required"', async () => {
    const qn = await inQuoting('capital_required');
    expect((await detail(qn)).dto.quoting.pricingRecord!.capitalReadiness).toBe('pending');
    const no = await putCapital(qn, { capitalReadiness: 'not_required' });
    expect(no.statusCode).toBe(422);
    expect(errorPaths(no)).toEqual(['/capitalReadiness']);
    const ok = await putCapital(qn, { capitalReadiness: 'pre_approved', cerReference: 'CER-1' });
    expect(QuotingDetail.parse(ok.json()).pricingRecord).toMatchObject({
      capitalReadiness: 'pre_approved',
      cerReference: 'CER-1',
    });
  });

  it('can be "not required" when Engineering did not ask for capital', async () => {
    const qn = await inQuoting('proceed');
    const ok = await putCapital(qn, { capitalReadiness: 'not_required' });
    expect(ok.statusCode, ok.body).toBe(200);
  });
});

describe('G3 Submit to Final Review', () => {
  it('needs the approval, the costing attestation and a capital status (B-26: no ERF / BPR)', async () => {
    const qn = await inQuoting();
    const empty = await decide(qn, 'G3', { outcomeKey: 'submit' }, 'Pricing');
    expect(empty.statusCode).toBe(422);
    expect(errorPaths(empty)).toEqual([
      '/pricing_record.capital_readiness',
      '/pricing_record.capital_readiness,pricing_record.capital_pending_justification',
      '/pricing_record.costing_completed',
      '/pricing_record.price_approved_by,pricing_record.price_approved_at,pass_through_eligible',
    ]);
    // The decision dialog lists the same gaps before the click.
    const missing = (await detail(qn)).dto.availableActions.find(
      (a) => a.gateKey === 'G3' && a.outcomeKey === 'submit',
    )!.missing;
    expect(missing).toHaveLength(4);

    // Cost before price: the approval alone is not enough.
    await putRecord(qn, { approvedBy: await userId('Pricing') });
    await putCapital(qn, { capitalReadiness: 'not_required' });
    expect(errorPaths(await decide(qn, 'G3', { outcomeKey: 'submit' }, 'Pricing'))).toEqual([
      '/pricing_record.costing_completed',
    ]);
    await putRecord(qn, { costingCompleted: true });
    await putCapital(qn, { capitalReadiness: 'not_required' });
    const ok = await decide(qn, 'G3', { outcomeKey: 'submit' }, 'Pricing');
    expect(ok.statusCode, ok.body).toBe(201);
    const { quote } = GateDecisionResponse.parse(ok.json());
    expect(quote).toMatchObject({ stageKey: 'FINAL_REVIEW', status: 'active' });

    // The Approver group is told in-app and by email (B-18).
    const notes = await db.db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.quoteId, quote.id),
          eq(schema.notification.type, 'quote.ready_for_final_review'),
          eq(schema.notification.channel, 'in_app'),
        ),
      );
    const approvers = await db.db.execute<{ id: string }>(sql`
      select distinct u.id from app_user u join user_role r on r.user_id = u.id
      where r.role = 'Approver' and u.active`);
    expect(notes.map((n) => n.userId).sort()).toEqual(approvers.map((a) => a.id).sort());
    const emails = await db.db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.quoteId, quote.id),
          eq(schema.notification.type, 'quote.ready_for_final_review'),
          eq(schema.notification.channel, 'email'),
        ),
      );
    expect(emails.map((n) => n.userId).sort()).toEqual(approvers.map((a) => a.id).sort());
    // Pricing's own arrival alert ("ready for pricing") stays in-app only.
    expect(
      await db.db
        .select()
        .from(schema.notification)
        .where(
          and(
            eq(schema.notification.quoteId, quote.id),
            eq(schema.notification.type, 'quote.ready_for_quoting'),
            eq(schema.notification.channel, 'email'),
          ),
        ),
    ).toHaveLength(0);

    // The decision keeps what Pricing was warned about; the record is closed to edits now.
    const [decision] = await db.db
      .select()
      .from(schema.gateDecision)
      .where(and(eq(schema.gateDecision.quoteId, quote.id), eq(schema.gateDecision.gateKey, 'G3')));
    expect(
      (decision!.evidence as { quoting: { warnings: { code: string }[] } }).quoting.warnings.map(
        (w) => w.code,
      ),
    ).toEqual([]);
    expect((await putRecord(qn, { pricingBasisNote: 'late' })).statusCode).toBe(409);
  });

  it('"Capital required" path: pending capital needs a justification, then submits with a warning', async () => {
    const qn = await inQuoting('capital_required');
    await approve(qn);
    const blocked = await decide(qn, 'G3', { outcomeKey: 'submit' }, 'Pricing');
    expect(blocked.statusCode).toBe(422);
    expect(errorPaths(blocked)).toEqual([
      '/pricing_record.capital_readiness,pricing_record.capital_pending_justification',
    ]);
    await putCapital(qn, {
      capitalReadiness: 'pending',
      capitalPendingJustification: SECRETS.justification,
    });
    const view = (await detail(qn)).dto.quoting.pricingRecord!;
    expect(view.warnings.map((w) => w.code)).toEqual(['CAPITAL_PENDING']);
    const ok = await decide(qn, 'G3', { outcomeKey: 'submit' }, 'Pricing');
    expect(ok.statusCode, ok.body).toBe(201);
    const id = await quoteId(qn);
    const [decision] = await db.db
      .select()
      .from(schema.gateDecision)
      .where(and(eq(schema.gateDecision.quoteId, id), eq(schema.gateDecision.gateKey, 'G3')));
    expect(decision!.evidence).toMatchObject({
      quoting: { warnings: [{ code: 'CAPITAL_PENDING' }] },
      fields: { 'pricing_record.capital_readiness': 'pending' },
    });
  });

  it('only Pricing decides G3', async () => {
    const qn = await inQuoting();
    await approve(qn);
    await putCapital(qn, { capitalReadiness: 'not_required' });
    for (const role of ['KAM', 'EngLead', 'Approver', 'Leadership', 'Admin'] as Role[]) {
      expect((await decide(qn, 'G3', { outcomeKey: 'submit' }, role)).statusCode, role).toBe(403);
    }
    // B-26: the pricing lead decides G3 like Pricing.
    const lead = await decide(qn, 'G3', { outcomeKey: 'submit' }, 'PricingLead');
    expect(lead.statusCode, lead.body).toBe(201);
  });

  it('B-26: below the pass-through threshold a price advances without formal approval', async () => {
    const qn = await inQuoting();
    await putRecord(qn, { costingCompleted: true });
    await putCapital(qn, { capitalReadiness: 'not_required' });
    expect((await decide(qn, 'G3', { outcomeKey: 'submit' }, 'Pricing')).statusCode).toBe(422);
    const id = await quoteId(qn);
    await db.db.execute(sql`update quote set est_annual_revenue = 40000 where id = ${id}`);
    await db.db.execute(
      sql`update app_setting set value = '{"maxAnnualRevenueUsd": 50000}'::jsonb where key = 'pricing_pass_through'`,
    );
    try {
      expect((await detail(qn)).dto.commercial.passThroughEligible).toBe(true);
      const ok = await decide(qn, 'G3', { outcomeKey: 'submit' }, 'Pricing');
      expect(ok.statusCode, ok.body).toBe(201);
    } finally {
      await db.db.execute(
        sql`update app_setting set value = '{"maxAnnualRevenueUsd": null}'::jsonb where key = 'pricing_pass_through'`,
      );
    }
  });

  it('B-26: a "capital likely" quote needs capital readiness confirmed, not pending', async () => {
    const qn = await inQuoting();
    await approve(qn);
    await putCapital(qn, {
      capitalReadiness: 'pending',
      capitalPendingJustification: SECRETS.justification,
    });
    const flag = await as('EngLead').put(`/api/v1/quotes/${qn}/capital-flag`, {
      capitalLikely: true,
    });
    expect(flag.statusCode, flag.body).toBe(200);
    expect(errorPaths(await decide(qn, 'G3', { outcomeKey: 'submit' }, 'Pricing'))).toEqual([
      '/capital_likely,pricing_record.capital_readiness',
    ]);
    await putCapital(qn, { capitalReadiness: 'pre_approved' });
    expect((await decide(qn, 'G3', { outcomeKey: 'submit' }, 'Pricing')).statusCode).toBe(201);
  });

  it('B-26: Rework (re-cost) stays in Quoting and clears the costing attestation; Redirect stays too', async () => {
    const qn = await inQuoting();
    await approve(qn);
    const recost = await decide(
      qn,
      'G3',
      { outcomeKey: 'recost', reasonCode: 'missing_information', note: 'Freight changed' },
      'Pricing',
    );
    expect(recost.statusCode, recost.body).toBe(201);
    expect(GateDecisionResponse.parse(recost.json()).quote).toMatchObject({
      stageKey: 'QUOTING',
      version: 1,
    });
    expect((await records(qn)).at(-1)).toMatchObject({
      costingCompleted: false,
      costingAttestedBy: null,
    });
    const redirect = await decide(
      qn,
      'G3',
      { outcomeKey: 'redirect', note: 'Customer funds the tooling' },
      'Pricing',
    );
    expect(GateDecisionResponse.parse(redirect.json()).quote.stageKey).toBe('QUOTING');
  });

  it('segregation: the price approver and the G3 submitter are on the quote state for G4', async () => {
    const qn = await inQuoting();
    await approve(qn);
    await putCapital(qn, { capitalReadiness: 'not_required' });
    await decide(qn, 'G3', { outcomeKey: 'submit' }, 'Pricing');
    const state = await db.db.transaction(async (tx) => loadQuoteState(tx, await quoteId(qn)));
    expect(state!.priceApproverIds).toEqual([await userId('Pricing')]);
    // The plain Approver persona approved no price: G4 stays open to them (B-12 builds the screen).
    const actions = (await detail(qn, 'Approver')).dto.availableActions;
    expect(actions.some((a) => a.gateKey === 'G4')).toBe(true);
  });

  it('Hold needs a reason, a review date and an owner (B-26)', async () => {
    const qn = await inQuoting();
    expect(errorCodes(await decide(qn, 'G3', { outcomeKey: 'hold' }, 'Pricing'))).toEqual([
      'MISSING_FIELD',
      'MISSING_FIELD',
      'REASON_REQUIRED',
    ]);
    const ok = await decide(
      qn,
      'G3',
      {
        outcomeKey: 'hold',
        reasonCode: 'awaiting_capital_decision',
        holdUntil: '2026-11-20',
        holdOwnerId: await userId('Pricing'),
      },
      'Pricing',
    );
    expect(GateDecisionResponse.parse(ok.json()).quote).toMatchObject({
      stageKey: 'QUOTING',
      status: 'on_hold',
      reviewDate: '2026-11-20',
    });
    // On hold is still in the queue, and still editable.
    expect((await queue()).items.find((i) => i.quoteNumber === qn)!.status).toBe('on_hold');
    expect((await putRecord(qn, { pricingBasisNote: 'x' })).statusCode).toBe(200);
  });

  it('Stop needs a reason and a note and closes as DECLINED', async () => {
    const qn = await inQuoting();
    expect(errorCodes(await decide(qn, 'G3', { outcomeKey: 'stop' }, 'Pricing'))).toEqual([
      'NOTE_REQUIRED',
      'REASON_REQUIRED',
    ]);
    const ok = await decide(
      qn,
      'G3',
      { outcomeKey: 'stop', reasonCode: 'not_strategic', note: 'Below the margin floor' },
      'Pricing',
    );
    expect(GateDecisionResponse.parse(ok.json()).quote).toMatchObject({
      stageKey: 'DECLINED',
      status: 'closed',
      outcome: 'declined',
    });
  });

  it('Rework goes back to Engineering, bumps the version and keeps the prior record as history', async () => {
    const qn = await inQuoting();
    await approve(qn);
    await putCapital(qn, { capitalReadiness: 'not_required', cerReference: 'CER-5' });
    const [v1] = await records(qn);
    expect((await decide(qn, 'G3', { outcomeKey: 'rework' }, 'Pricing')).statusCode).toBe(422);
    const rework = await decide(
      qn,
      'G3',
      { outcomeKey: 'rework', reasonCode: 'missing_information' },
      'Pricing',
    );
    expect(rework.statusCode, rework.body).toBe(201);
    expect(GateDecisionResponse.parse(rework.json()).quote).toMatchObject({
      stageKey: 'ENG_REVIEW',
      version: 2,
    });
    tick();
    // Engineering clears it again: version 2 gets its own record, the references carried forward.
    await signOff(qn); // B-26: the sign-off is per stay in the queue
    expect((await decide(qn, 'G2', { outcomeKey: 'proceed' }, 'EngLead')).statusCode).toBe(201);
    const rows = await records(qn);
    expect(rows.map((r) => r.quoteVersion)).toEqual([1, 2]);
    expect(rows[0]).toEqual(v1); // never overwritten
    expect(rows[1]).toMatchObject({
      priceApprovedBy: null,
      approvedRangeNote: null,
      capitalReadiness: null,
      cerReference: 'CER-5',
      pricingRefs: { erf: [SECRETS.erf] },
    });

    const quoting = (await detail(qn)).dto.quoting;
    expect(quoting.approval).toMatchObject({ approved: false, quoteVersion: 2 });
    expect(quoting.pricingRecords!.map((r) => [r.quoteVersion, r.approvedRangeNote])).toEqual([
      [1, SECRETS.range],
    ]);
    // Version 1's G3 submitter no longer counts toward segregation on version 2.
    const state = await db.db.transaction(async (tx) => loadQuoteState(tx, await quoteId(qn)));
    expect(state!.priceApproverIds).toEqual([]);

    // A new approval on version 2 leaves version 1 untouched.
    await approve(qn, { approvedRangeNote: 'v2 range' });
    const after = await records(qn);
    expect(after[0]).toEqual(v1);
    expect(after[1]!.approvedRangeNote).toBe('v2 range');
  });
});

describe('B-26: the pricing lead triages the queue (CCQ demo, Darren and Bailey)', () => {
  it('assigns and reassigns a pricer; the pricer is told and the queue shows it', async () => {
    const qn = await inQuoting();
    const pricer = await userId('Pricing');
    const lead = await userId('PricingLead');
    const url = `/api/v1/quotes/${qn}/pricing-assignment`;
    for (const role of ['Pricing', 'KAM', 'EngLead', 'Approver', 'Leadership'] as Role[]) {
      expect((await as(role).post(url, { pricerId: pricer })).statusCode, role).toBe(403);
    }
    const res = await as('PricingLead').post(url, { pricerId: pricer });
    expect(res.statusCode, res.body).toBe(200);
    expect(PricerAssignmentResponse.parse(res.json())).toMatchObject({
      assignedPricerId: pricer,
      changed: true,
    });
    expect(
      PricerAssignmentResponse.parse(
        (await as('PricingLead').post(url, { pricerId: pricer })).json(),
      ).changed,
    ).toBe(false);
    // Only Pricing / PricingLead users can take Quoting work.
    expect((await as('PricingLead').post(url, { pricerId: await userId('KAM') })).statusCode).toBe(
      422,
    );

    const q = await queue('PricingLead');
    expect(q.canAssign).toBe(true);
    expect(q.pricers.map((p) => p.id)).toEqual(expect.arrayContaining([pricer, lead]));
    expect(q.items.find((i) => i.quoteNumber === qn)).toMatchObject({
      assignedPricerId: pricer,
    });
    expect((await queue('Pricing', '?pricer=me')).items.map((i) => i.quoteNumber)).toContain(qn);
    expect((await queue('Pricing')).canAssign).toBe(false);

    // The quote's Quoting tab shows the assignment, and offers Assign… to the lead only, like the
    // Engineering tab does for the engineering lead.
    const leadTab = (await detail(qn, 'PricingLead')).dto.quoting;
    expect(leadTab).toMatchObject({ assignedPricerId: pricer, canAssign: true });
    expect(leadTab.assignedPricerName).toEqual(expect.any(String));
    expect(leadTab.pricerAssignedAt).toEqual(expect.any(String));
    const pricerTab = (await detail(qn, 'Pricing')).dto.quoting;
    expect(pricerTab).toMatchObject({ assignedPricerId: pricer, canAssign: false });

    const told = await db.db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.quoteId, await quoteId(qn)),
          eq(schema.notification.type, 'quote.pricing_assigned'),
          eq(schema.notification.userId, pricer),
        ),
      );
    expect(told.length).toBeGreaterThan(0);
  });

  it("moves a pricer's whole load to another pricer in one go", async () => {
    const pricer = await userId('Pricing');
    const lead = await userId('PricingLead');
    const a = await inQuoting();
    const b = await inQuoting();
    for (const qn of [a, b]) {
      await as('PricingLead').post(`/api/v1/quotes/${qn}/pricing-assignment`, { pricerId: pricer });
    }
    const res = await as('PricingLead').post('/api/v1/queue/pricing/reassign', {
      fromUserId: pricer,
      toUserId: lead,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(BulkReassignResponse.parse(res.json()).reassigned).toEqual(
      expect.arrayContaining([a, b]),
    );
    const items = (await queue('PricingLead')).items;
    for (const qn of [a, b]) {
      expect(items.find((i) => i.quoteNumber === qn)!.assignedPricerId).toBe(lead);
    }
    expect(
      (
        await as('Pricing').post('/api/v1/queue/pricing/reassign', {
          fromUserId: lead,
          toUserId: pricer,
        })
      ).statusCode,
    ).toBe(403);
  });
});
