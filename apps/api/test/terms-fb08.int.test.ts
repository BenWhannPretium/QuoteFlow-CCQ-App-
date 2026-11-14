import {
  DEV_USER_HEADER,
  IntakeDraft,
  MeResponse,
  QuoteDetail,
  ReviewSummary,
  SECTION_LOCKED_PROBLEM_TYPE,
  SfOpportunityDetail,
  SubmitIntakeResponse,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import type { Role } from '@ccq/domain';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmCapitalTerms, prepareModels } from './model-helpers';
import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * FB-08 commercial terms and Final Review, through the API on a real Postgres:
 * - F-021: MOQ and funding are Engineering's; payment terms are a list; non-standard terms are flagged
 *   and open an exception request the pricing lead decides with a rationale (T-007).
 * - F-068 / T-031: the KAM pre-fills the capital terms; the approver edits and confirms them in Final
 *   Review; G4 Advance needs the confirmation and no open exception; they lock at G4 Approve.
 * - F-082 (off until A-035): the extra sign-offs, when an Admin switches the rule on.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-11-10T15:00:00Z');
const HOUR = 3_600_000;
const tick = (ms = HOUR) => {
  clock = new Date(clock.getTime() + ms);
};

const PERSONA: Partial<Record<Role, string>> = {
  KAM: 'kam',
  SalesLeader: 'sales-leader',
  EngLead: 'eng-lead',
  Engineer: 'engineer',
  Pricing: 'pricing',
  PricingLead: 'pricing-lead',
  Approver: 'approver',
  Leadership: 'leadership',
  Admin: 'admin',
};
const ROLES = Object.keys(PERSONA) as Role[];

let free: string[] = [];
const as = (role: Role) => asRole(app, role);
const ids: Record<string, string> = {};
async function userId(role: Role): Promise<string> {
  ids[role] ??= MeResponse.parse(
    (
      await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { [DEV_USER_HEADER]: PERSONA[role]! },
      })
    ).json(),
  ).user.id;
  return ids[role];
}
const ok = (res: { statusCode: number; body: string }, status = 200) =>
  expect(res.statusCode, res.body).toBe(status);
const decide = (qn: string, gate: string, body: Record<string, unknown>, by: Role) =>
  as(by).post(`/api/v1/quotes/${qn}/gates/${gate}/decisions`, body);
const errorCodes = (res: { json: () => unknown }) =>
  ((res.json() as { errors?: { code?: string }[] }).errors ?? []).map((e) => e.code).sort();
const errorPaths = (res: { json: () => unknown }) =>
  ((res.json() as { errors?: { path?: string }[] }).errors ?? []).map((e) => e.path).sort();
const quoteRow = async (qn: string) =>
  (await db.db.select().from(schema.quote).where(eq(schema.quote.quoteNumber, qn)))[0]!;
const detail = (res: { json: () => unknown }) => QuoteDetail.parse(res.json());
const setSetting = (key: string, value: unknown) =>
  db.db.execute(
    sql`update app_setting set value = ${JSON.stringify(value)}::jsonb where key = ${key}`,
  );

async function submitted(): Promise<string> {
  const id = free.shift();
  if (!id) throw new Error('test ran out of free opportunities');
  const sf = SfOpportunityDetail.parse(
    (await as('KAM').get(`/api/v1/salesforce/opportunities/${id}`)).json(),
  );
  const shipTo = {
    line1: '1 Test St',
    city: 'Testville',
    state: 'MO',
    postal: '63101',
    country: 'US',
  };
  const res = await as('KAM').post('/api/v1/quotes/drafts', {
    data: {
      sfOpportunityId: id,
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
      requestedPaymentTerms: 'NET_60',
    },
  });
  ok(res, 201);
  const sub = await as('KAM').post(
    `/api/v1/quotes/drafts/${IntakeDraft.parse(res.json()).id}/submit`,
  );
  ok(sub, 201);
  return SubmitIntakeResponse.parse(sub.json()).quoteNumber;
}

async function inEngineering(): Promise<string> {
  const qn = await submitted();
  ok(await decide(qn, 'G1', { outcomeKey: 'advance' }, 'SalesLeader'), 201);
  return qn;
}

async function inFinalReview(): Promise<string> {
  const qn = await inEngineering();
  ok(
    await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, {
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
          analysisDate: '2026-10-26',
          analystId: await userId('Engineer'),
        },
      ],
    }),
  );
  ok(await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-signoff`, { status: 'approved' }));
  ok(await decide(qn, 'G2', { outcomeKey: 'proceed' }, 'EngLead'), 201);
  tick();
  await prepareModels(app, qn);
  ok(
    await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
      approvedBy: await userId('Pricing'),
      approvedAt: new Date(clock.getTime() - HOUR).toISOString(),
      pricingBasisNote: 'March CDI',
      costingCompleted: true,
    }),
  );
  ok(
    await as('Pricing').put(`/api/v1/quotes/${qn}/capital-readiness`, {
      capitalReadiness: 'not_required',
    }),
  );
  ok(await decide(qn, 'G3', { outcomeKey: 'submit' }, 'PricingLead'), 201);
  tick();
  return qn;
}

async function notified(qn: string, type: string) {
  const q = await quoteRow(qn);
  return db.db
    .select()
    .from(schema.notification)
    .where(
      and(
        eq(schema.notification.quoteId, q.id),
        eq(schema.notification.type, type),
        eq(schema.notification.channel, 'in_app'),
      ),
    );
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('terms_fb08');
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
  for (const role of ROLES) await userId(role);
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('seeded config (provisional)', () => {
  it('g4_required_checks blocks on the exception and the capital-terms confirmation; the extra approval is off', async () => {
    const rows = await db.db
      .select()
      .from(schema.appSetting)
      .where(
        inArray(schema.appSetting.key, [
          'g4_required_checks',
          'g4_additional_approvals',
          'capital_terms_required',
          'default_payment_terms',
        ]),
      );
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.g4_required_checks).toMatchObject({
      value: ['terms_exception', 'terms_finalized'],
      provisional: true,
    });
    expect(
      (by.g4_additional_approvals!.value as { rules: { active: boolean }[] }).rules.map(
        (r) => r.active,
      ),
    ).toEqual([false]);
    expect(by.default_payment_terms!.value).toBe('NET_30');
    expect(rows.every((r) => r.provisional)).toBe(true);
  });
});

describe('F-021: who edits which terms', () => {
  it('MOQ and funding are Engineering’s: the KAM is refused, the assigned engineer and the EngLead are not', async () => {
    const qn = await inEngineering();
    // The KAM's route no longer takes MOQ or funding (strict body).
    expect(
      (await as('KAM').put(`/api/v1/quotes/${qn}/terms`, { termsMoq: '10k' })).statusCode,
    ).toBe(400);
    expect(
      (await as('KAM').put(`/api/v1/quotes/${qn}/terms/engineering`, { termsMoq: '10k' }))
        .statusCode,
    ).toBe(403);
    // An engineer who is not assigned is refused by the service (assigned qualifier).
    expect(
      (await as('Engineer').put(`/api/v1/quotes/${qn}/terms/engineering`, { termsMoq: '10k' }))
        .statusCode,
    ).toBe(403);
    ok(
      await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, {
        engineerId: await userId('Engineer'),
      }),
    );
    const res = await as('Engineer').put(`/api/v1/quotes/${qn}/terms/engineering`, {
      termsMoq: '10k / release',
      toolingFundingModel: 'ZERO_CER',
    });
    ok(res);
    expect(detail(res).commercial.terms).toMatchObject({
      termsMoq: '10k / release',
      toolingFundingModel: 'ZERO_CER',
    });
    ok(await as('EngLead').put(`/api/v1/quotes/${qn}/terms/engineering`, { termsMoq: '12k' }));
    const audit = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.quoteId, (await quoteRow(qn)).id),
          eq(schema.auditEvent.entity, 'quote'),
        ),
      )
      .orderBy(desc(schema.auditEvent.createdAt));
    expect(audit[0]!.after).toMatchObject({ termsMoq: '12k' });
  });

  it('the KAM view says who may edit what', async () => {
    const qn = await inEngineering();
    const kam = detail(await as('KAM').get(`/api/v1/quotes/${qn}`)).commercial.terms;
    expect([kam.canEdit, kam.canEditEngineering, kam.capital.canFinalize]).toEqual([
      true,
      false,
      false,
    ]);
    const lead = detail(await as('EngLead').get(`/api/v1/quotes/${qn}`)).commercial.terms;
    expect([lead.canEdit, lead.canEditEngineering]).toEqual([false, true]);
  });
});

describe('T-007: a non-standard payment term needs the pricing lead’s exception', () => {
  it('Net 45 is flagged, opens a request and tells the pricing lead; the decision needs a rationale and tells the KAM', async () => {
    const qn = await inEngineering();
    const res = await as('KAM').put(`/api/v1/quotes/${qn}/terms`, {
      termsPaymentTermsCode: 'NET_45',
    });
    ok(res);
    const terms = detail(res).commercial.terms;
    expect(terms).toMatchObject({
      termsPaymentTermsCode: 'NET_45',
      paymentTermsNonstandard: true,
      termsNonstandard: true,
      exception: { status: 'pending', paymentTermsCode: 'NET_45', canDecide: false },
    });
    expect(await notified(qn, 'quote.terms_exception_requested')).not.toHaveLength(0);

    // Only the pricing lead decides.
    for (const role of ['KAM', 'Pricing', 'Approver', 'SalesLeader'] as Role[]) {
      const denied = await as(role).post(`/api/v1/quotes/${qn}/terms/exception/decision`, {
        decision: 'approve',
        rationale: 'x',
      });
      expect(denied.statusCode, `${role}: ${denied.body}`).toBe(403);
    }
    const lead = detail(await as('PricingLead').get(`/api/v1/quotes/${qn}`)).commercial.terms;
    expect(lead.exception?.canDecide).toBe(true);
    const noWhy = await as('PricingLead').post(`/api/v1/quotes/${qn}/terms/exception/decision`, {
      decision: 'approve',
      rationale: ' ',
    });
    expect(noWhy.statusCode).toBe(422);
    expect(errorPaths(noWhy)).toEqual(['/rationale']);

    const approved = await as('PricingLead').post(`/api/v1/quotes/${qn}/terms/exception/decision`, {
      decision: 'approve',
      rationale: 'Strategic account; borrowing cost priced in.',
    });
    ok(approved);
    expect(detail(approved).commercial.terms.exception).toMatchObject({
      status: 'approved',
      rationale: 'Strategic account; borrowing cost priced in.',
      canDecide: false,
    });
    const kamNotice = (await notified(qn, 'quote.terms_exception_decided')).filter(
      (n) => n.userId === ids.KAM,
    );
    expect(kamNotice).toHaveLength(1);
    expect(kamNotice[0]!.body).toContain('Strategic account');
    // Deciding again: nothing pending.
    const again = await as('PricingLead').post(`/api/v1/quotes/${qn}/terms/exception/decision`, {
      decision: 'reject',
      rationale: 'x',
    });
    expect(again.statusCode).toBe(409);

    const q = await quoteRow(qn);
    const audit = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.quoteId, q.id),
          eq(schema.auditEvent.entity, 'terms_exception_request'),
        ),
      );
    expect(audit.map((a) => a.action).sort()).toEqual(['create', 'update']);
  });

  it('changing the terms supersedes the request; back to standard withdraws it', async () => {
    const qn = await inEngineering();
    ok(await as('KAM').put(`/api/v1/quotes/${qn}/terms`, { termsPaymentTermsCode: 'NET_60' }));
    ok(
      await as('KAM').put(`/api/v1/quotes/${qn}/terms`, {
        termsPaymentTermsCode: 'OTHER',
        termsPaymentTerms: '2% 10, Net 45',
      }),
    );
    const back = await as('KAM').put(`/api/v1/quotes/${qn}/terms`, {
      termsPaymentTermsCode: 'NET_30',
    });
    ok(back);
    expect(detail(back).commercial.terms).toMatchObject({
      termsNonstandard: false,
      paymentTermsNonstandard: false,
      exception: null,
    });
    const requests = await db.db
      .select()
      .from(schema.termsExceptionRequest)
      .where(eq(schema.termsExceptionRequest.quoteId, (await quoteRow(qn)).id))
      .orderBy(schema.termsExceptionRequest.requestedAt);
    expect(requests.map((r) => [r.paymentTermsCode, r.status])).toEqual([
      ['NET_60', 'superseded'],
      ['OTHER', 'withdrawn'],
    ]);
    // "Other" needs its detail.
    const other = await as('KAM').put(`/api/v1/quotes/${qn}/terms`, {
      termsPaymentTermsCode: 'OTHER',
    });
    expect(other.statusCode).toBe(422);
    expect(errorPaths(other)).toEqual(['/termsPaymentTerms']);
  });
});

describe('F-068 / T-031: the approver confirms the capital terms; required and locked at G4', () => {
  it('a $0 CER quote: the KAM pre-fills, the approver finalizes, G4 waits for it and the exception, then locks', async () => {
    const qn = await inFinalReview();
    // The KAM pre-fills the capital terms (not the funding: Engineering's / the approver's).
    ok(
      await as('KAM').put(`/api/v1/quotes/${qn}/terms`, {
        termsPaymentTermsCode: 'NET_60',
        termsMoldOwnership: 'CUSTOMER',
        termsAmortized: true,
        termsAmortizationMonths: 36,
      }),
    );
    // The approver may not finalize outside Final Review, and nobody else may finalize.
    for (const role of ['KAM', 'PricingLead', 'SalesLeader', 'EngLead'] as Role[]) {
      expect(
        (await as(role).put(`/api/v1/quotes/${qn}/terms/capital`, { finalized: true })).statusCode,
        role,
      ).toBe(403);
    }
    // Missing terms: 422 naming each.
    const missing = await as('Approver').put(`/api/v1/quotes/${qn}/terms/capital`, {
      finalized: true,
    });
    expect(missing.statusCode).toBe(422);
    expect(errorPaths(missing)).toEqual([
      '/termsAgreementInPlace',
      '/termsMinSupply',
      '/toolingFundingModel',
    ]);

    // G4 is blocked: capital terms not confirmed, exception pending.
    const review = ReviewSummary.parse(
      (await as('Approver').get(`/api/v1/quotes/${qn}/review-summary`)).json(),
    );
    expect(review.termsAndLegal).toMatchObject({
      requiredChecks: ['terms_exception', 'terms_finalized'],
      termsPaymentTermsLabel: 'Net 60',
      capital: { moldOwnership: 'CUSTOMER', amortizationMonths: 36, canFinalize: true },
      exception: { status: 'pending' },
      additionalApprovals: [],
    });
    const blocked = await decide(qn, 'G4', { outcomeKey: 'approve' }, 'Approver');
    expect(blocked.statusCode).toBe(422);
    expect(errorPaths(blocked)).toEqual([
      '/g4_terms_exception_check_required,terms_exception_open',
      '/g4_terms_finalized_check_required,terms_finalized_at',
    ]);

    const confirmed = await as('Approver').put(`/api/v1/quotes/${qn}/terms/capital`, {
      toolingFundingModel: 'ZERO_CER',
      termsMinSupply: 'Shortfall below 80% of forecast is invoiced',
      termsAgreementInPlace: true,
      termsAgreementMonths: 60,
      finalized: true,
    });
    ok(confirmed);
    const capital = detail(confirmed).commercial.terms.capital;
    expect(capital).toMatchObject({ toolingFundingModel: 'ZERO_CER', agreementMonths: 60 });
    expect(capital.finalizedByName).toBeTruthy();
    // A rejected exception still blocks.
    ok(
      await as('PricingLead').post(`/api/v1/quotes/${qn}/terms/exception/decision`, {
        decision: 'reject',
        rationale: 'Net 60 is too long for this volume.',
      }),
    );
    const rejected = await decide(qn, 'G4', { outcomeKey: 'approve' }, 'Approver');
    expect(errorPaths(rejected)).toEqual([
      '/g4_terms_exception_check_required,terms_exception_open',
    ]);
    // Back to Net 30 (a terms change, not a capital one): the confirmation stands; G4 approves.
    ok(await as('KAM').put(`/api/v1/quotes/${qn}/terms`, { termsPaymentTermsCode: 'NET_30' }));
    expect((await quoteRow(qn)).termsFinalizedAt).not.toBeNull();
    ok(await decide(qn, 'G4', { outcomeKey: 'approve' }, 'Approver'), 201);

    // Locked at G4 Approve (T-031): every terms route answers 409.
    // (The lock answers first, so every role that passes a route's gate gets the same 409.)
    for (const [role, url, body] of [
      ['KAM', 'terms', { termsMinSupply: 'x' }],
      ['EngLead', 'terms/engineering', { termsMoq: 'x' }],
      ['Approver', 'terms/capital', { finalized: false }],
    ] as const) {
      const res = await as(role).put(`/api/v1/quotes/${qn}/${url}`, body);
      expect(res.statusCode, `${role} ${url}`).toBe(409);
      expect(res.json<{ type: string }>().type).toBe(SECTION_LOCKED_PROBLEM_TYPE);
    }
    expect(
      (
        await as('PricingLead').post(`/api/v1/quotes/${qn}/terms/exception/decision`, {
          decision: 'approve',
          rationale: 'x',
        })
      ).statusCode,
    ).toBe(409);
  });

  it('a capital change after the confirmation clears it, so G4 waits again', async () => {
    const qn = await inFinalReview();
    await confirmCapitalTerms(app, qn);
    const res = await as('KAM').put(`/api/v1/quotes/${qn}/terms`, {
      termsMinSupply: '70% of forecast',
    });
    ok(res);
    expect(detail(res).commercial.terms.capital.finalizedAt).toBeNull();
    expect(errorPaths(await decide(qn, 'G4', { outcomeKey: 'approve' }, 'Approver'))).toEqual([
      '/g4_terms_finalized_check_required,terms_finalized_at',
    ]);
  });
});

describe('F-082: extra Final Review sign-offs (seeded off; on only after A-035)', () => {
  const RULE = {
    rules: [
      {
        key: 'customer_funded_capital',
        label: 'Customer-funded capital: sales leader, then leadership',
        active: true,
        when: { fundingModels: ['CUSTOMER_FUNDED', 'ZERO_CER'] },
        signoffs: [
          { key: 'sales_leader', label: 'Sales leader', roles: ['SalesLeader'], userIds: [] },
          { key: 'leadership', label: 'Leadership', roles: ['Leadership'], userIds: [] },
        ],
      },
    ],
  };
  const sign = (qn: string, role: Role, signoffKey: string) =>
    as(role).post(`/api/v1/quotes/${qn}/final-review/signoffs`, {
      ruleKey: 'customer_funded_capital',
      signoffKey,
    });

  it('off: a customer-funded quote needs nothing extra, and nobody can sign', async () => {
    const qn = await inFinalReview();
    ok(
      await as('EngLead').put(`/api/v1/quotes/${qn}/terms/engineering`, {
        toolingFundingModel: 'CUSTOMER_FUNDED',
      }),
    );
    expect(
      detail(await as('SalesLeader').get(`/api/v1/quotes/${qn}`)).commercial.additionalApprovals,
    ).toEqual([]);
    expect((await sign(qn, 'SalesLeader', 'sales_leader')).statusCode).toBe(422);
  });

  it('on: the sales leader, then leadership, then the approver may release', async () => {
    await setSetting('g4_additional_approvals', RULE);
    try {
      const qn = await inFinalReview();
      ok(
        await as('EngLead').put(`/api/v1/quotes/${qn}/terms/engineering`, {
          toolingFundingModel: 'CUSTOMER_FUNDED',
        }),
      );
      ok(
        await as('Approver').put(`/api/v1/quotes/${qn}/terms/capital`, {
          termsMoldOwnership: 'CUSTOMER',
          termsAmortized: false,
          termsMinSupply: 'None',
          termsAgreementInPlace: false,
          finalized: true,
        }),
      );
      const refused = await decide(qn, 'G4', { outcomeKey: 'approve' }, 'Approver');
      expect(refused.statusCode).toBe(422);
      expect(errorCodes(refused)).toEqual(['ADDITIONAL_APPROVAL_REQUIRED']);
      // Out of order, wrong role, and roles without finalReview.signoff.
      expect((await sign(qn, 'Leadership', 'leadership')).statusCode).toBe(422);
      expect((await sign(qn, 'Leadership', 'sales_leader')).statusCode).toBe(403);
      expect((await sign(qn, 'Approver', 'sales_leader')).statusCode).toBe(403);
      const view = detail(await as('SalesLeader').get(`/api/v1/quotes/${qn}`)).commercial
        .additionalApprovals;
      expect(view.map((v) => [v.signoffKey, v.canSign])).toEqual([
        ['sales_leader', true],
        ['leadership', false],
      ]);
      ok(await sign(qn, 'SalesLeader', 'sales_leader'));
      expect((await sign(qn, 'SalesLeader', 'sales_leader')).statusCode).toBe(409);
      ok(await sign(qn, 'Leadership', 'leadership'));
      ok(await decide(qn, 'G4', { outcomeKey: 'approve' }, 'Approver'), 201);
      const rows = await db.db
        .select()
        .from(schema.g4Signoff)
        .where(eq(schema.g4Signoff.quoteId, (await quoteRow(qn)).id));
      expect(rows.map((r) => r.signoffKey).sort()).toEqual(['leadership', 'sales_leader']);
    } finally {
      await setSetting('g4_additional_approvals', {
        rules: RULE.rules.map((r) => ({ ...r, active: false })),
      });
    }
  });
});

/**
 * DR-approver-leadership-admin-01 (Sev-2): the G4 segregation rules (`g4-kam-cannot-approve-own`,
 * `g4-price-approver-cannot-release`) also bar editing and confirming the capital terms, which gate the
 * release. Allowed and denied per persona: `approver` (allowed; denied as the price approver),
 * `multi-role` (SalesLeader + Approver; denied as the quote's KAM) and `kam-owner` (no terms.finalize).
 */
describe('DR-approver-leadership-admin-01: capital-terms segregation', () => {
  const byKey = (key: string) => ({
    get: (url: string) => app.inject({ method: 'GET', url, headers: { [DEV_USER_HEADER]: key } }),
    put: (url: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'PUT', url, payload, headers: { [DEV_USER_HEADER]: key } }),
  });
  const idOf = async (key: string) =>
    MeResponse.parse((await byKey(key).get('/api/v1/me')).json()).user.id;
  const capital = {
    toolingFundingModel: 'ZERO_CER',
    termsMoldOwnership: 'CUSTOMER',
    termsAmortized: false,
    termsMinSupply: 'Shortfall below 80% of forecast is invoiced',
    termsAgreementInPlace: true,
    termsAgreementMonths: 60,
    finalized: true,
  };
  const capitalView = async (qn: string, key: string) =>
    ReviewSummary.parse((await byKey(key).get(`/api/v1/quotes/${qn}/review-summary`)).json())
      .termsAndLegal.capital;

  it("the quote's KAM (multi-role) may not edit or confirm them; another approver may", async () => {
    const qn = await inFinalReview();
    await db.db
      .update(schema.quote)
      .set({ kamUserId: await idOf('multi-role') })
      .where(eq(schema.quote.quoteNumber, qn));

    const view = await capitalView(qn, 'multi-role');
    expect(view.canFinalize).toBe(false);
    expect(view.finalizeBlockedReason).toContain('where you are the KAM');

    const refused = await byKey('multi-role').put(`/api/v1/quotes/${qn}/terms/capital`, capital);
    expect(refused.statusCode, refused.body).toBe(403);
    expect(refused.headers['content-type']).toContain('application/problem+json');
    expect(refused.json<{ detail: string }>().detail).toContain('where you are the KAM');
    // An edit without confirming is refused too.
    expect(
      (
        await byKey('multi-role').put(`/api/v1/quotes/${qn}/terms/capital`, {
          termsMinSupply: 'x',
        })
      ).statusCode,
    ).toBe(403);
    expect((await quoteRow(qn)).termsFinalizedAt).toBeNull();

    // kam-owner (KAM only): no terms.finalize at all.
    expect(
      (await byKey('kam-owner').put(`/api/v1/quotes/${qn}/terms/capital`, capital)).statusCode,
    ).toBe(403);

    // The approver, who is neither the KAM nor the price approver: allowed.
    expect((await capitalView(qn, 'approver')).canFinalize).toBe(true);
    const confirmed = await byKey('approver').put(`/api/v1/quotes/${qn}/terms/capital`, capital);
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(detail(confirmed).commercial.terms.capital.finalizedAt).not.toBeNull();
  });

  it('the price approver may not edit or confirm them', async () => {
    const qn = await inFinalReview();
    const approverId = await idOf('approver');
    const q = await quoteRow(qn);
    await db.db
      .update(schema.pricingRecord)
      .set({ priceApprovedBy: approverId })
      .where(eq(schema.pricingRecord.quoteId, q.id));

    const view = await capitalView(qn, 'approver');
    expect(view.canFinalize).toBe(false);
    expect(view.finalizeBlockedReason).toContain('whose price you approved');
    const refused = await byKey('approver').put(`/api/v1/quotes/${qn}/terms/capital`, capital);
    expect(refused.statusCode, refused.body).toBe(403);
    expect((await quoteRow(qn)).termsFinalizedAt).toBeNull();

    // multi-role is an approver here (not the KAM, not the price approver): allowed.
    const ok2 = await byKey('multi-role').put(`/api/v1/quotes/${qn}/terms/capital`, capital);
    expect(ok2.statusCode, ok2.body).toBe(200);
  });
});
