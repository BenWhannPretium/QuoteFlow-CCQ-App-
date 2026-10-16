import { DEV_USER_HEADER } from '@ccq/contracts';
import {
  FinalReviewQueueResponse,
  GateDecisionResponse,
  IntakeDraft,
  MeResponse,
  QuoteDetail,
  ReviewSummary,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import { addCalendarDays, proposalCalendarDate, type Role } from '@ccq/domain';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * B-12 Final Review (G4): the approvals queue, the one-page review summary and the G4 decision through
 * the generic gate route. Approve moves to Customer Decision and sets the proposal dates; Decline closes
 * as DECLINED; Return bumps the version. None of them sets Awarded or Lost (X-88). Segregation (not the
 * KAM, not the Pricing approver) and the disabled-by-default approver-tier hook are exercised here.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-10-30T15:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
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

/** A request as a dev persona by key (the multi-role persona holds SalesLeader + Approver). */
const persona = (key: string) => {
  const send = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: { [DEV_USER_HEADER]: key },
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  return {
    get: (url: string) => send('GET', url),
    post: (url: string, body?: unknown) => send('POST', url, body),
    put: (url: string, body?: unknown) => send('PUT', url, body),
  };
};
const as = (role: Role) => asRole(app, role);
const ids: Record<string, string> = {};
async function userId(key: string): Promise<string> {
  ids[key] ??= MeResponse.parse((await persona(key).get('/api/v1/me')).json()).user.id;
  return ids[key];
}
const ROLE_PERSONA: Record<string, string> = {
  KAM: 'kam',
  SalesLeader: 'sales-leader',
  EngLead: 'eng-lead',
  Engineer: 'engineer',
  Pricing: 'pricing',
  Approver: 'approver',
  Leadership: 'leadership',
  Admin: 'admin',
};
const who = (roleOrPersona: string) => ROLE_PERSONA[roleOrPersona] ?? roleOrPersona;

const decide = (qn: string, body: Record<string, unknown>, by = 'Approver', gate = 'G4') =>
  persona(who(by)).post(`/api/v1/quotes/${qn}/gates/${gate}/decisions`, body);
const ok = (res: { statusCode: number; body: string }, status = 201) =>
  expect(res.statusCode, res.body).toBe(status);

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

/** Everything Pricing types that a KAM must never read back. */
const SECRETS = {
  basis: 'March CDI index, FOB Chicago',
  range: 'Floor 168.50, walk-away 162 per thousand',
  capitalNotes: 'Apex CER in finance review',
  cer: 'CER-77731',
  justification: 'Board signs the CER on Nov 10',
  erf: '48213',
  bpr: 'BPR-55120',
};

interface Opts {
  /** Who submits the intake: the KAM persona, or the multi-role persona (SalesLeader + Approver). */
  kam?: 'kam' | 'multi-role';
  /** Engineering's outcome. */
  g2?: 'proceed' | 'proceed_with_risk' | 'capital_required';
  /** Who is recorded as the price approver (default: the Pricing persona). */
  priceApprover?: 'pricing' | 'multi-role';
  prelimCapitalUsd?: number;
}

/** A quote that Pricing has submitted to Final Review. Returns its number. */
async function inFinalReview(o: Opts = {}) {
  const kam = o.kam ?? 'kam';
  const res = await persona(kam).post('/api/v1/quotes/drafts', {
    data: await prefill(await nextFree()),
  });
  ok(res);
  const sub = await persona(kam).post(
    `/api/v1/quotes/drafts/${IntakeDraft.parse(res.json()).id}/submit`,
  );
  ok(sub);
  const { quoteNumber: qn } = SubmitIntakeResponse.parse(sub.json());
  created.push(qn);
  ok(await decide(qn, { outcomeKey: 'advance' }, 'SalesLeader', 'G1'));
  ok(
    await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, {
      processType: 'EBM',
      machineType: 'EBM_SHUTTLE',
      plantCode: 'PLANT_01',
      cavitation: 8,
      cycleTimeS: 14.5,
      prelimCapitalUsd: o.prelimCapitalUsd ?? 250_000,
    }),
    200,
  );
  ok(
    await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-evidence`, {
      rows: [
        {
          site: 'PLANT_01',
          assumedEffectivenessPct: 70,
          cycleTimeS: 14.5,
          utilizationPct: 62,
          analysisDate: '2026-10-26',
          analystId: await userId('engineer'),
        },
      ],
    }),
    200,
  );
  const g2 = o.g2 ?? 'proceed';
  ok(
    await decide(
      qn,
      g2 === 'proceed_with_risk' ? { outcomeKey: g2, note: 'Tight on line 4' } : { outcomeKey: g2 },
      'EngLead',
      'G2',
    ),
  );
  tick();

  const approverKey = o.priceApprover ?? 'pricing';
  if (approverKey !== 'pricing') {
    // Make the persona a member of the Pricing team (the picker lists users holding quoting.edit).
    const id = await userId(approverKey);
    await db.db
      .insert(schema.userRole)
      .values({ userId: id, role: 'Pricing', createdBy: id })
      .onConflictDoNothing();
  }
  ok(
    await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
      approvedBy: await userId(approverKey),
      approvedAt: new Date(clock.getTime() - HOUR).toISOString(),
      pricingBasisNote: SECRETS.basis,
      approvedRangeNote: SECRETS.range,
      erfRefs: [SECRETS.erf],
      bprRefs: [SECRETS.bpr.toLowerCase()],
      costingCompleted: true,
    }),
    200,
  );
  ok(
    await as('Pricing').put(`/api/v1/quotes/${qn}/capital-readiness`, {
      capitalReadiness: g2 === 'capital_required' ? 'pending' : 'pre_approved',
      cerReference: SECRETS.cer,
      capitalNotes: SECRETS.capitalNotes,
      ...(g2 === 'capital_required' ? { capitalPendingJustification: SECRETS.justification } : {}),
    }),
    200,
  );
  ok(await decide(qn, { outcomeKey: 'submit' }, 'Pricing', 'G3'));
  tick();
  return qn;
}

const quoteRow = async (qn: string) =>
  (await db.db.select().from(schema.quote).where(eq(schema.quote.quoteNumber, qn)))[0]!;
const g4Decisions = async (qn: string) =>
  db.db
    .select()
    .from(schema.gateDecision)
    .where(
      and(
        eq(schema.gateDecision.quoteId, (await quoteRow(qn)).id),
        eq(schema.gateDecision.gateKey, 'G4'),
      ),
    )
    .orderBy(asc(schema.gateDecision.decidedAt));
const notifications = async (qn: string, type?: string) => {
  const rows = await db.db
    .select()
    .from(schema.notification)
    .where(eq(schema.notification.quoteId, (await quoteRow(qn)).id))
    .orderBy(desc(schema.notification.createdAt));
  return type ? rows.filter((n) => n.type === type) : rows;
};
const errorCodes = (res: { json: () => unknown }) =>
  ((res.json() as { errors?: { code: string }[] }).errors ?? []).map((e) => e.code).sort();
const errorPaths = (res: { json: () => unknown }) =>
  ((res.json() as { errors?: { path: string }[] }).errors ?? []).map((e) => e.path).sort();

async function queue(by = 'Approver', qs = '') {
  const res = await persona(who(by)).get(`/api/v1/approvals?gate=G4${qs}`);
  expect(res.statusCode, res.body).toBe(200);
  return FinalReviewQueueResponse.parse(res.json());
}
async function summary(qn: string, by = 'Approver') {
  const res = await persona(who(by)).get(`/api/v1/quotes/${qn}/review-summary`);
  expect(res.statusCode, res.body).toBe(200);
  return { dto: ReviewSummary.parse(res.json()), raw: res.body };
}
/** The US Central calendar date `days` after `at` (the domain's own helpers are unit-tested with literals). */
const validityFrom = (at: Date, days: number) => addCalendarDays(proposalCalendarDate(at), days);
const setSetting = (key: string, value: unknown) =>
  db.db.execute(
    sql`update app_setting set value = ${JSON.stringify(value)}::jsonb where key = ${key}`,
  );

beforeAll(async () => {
  const fresh = await freshSfDatabase('final_review');
  db = fresh.client;
  // Many requests in one minute: lift the per-minute limit that production keeps.
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
  // Provision the personas the flows notify or name before the first query.
  for (const key of ['kam', 'sales-leader', 'eng-lead', 'engineer', 'pricing', 'approver']) {
    await userId(key);
  }
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('the approvals queue (GET /approvals?gate=G4)', () => {
  it('lists the quote with what the approver decides on, in the documented order', async () => {
    const qn = await inFinalReview({ g2: 'capital_required' });
    const q = await queue();
    const open = await db.db.execute<{ n: number }>(
      sql`select count(*)::int as n from quote where stage_key = 'FINAL_REVIEW' and status <> 'closed'`,
    );
    expect(q.total).toBe(open[0]!.n);
    expect(q.items).toHaveLength(q.total);
    expect(q).toMatchObject({
      canDecide: true,
      gate: { key: 'G4', stageKey: 'FINAL_REVIEW', enabled: true },
      stage: { key: 'FINAL_REVIEW' },
    });

    const item = q.items.find((i) => i.quoteNumber === qn)!;
    expect(item).toMatchObject({
      stageKey: 'FINAL_REVIEW',
      g2Outcome: 'capital_required',
      g2OutcomeLabel: 'Capital required',
      g2Flag: true,
      capitalReadiness: 'pending',
      priceApproved: true,
      productSummary: '16 oz Bottle, HDPE',
      estAnnualVolume: 750_000,
      canDecide: true,
      blockedBy: [],
    });
    expect(item.customerName).toBeTruthy();
    expect(item.kamName).toBeTruthy();
    expect(item.priceApproverId).toBe(await userId('pricing'));
    expect(item.priceApproverName).toBeTruthy();
    expect(item.priority.tier).toBeTruthy();
    expect(item.waitingMs).toBe(HOUR); // frozen clock: one hour since G3

    // tier → score → longest waiting
    const tiers = ['CRITICAL', 'HIGH', 'STANDARD', 'LOW'];
    for (let i = 1; i < q.items.length; i++) {
      const a = q.items[i - 1]!;
      const b = q.items[i]!;
      const ra =
        tiers.indexOf(a.priority.tier ?? '') === -1 ? 9 : tiers.indexOf(a.priority.tier ?? '');
      const rb =
        tiers.indexOf(b.priority.tier ?? '') === -1 ? 9 : tiers.indexOf(b.priority.tier ?? '');
      expect(ra, `${a.quoteNumber} before ${b.quoteNumber}`).toBeLessThanOrEqual(rb);
      if (ra === rb && a.priority.score === b.priority.score) {
        expect(a.waitingMs).toBeGreaterThanOrEqual(b.waitingMs);
      }
    }
    expect(q.counts.flagged).toBeGreaterThanOrEqual(1);
    expect(q.counts.capitalPending).toBeGreaterThanOrEqual(1);
    expect(q.counts.decidable).toBe(q.items.filter((i) => i.canDecide).length);
  });

  it('filters by tier, G2 outcome, capital readiness, KAM and text', async () => {
    const risky = await inFinalReview({ g2: 'proceed_with_risk' });
    const plain = await inFinalReview();

    expect((await queue('Approver', `&q=${risky}`)).items.map((i) => i.quoteNumber)).toEqual([
      risky,
    ]);
    const byRisk = await queue('Approver', '&g2=proceed_with_risk');
    expect(byRisk.items.map((i) => i.quoteNumber)).toContain(risky);
    expect(byRisk.items.map((i) => i.quoteNumber)).not.toContain(plain);
    expect(byRisk.total).toBeGreaterThan(byRisk.items.length - 1); // total is before filters

    const byCapital = await queue('Approver', '&capital=pre_approved');
    expect(byCapital.items.map((i) => i.quoteNumber)).toContain(plain);
    expect(byCapital.items.every((i) => i.capitalReadiness === 'pre_approved')).toBe(true);

    const tier = (await queue('Approver', `&q=${plain}`)).items[0]!.priority.tier!;
    const byTier = await queue('Approver', `&tier=${tier}`);
    expect(byTier.items.every((i) => i.priority.tier === tier)).toBe(true);
    expect(byTier.items.map((i) => i.quoteNumber)).toContain(plain);

    const mine = await queue('Approver', `&kam=${await userId('kam')}&q=${plain}`);
    expect(mine.items.map((i) => i.quoteNumber)).toEqual([plain]);
    expect((await queue('Approver', '&kam=me')).items).toEqual([]); // the Approver is nobody's KAM

    // search by the price approver's name
    const name = (await queue('Approver', `&q=${plain}`)).items[0]!.priceApproverName!;
    expect(
      (await queue('Approver', `&q=${encodeURIComponent(name)}`)).items.map((i) => i.quoteNumber),
    ).toContain(plain);
  });

  it('is read by Approver, Leadership and Admin only; only an Approver can decide', async () => {
    await inFinalReview();
    for (const role of ['Leadership', 'Admin'] as Role[]) {
      const q = await queue(role);
      expect(q.canDecide, role).toBe(false);
      expect(q.items.length, role).toBeGreaterThan(0);
      expect(
        q.items.every((i) => !i.canDecide && i.blockedBy.length === 0),
        role,
      ).toBe(true);
    }
    for (const role of ['KAM', 'SalesLeader', 'EngLead', 'Engineer', 'Pricing'] as Role[]) {
      const res = await persona(who(role)).get('/api/v1/approvals?gate=G4');
      expect(res.statusCode, role).toBe(403);
    }
    // Only G4 is served here: G1 and the overrides have their own routes.
    expect((await persona('approver').get('/api/v1/approvals?gate=G1')).statusCode).toBe(400);
  });

  it('shows only quotes in Final Review: a quote leaves the queue when it is decided', async () => {
    const qn = await inFinalReview();
    expect((await queue()).items.map((i) => i.quoteNumber)).toContain(qn);
    ok(await decide(qn, { outcomeKey: 'approve' }));
    expect((await queue()).items.map((i) => i.quoteNumber)).not.toContain(qn);
  });
});

describe('the review summary (GET /quotes/:qn/review-summary)', () => {
  it('assembles the one-page snapshot an approver decides from', async () => {
    const qn = await inFinalReview({ g2: 'capital_required' });
    const { dto } = await summary(qn);

    expect(dto.quote).toMatchObject({
      quoteNumber: qn,
      stageKey: 'FINAL_REVIEW',
      estAnnualVolume: 750_000,
      estAnnualRevenue: 150_000,
    });
    expect(dto.inFinalReview).toBe(true);
    // intake summary
    expect(dto.intake).toMatchObject({
      standardDescription: '16 oz Bottle, HDPE',
      neckFinish: '38-400',
      packagingType: 'BULK',
      shipTo: { city: 'Testville' },
    });
    // score breakdown
    expect(dto.quote.priority.visible).toBe(true);
    expect(dto.quote.priority.breakdown.length).toBeGreaterThan(0);
    // engineering solution + capacity evidence (numbers included for an Approver)
    expect(dto.engineering.review).toMatchObject({
      processType: 'EBM',
      machineType: 'EBM_SHUTTLE',
      plantCode: 'PLANT_01',
      cavitation: 8,
      prelimCapitalUsd: 250_000,
    });
    expect(dto.engineering.capacityEvidence).toHaveLength(1);
    expect(dto.engineering.capacityEvidence[0]).toMatchObject({
      assumedEffectivenessPct: 70,
      utilizationPct: 62,
    });
    // pricing approval + basis + range note, capital readiness
    expect(dto.quoting.approval).toMatchObject({ approved: true });
    expect(dto.quoting.approval.approvedByName).toBeTruthy();
    expect(dto.quoting.pricingRecord).toMatchObject({
      pricingBasisNote: SECRETS.basis,
      approvedRangeNote: SECRETS.range,
      erfRefs: [SECRETS.erf],
      capitalReadiness: 'pending',
      cerReference: SECRETS.cer,
      capitalPendingJustification: SECRETS.justification,
    });
    expect(dto.quoting.g2).toMatchObject({ outcomeKey: 'capital_required' });
    // open warnings, attachments (none until B-16), decisions so far
    expect(dto.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['G2_CAPITAL_REQUIRED', 'CAPITAL_PENDING']),
    );
    expect(dto.attachments).toEqual([]);
    expect(dto.decisions.map((d) => `${d.gateKey}:${d.outcomeKey}`)).toEqual([
      'G3:submit',
      'G2:capital_required',
      'G1:advance',
    ]);
    // what the approver may do, and what an Approve will set
    expect(dto.canDecide).toBe(true);
    expect(dto.blockedBy).toEqual([]);
    expect(dto.requirement).toBeNull(); // the tier hook is disabled in the seed
    expect(dto.availableActions.map((a) => a.outcomeKey)).toEqual(['approve', 'decline', 'return']);
    expect(dto.availableActions.find((a) => a.outcomeKey === 'approve')).toMatchObject({
      releasesProposal: true,
      validityDays: 30,
      requiresNote: false,
    });
    expect(dto.availableActions.find((a) => a.outcomeKey === 'decline')).toMatchObject({
      releasesProposal: false,
      validityDays: null,
      requiresNote: true,
      requiresReasonCode: true,
    });
    expect(dto.availableActions.find((a) => a.outcomeKey === 'return')?.targetStageKeys).toEqual([
      'QUOTING',
      'ENG_REVIEW',
    ]);
    expect(dto.proposal).toEqual({ issuedAt: null, validityUntil: null, validityDaysDefault: 30 });
  });

  it('withholds every commercial part from roles that may not read it', async () => {
    const qn = await inFinalReview({ g2: 'capital_required' });
    for (const role of ['KAM', 'SalesLeader', 'Engineer'] as Role[]) {
      const { dto, raw } = await summary(qn, role);
      expect(dto.commercialRedacted, role).toBe(true);
      for (const secret of [
        SECRETS.basis,
        SECRETS.range,
        SECRETS.capitalNotes,
        SECRETS.cer,
        SECRETS.justification,
        SECRETS.erf,
        SECRETS.bpr,
        '250000',
      ]) {
        expect(raw, `${role} must not see ${secret}`).not.toContain(secret);
      }
      expect(dto.quoting.pricingRecord ?? null).toBeNull();
      expect(dto.engineering.review.prelimCapitalUsd).toBeUndefined();
      expect(dto.engineering.capacityEvidence[0]?.utilizationPct).toBeUndefined();
      // The approval status is not commercial: "Price approved ✓ on <date> by <name>".
      expect(dto.quoting.approval).toMatchObject({ approved: true });
      expect(dto.quoting.approval.approvedByName).toBeTruthy();
      // No decision to take, and the commercial warnings are not derived for them.
      expect(dto.availableActions).toEqual([]);
      expect(dto.canDecide).toBe(false);
      expect(dto.warnings.map((w) => w.code)).not.toContain('CAPITAL_PENDING');
    }
    expect((await summary(qn, 'Leadership')).dto.commercialRedacted).toBe(false);
  });

  it('is a quote view (audited) and 404 for an unknown quote', async () => {
    const qn = await inFinalReview();
    await summary(qn, 'Leadership');
    await new Promise((r) => setTimeout(r, 300)); // views are written after the response
    const leader = await userId('leadership');
    const rows = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.actorId, leader),
          eq(schema.auditEvent.action, 'view'),
          eq(schema.auditEvent.quoteId, (await quoteRow(qn)).id),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(
      (await persona('approver').get('/api/v1/quotes/CCQ-2099-99999/review-summary')).statusCode,
    ).toBe(404);
  });

  it('shows earlier Final Review returns to the next approver', async () => {
    const qn = await inFinalReview();
    ok(
      await decide(qn, {
        outcomeKey: 'return',
        targetStageKey: 'QUOTING',
        note: 'Re-check the range',
      }),
    );
    const { dto } = await summary(qn, 'Pricing');
    expect(dto.quote.stageKey).toBe('QUOTING');
    expect(dto.inFinalReview).toBe(false);
    expect(dto.decisions[0]).toMatchObject({
      gateKey: 'G4',
      outcomeKey: 'return',
      note: 'Re-check the range',
    });
    expect(dto.availableActions).toEqual([]);
  });
});

describe('G4 Approve', () => {
  it('moves to Customer Decision, sets the issue and validity dates, and never awards the quote', async () => {
    const qn = await inFinalReview();
    const res = await decide(qn, { outcomeKey: 'approve', note: 'Within the approved range' });
    ok(res);
    const { quote, decision } = GateDecisionResponse.parse(res.json());
    expect(quote).toMatchObject({ stageKey: 'CUSTOMER_DECISION', status: 'active', outcome: null });
    expect(decision).toMatchObject({
      gateKey: 'G4',
      outcomeKey: 'approve',
      note: 'Within the approved range',
    });

    const row = await quoteRow(qn);
    expect(row.stageKey).toBe('CUSTOMER_DECISION');
    expect(row.status).toBe('active');
    // not awarded, not lost, not closed
    expect(row.outcome).toBeNull();
    expect(row.outcomeReasonCode).toBeNull();
    expect(row.closedAt).toBeNull();
    expect(row.closureOwnerId).toBeNull();
    // default now; validity = issued + validity_days_default (30, provisional D-12)
    expect(row.proposalIssuedAt?.toISOString()).toBe(clock.toISOString());
    expect(row.validityUntil).toBe(validityFrom(clock, 30));
    expect(row.version).toBe(1);

    const [d] = await g4Decisions(qn);
    expect(d!.payload).toMatchObject({
      proposal_issued_at: clock.toISOString(),
      validity_until: validityFrom(clock, 30),
      validity_days: 30,
    });
    expect(d!.evidence).toMatchObject({
      release: { validityUntil: validityFrom(clock, 30), validityDays: 30 },
      decidedByRoles: ['Approver'],
    });

    // the timeline records it
    const events = await db.db
      .select()
      .from(schema.activityEvent)
      .where(eq(schema.activityEvent.quoteId, row.id));
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['gate_decided', 'stage_changed', 'proposal_released']),
    );
    expect(events.find((e) => e.type === 'proposal_released')!.payload).toMatchObject({
      validityUntil: validityFrom(clock, 30),
    });
  });

  it('notifies the KAM: "Approved; issue the proposal."', async () => {
    const qn = await inFinalReview();
    ok(await decide(qn, { outcomeKey: 'approve' }));
    const rows = await notifications(qn, 'quote.approved_for_customer');
    expect(rows.map((r) => r.userId)).toEqual([await userId('kam')]);
    expect(rows[0]).toMatchObject({ channel: 'in_app' });
    expect(rows[0]!.body).toContain('Approved; issue the proposal.');
    expect(rows[0]!.body).toContain(validityFrom(clock, 30));
  });

  it('takes the validity days from config, not from code', async () => {
    const qn = await inFinalReview();
    await setSetting('validity_days_default', 45);
    try {
      ok(await decide(qn, { outcomeKey: 'approve' }));
    } finally {
      await setSetting('validity_days_default', 30);
    }
    expect((await quoteRow(qn)).validityUntil).toBe(validityFrom(clock, 45));
  });

  it('lets the approver enter the actual send date; validity follows it', async () => {
    const qn = await inFinalReview();
    const sent = new Date(clock.getTime() - 5 * DAY).toISOString();
    ok(await decide(qn, { outcomeKey: 'approve', proposalIssuedAt: sent }));
    const row = await quoteRow(qn);
    expect(row.proposalIssuedAt?.toISOString()).toBe(sent);
    expect(row.validityUntil).toBe(validityFrom(new Date(sent), 30));
  });

  it('refuses a send date in the future, and a date on any other outcome', async () => {
    const qn = await inFinalReview();
    const future = await decide(qn, {
      outcomeKey: 'approve',
      proposalIssuedAt: new Date(clock.getTime() + DAY).toISOString(),
    });
    expect(future.statusCode).toBe(422);
    expect(errorCodes(future)).toEqual(['INVALID_PROPOSAL_DATE']);
    expect(errorPaths(future)).toEqual(['/proposalIssuedAt']);
    const onDecline = await decide(qn, {
      outcomeKey: 'decline',
      note: 'n',
      reasonCode: 'strategic_misfit',
      proposalIssuedAt: clock.toISOString(),
    });
    expect(onDecline.statusCode).toBe(422);
    expect(errorCodes(onDecline)).toEqual(['INVALID_PROPOSAL_DATE']);
    expect((await quoteRow(qn)).stageKey).toBe('FINAL_REVIEW'); // nothing happened
    expect((await quoteRow(qn)).proposalIssuedAt).toBeNull();
  });

  it('fails closed when validity_days_default is malformed', async () => {
    const qn = await inFinalReview();
    await setSetting('validity_days_default', 'thirty');
    try {
      const res = await decide(qn, { outcomeKey: 'approve' });
      expect(res.statusCode).toBe(422);
      expect(errorCodes(res)).toEqual(['INVALID_CONFIG']);
      expect(res.body).toContain('validity_days_default');
      expect((await quoteRow(qn)).stageKey).toBe('FINAL_REVIEW');
      // a Decline needs no validity date, so it still works
      ok(await decide(qn, { outcomeKey: 'decline', note: 'No', reasonCode: 'other' }));
    } finally {
      await setSetting('validity_days_default', 30);
    }
  });

  it('can only be decided once: the second Approve is refused', async () => {
    const qn = await inFinalReview();
    ok(await decide(qn, { outcomeKey: 'approve' }));
    const again = await decide(qn, { outcomeKey: 'approve' });
    expect(again.statusCode).toBe(422);
    expect(errorCodes(again)).toContain('WRONG_STAGE');
    expect(await g4Decisions(qn)).toHaveLength(1);
  });

  it('leaves the customer outcome to G5: an Approver cannot record Awarded or Lost', async () => {
    const qn = await inFinalReview();
    ok(await decide(qn, { outcomeKey: 'approve' }));
    for (const outcomeKey of ['awarded', 'lost']) {
      const res = await decide(qn, { outcomeKey, reasonCode: 'price' }, 'Approver', 'G5');
      expect(res.statusCode, outcomeKey).toBe(403);
    }
    const row = await quoteRow(qn);
    expect(row).toMatchObject({ stageKey: 'CUSTOMER_DECISION', outcome: null });
    // the KAM's quote is now the KAM's to take to the customer: they are offered the G5 outcomes
    const kam = QuoteDetail.parse((await persona('kam').get(`/api/v1/quotes/${qn}`)).json());
    expect(kam.availableActions.map((a) => a.gateKey)).toEqual(expect.arrayContaining(['G5']));
    expect(kam.availableActions.some((a) => a.gateKey === 'G4')).toBe(false);
  });
});

describe('G4 Decline', () => {
  it('needs a note and a decline reason code (the 10/14 demo rule)', async () => {
    const qn = await inFinalReview();
    const none = await decide(qn, { outcomeKey: 'decline' });
    expect(none.statusCode).toBe(422);
    expect(errorCodes(none)).toEqual(['NOTE_REQUIRED', 'REASON_REQUIRED']);
    expect(errorPaths(none)).toEqual(['/note', '/reasonCode']);
    expect(
      errorCodes(await decide(qn, { outcomeKey: 'decline', reasonCode: 'strategic_misfit' })),
    ).toEqual(['NOTE_REQUIRED']);
    expect(errorCodes(await decide(qn, { outcomeKey: 'decline', note: 'No' }))).toEqual([
      'REASON_REQUIRED',
    ]);
    // a Lost reason is not a decline reason
    expect(
      errorCodes(await decide(qn, { outcomeKey: 'decline', note: 'No', reasonCode: 'price' })),
    ).toEqual(['INVALID_REASON']);
    expect((await quoteRow(qn)).stageKey).toBe('FINAL_REVIEW');
  });

  it('closes as DECLINED (an internal no-go), records who decided and in which role, never Lost', async () => {
    const qn = await inFinalReview();
    const res = await decide(qn, {
      outcomeKey: 'decline',
      note: 'Margin is below the floor at this volume',
      reasonCode: 'margin_below_floor',
    });
    ok(res);
    const { quote } = GateDecisionResponse.parse(res.json());
    expect(quote).toMatchObject({
      stageKey: 'DECLINED',
      status: 'closed',
      outcome: 'declined',
      outcomeReasonCode: 'margin_below_floor',
    });
    const row = await quoteRow(qn);
    expect(row).toMatchObject({
      stageKey: 'DECLINED',
      status: 'closed',
      outcome: 'declined',
      closureOwnerId: await userId('approver'),
    });
    expect(row.closedAt).not.toBeNull();
    expect(row.proposalIssuedAt).toBeNull(); // no proposal was released
    expect(row.validityUntil).toBeNull();
    expect(['awarded', 'lost']).not.toContain(row.outcome);
    expect(row.stageKey).not.toBe('CLOSED_LOST');

    const [d] = await g4Decisions(qn);
    expect(d).toMatchObject({
      outcomeKey: 'decline',
      reasonCode: 'margin_below_floor',
      note: 'Margin is below the floor at this volume',
      decidedBy: await userId('approver'),
    });
    expect(d!.evidence).toMatchObject({ decidedByRoles: ['Approver'] });
    const audit = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.quoteId, row.id), eq(schema.auditEvent.action, 'stage_change')),
      );
    expect(audit.some((a) => a.actorRoles.includes('Approver'))).toBe(true);
  });

  it('notifies the KAM and Pricing (not the decider)', async () => {
    const qn = await inFinalReview();
    ok(await decide(qn, { outcomeKey: 'decline', note: 'No', reasonCode: 'capacity_unavailable' }));
    const rows = await notifications(qn, 'quote.declined');
    const recipients = rows.map((r) => r.userId);
    expect(recipients).toContain(await userId('kam'));
    expect(recipients).toContain(await userId('pricing'));
    expect(recipients).not.toContain(await userId('approver'));
    const pricingUsers = await db.db.execute<{ id: string }>(sql`
      select distinct u.id from app_user u join user_role r on r.user_id = u.id
      where r.role = 'Pricing' and u.active`);
    expect(recipients.sort()).toEqual(
      [...new Set([await userId('kam'), ...pricingUsers.map((u) => u.id)])].sort(),
    );
    expect(rows[0]!.body).toContain('Capacity unavailable');
  });
});

describe('G4 Return', () => {
  it('needs a note and a target stage', async () => {
    const qn = await inFinalReview();
    const none = await decide(qn, { outcomeKey: 'return' });
    expect(none.statusCode).toBe(422);
    expect(errorCodes(none)).toEqual(['NOTE_REQUIRED', 'TARGET_REQUIRED']);
    expect(
      errorCodes(await decide(qn, { outcomeKey: 'return', note: 'x', targetStageKey: 'INTAKE' })),
    ).toEqual(['INVALID_TARGET']);
    expect((await quoteRow(qn)).stageKey).toBe('FINAL_REVIEW');
  });

  it('Return to Quoting bumps the version, starts a new pricing record and keeps the old one', async () => {
    const qn = await inFinalReview();
    const res = await decide(qn, {
      outcomeKey: 'return',
      targetStageKey: 'QUOTING',
      note: 'The range note does not cover the resin move',
    });
    ok(res);
    const row = await quoteRow(qn);
    expect(row).toMatchObject({ stageKey: 'QUOTING', status: 'active', version: 2, outcome: null });
    expect(row.proposalIssuedAt).toBeNull();

    const records = await db.db
      .select()
      .from(schema.pricingRecord)
      .where(eq(schema.pricingRecord.quoteId, row.id))
      .orderBy(asc(schema.pricingRecord.quoteVersion));
    expect(records.map((r) => r.quoteVersion)).toEqual([1, 2]);
    expect(records[0]!.priceApprovedBy).not.toBeNull(); // v1 kept as history (CR-38)
    expect(records[1]!.priceApprovedBy).toBeNull(); // v2 needs its own approval
    expect(records[1]!.pricingRefs).toMatchObject({ erf: [SECRETS.erf] }); // references carried forward

    const [d] = await g4Decisions(qn);
    expect(d).toMatchObject({ quoteVersion: 1, targetStageKey: 'QUOTING' });
    // Pricing is told why
    const note = (await notifications(qn, 'quote.ready_for_quoting')).find((n) =>
      n.title.includes('returned'),
    );
    expect(note?.title).toBe(`${qn} was returned to Quoting`);
    expect(note?.body).toContain('Final Review returned it');
  });

  it('Return to Engineering Review bumps the version and alerts the EngLead', async () => {
    const qn = await inFinalReview();
    ok(
      await decide(qn, {
        outcomeKey: 'return',
        targetStageKey: 'ENG_REVIEW',
        note: 'Capacity is not proven',
      }),
    );
    expect(await quoteRow(qn)).toMatchObject({
      stageKey: 'ENG_REVIEW',
      version: 2,
      status: 'active',
    });
    const alert = (await notifications(qn, 'quote.ready_for_eng_review')).find((n) =>
      n.title.includes('returned'),
    );
    expect(alert?.title).toBe(`${qn} was returned to Engineering`);
    expect(alert?.userId).toBe(await userId('eng-lead'));
  });
});

describe('segregation: who may decide G4', () => {
  const body = (outcomeKey: string) =>
    outcomeKey === 'decline'
      ? { outcomeKey, note: 'No', reasonCode: 'other' }
      : outcomeKey === 'return'
        ? { outcomeKey, note: 'Again', targetStageKey: 'QUOTING' }
        : { outcomeKey };

  it('only an Approver decides: everyone else gets 403 and nothing changes', async () => {
    const qn = await inFinalReview();
    for (const role of [
      'KAM',
      'SalesLeader',
      'EngLead',
      'Engineer',
      'Pricing',
      'Leadership',
      'Admin',
    ]) {
      for (const outcome of ['approve', 'decline', 'return']) {
        const res = await decide(qn, body(outcome), role);
        expect(res.statusCode, `${role} ${outcome}`).toBe(403);
      }
    }
    expect((await quoteRow(qn)).stageKey).toBe('FINAL_REVIEW');
    expect(await g4Decisions(qn)).toHaveLength(0);
  });

  it("the approver cannot be the quote's KAM: 403 on every outcome", async () => {
    // The multi-role persona (SalesLeader + Approver) is the KAM of this quote.
    const qn = await inFinalReview({ kam: 'multi-role' });
    for (const outcome of ['approve', 'decline', 'return']) {
      const res = await decide(qn, body(outcome), 'multi-role');
      expect(res.statusCode, outcome).toBe(403);
      expect(res.body).toContain('you are the KAM');
    }
    expect(await g4Decisions(qn)).toHaveLength(0);

    // The queue and the summary say so up front instead of offering a button that fails.
    const item = (await queue('multi-role')).items.find((i) => i.quoteNumber === qn)!;
    expect(item).toMatchObject({ canDecide: false });
    expect(item.blockedBy).toEqual([
      'You cannot decide Final Review on a quote where you are the KAM',
    ]);
    const s = (await summary(qn, 'multi-role')).dto;
    expect(s).toMatchObject({ canDecide: false, availableActions: [] });
    expect(s.blockedBy).toEqual(item.blockedBy);

    // Another approver is fine.
    ok(await decide(qn, { outcomeKey: 'approve' }, 'Approver'));
  });

  it('the approver cannot be the Pricing approver on this quote: 403', async () => {
    const qn = await inFinalReview({ priceApprover: 'multi-role' });
    for (const outcome of ['approve', 'decline', 'return']) {
      const res = await decide(qn, body(outcome), 'multi-role');
      expect(res.statusCode, outcome).toBe(403);
      expect(res.body).toContain('price you approved or submitted');
    }
    const item = (await queue('multi-role')).items.find((i) => i.quoteNumber === qn)!;
    expect(item.canDecide).toBe(false);
    expect(item.blockedBy).toEqual([
      'You cannot decide Final Review on a quote whose price you approved or submitted',
    ]);
    expect((await summary(qn, 'multi-role')).dto.availableActions).toEqual([]);
    // The same person can still decide a quote whose price someone else approved.
    const other = await inFinalReview();
    ok(await decide(other, { outcomeKey: 'approve' }, 'multi-role'));
  });
});

describe('approver tiers (D-10): a hook, disabled by default', () => {
  // A SAMPLE rule, set in these tests only: capital of $200k or more needs the SalesLeader group as well.
  const SAMPLE = {
    tiers: [
      {
        key: 'delegated',
        label: 'Sales leader within delegation',
        minCapitalUsd: 200_000,
        approverRoles: ['SalesLeader'],
      },
    ],
  };

  it('is null in the seed, so any Approver may approve', async () => {
    const [row] = await db.db.execute<{ value: unknown }>(
      sql`select value from app_setting where key = 'g4_tier_rules'`,
    );
    expect(row!.value).toBeNull();
    const qn = await inFinalReview({ prelimCapitalUsd: 5_000_000 });
    ok(await decide(qn, { outcomeKey: 'approve' }));
  });

  it('when enabled, requires the tier’s group to approve, while decline and return stay open', async () => {
    const big = await inFinalReview({ prelimCapitalUsd: 250_000 });
    const small = await inFinalReview({ prelimCapitalUsd: 50_000 });
    await setSetting('g4_tier_rules', SAMPLE);
    try {
      // an Approver without the group: Approve refused (403) on the big quote, fine on the small one
      const refused = await decide(big, { outcomeKey: 'approve' }, 'Approver');
      expect(refused.statusCode).toBe(403);
      expect(refused.body).toContain('Sales leader within delegation');
      expect((await quoteRow(big)).stageKey).toBe('FINAL_REVIEW');
      // the review screen explains it and offers no Approve
      const s = (await summary(big, 'Approver')).dto;
      expect(s.requirement).toEqual({
        tierKey: 'delegated',
        tierLabel: 'Sales leader within delegation',
        satisfied: false,
      });
      expect(s.availableActions.map((a) => a.outcomeKey)).toEqual(['decline', 'return']);
      expect(s.warnings.map((w) => w.code)).toContain('TIER_APPROVER_REQUIRED');
      const item = (await queue('Approver', `&q=${big}`)).items[0]!;
      expect(item.canDecide).toBe(true); // can still decline or return

      // the small quote is below every threshold
      ok(await decide(small, { outcomeKey: 'approve' }, 'Approver'));

      // the multi-role persona holds SalesLeader, so the tier is met
      const meets = (await summary(big, 'multi-role')).dto;
      expect(meets.requirement).toMatchObject({ satisfied: true });
      expect(meets.availableActions.map((a) => a.outcomeKey)).toEqual([
        'approve',
        'decline',
        'return',
      ]);
      ok(await decide(big, { outcomeKey: 'approve' }, 'multi-role'));
    } finally {
      await setSetting('g4_tier_rules', null);
    }
  });

  it('decline stays open to a lower tier by default', async () => {
    const qn = await inFinalReview({ prelimCapitalUsd: 900_000 });
    await setSetting('g4_tier_rules', SAMPLE);
    try {
      ok(
        await decide(qn, {
          outcomeKey: 'decline',
          note: 'Too big for us',
          reasonCode: 'capital_not_approved',
        }),
      );
    } finally {
      await setSetting('g4_tier_rules', null);
    }
    expect((await quoteRow(qn)).stageKey).toBe('DECLINED');
  });

  it('fails closed when the rules are malformed (a bad setting never switches the control off)', async () => {
    const qn = await inFinalReview();
    await setSetting('g4_tier_rules', { tiers: [{ key: 'broken' }] });
    try {
      const res = await decide(qn, { outcomeKey: 'approve' });
      expect(res.statusCode).toBe(422);
      expect(errorCodes(res)).toEqual(['INVALID_CONFIG']);
      expect(res.body).toContain('g4_tier_rules');
      expect((await quoteRow(qn)).stageKey).toBe('FINAL_REVIEW');
    } finally {
      await setSetting('g4_tier_rules', null);
    }
    ok(await decide(qn, { outcomeKey: 'approve' }));
  });
});

describe('Final Review and the customer outcome stay separate', () => {
  it('no G4 decision ever produces an Awarded or Lost quote', async () => {
    const approved = await inFinalReview();
    const declined = await inFinalReview();
    const returned = await inFinalReview();
    ok(await decide(approved, { outcomeKey: 'approve' }));
    ok(await decide(declined, { outcomeKey: 'decline', note: 'No', reasonCode: 'other' }));
    ok(await decide(returned, { outcomeKey: 'return', targetStageKey: 'QUOTING', note: 'Again' }));
    const rows = await Promise.all([approved, declined, returned].map(quoteRow));
    expect(rows.map((r) => r.stageKey)).toEqual(['CUSTOMER_DECISION', 'DECLINED', 'QUOTING']);
    expect(rows.map((r) => r.outcome)).toEqual([null, 'declined', null]);
    for (const r of rows) {
      expect(['AWARDED', 'CLOSED_LOST']).not.toContain(r.stageKey);
      expect(['awarded', 'lost']).not.toContain(r.outcome);
    }
  });
});
