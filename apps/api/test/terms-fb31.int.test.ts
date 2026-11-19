import {
  DEV_USER_HEADER,
  IntakeDraft,
  MeResponse,
  PublicConfigResponse,
  QuoteDetail,
  ReviewSummary,
  SfOpportunityDetail,
  SubmitIntakeResponse,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import type { Role } from '@ccq/domain';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { answerToolingCommitment, multipart, prepareModels } from './model-helpers';
import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * FB-31 (N19-07, N19-08, N19-10) through the API on a real Postgres:
 * - N19-07: who approves a non-standard payment term follows app_setting terms_exception_routes (a
 *   provisional guess): Net 45 the pricing lead, Net 60 and above Leadership with a supporting document.
 *   The tier is recorded on the request; the decision is enforced by it on the server; the requester is
 *   barred where the approver is not a role that enters terms.
 * - N19-08: four funding choices; $0 CER and Shared retired for new choices but still read; amortized
 *   needs a finance-review sign-off at Final Review before release.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-11-20T15:00:00Z');
const HOUR = 3_600_000;
const tick = (ms = HOUR) => {
  clock = new Date(clock.getTime() + ms);
};

/** Every role with a single-role persona (PostAward has none: its denial is in the domain test). */
const PERSONA: Partial<Record<Role, string>> = {
  KAM: 'kam',
  SalesLeader: 'sales-leader',
  EngLead: 'eng-lead',
  Engineer: 'engineer',
  ProductionScheduler: 'production-scheduler',
  Pricing: 'pricing',
  PricingLead: 'pricing-lead',
  Finance: 'finance',
  Approver: 'approver',
  Leadership: 'leadership',
  Admin: 'admin',
};
const PERSONA_ROLES = Object.keys(PERSONA) as Role[];

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
const decideException = (qn: string, by: Role, decision: 'approve' | 'reject', rationale: string) =>
  as(by).post(`/api/v1/quotes/${qn}/terms/exception/decision`, { decision, rationale });
const errorPaths = (res: { json: () => unknown }) =>
  ((res.json() as { errors?: { path?: string }[] }).errors ?? []).map((e) => e.path).sort();
const errorCodes = (res: { json: () => unknown }) =>
  ((res.json() as { errors?: { code?: string }[] }).errors ?? []).map((e) => e.code).sort();
const quoteRow = async (qn: string) =>
  (await db.db.select().from(schema.quote).where(eq(schema.quote.quoteNumber, qn)))[0]!;
const detail = (res: { json: () => unknown }) => QuoteDetail.parse(res.json());
const setSetting = (key: string, value: unknown) =>
  db.db.execute(
    sql`update app_setting set value = ${JSON.stringify(value)}::jsonb where key = ${key}`,
  );
const requests = async (qn: string) =>
  db.db
    .select()
    .from(schema.termsExceptionRequest)
    .where(eq(schema.termsExceptionRequest.quoteId, (await quoteRow(qn)).id))
    .orderBy(schema.termsExceptionRequest.requestedAt);

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]);
const uploadDocument = (qn: string, by = 'kam') => {
  const body = multipart(
    { kind: 'payment_terms_approval', size: String(PDF.length) },
    { name: 'cfo-approval.pdf', content: PDF },
  );
  return app.inject({
    method: 'POST',
    url: `/api/v1/quotes/${qn}/attachments`,
    headers: { [DEV_USER_HEADER]: by, 'content-type': body.contentType },
    payload: body.payload,
  });
};

async function submitted(extra: Record<string, unknown> = {}): Promise<string> {
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
      subMarket: 'FOOD_SNACKS',
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
      ...extra,
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
      prelimCapitalUsd: 0,
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
  const fresh = await freshSfDatabase('terms_fb31');
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
  for (const role of PERSONA_ROLES) await userId(role);
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('seeded config (provisional)', () => {
  it('terms_exception_routes, the senior grant, the funding list and the amortized sign-off', async () => {
    const [routes] = await db.db
      .select()
      .from(schema.appSetting)
      .where(eq(schema.appSetting.key, 'terms_exception_routes'));
    expect(routes).toMatchObject({
      provisional: true,
      value: [
        {
          codes: ['NET_45'],
          approverPermission: 'terms.exception.decide',
          documentRequired: false,
        },
        {
          codes: ['NET_60', 'NET_90', 'NET_120', 'OTHER'],
          approverPermission: 'terms.exception.decide.senior',
          approverLabel: 'Leadership',
          documentRequired: true,
        },
      ],
    });
    expect(routes!.description).toMatch(/PROVISIONAL GUESS, NOT POLICY/);
    const grants = await db.db
      .select()
      .from(schema.rolePermission)
      .where(eq(schema.rolePermission.permission, 'terms.exception.decide.senior'));
    expect(grants.map((g) => [g.role, g.provisional])).toEqual([['Leadership', true]]);
    const funding = await db.db
      .select()
      .from(schema.valueList)
      .where(eq(schema.valueList.listKey, 'tooling_funding_model'));
    const by = Object.fromEntries(funding.map((f) => [f.code, f]));
    expect(by.CUSTOMER_FUNDED).toMatchObject({ label: 'Customer funded (lump sum)', active: true });
    expect(by.AMORTIZED).toMatchObject({ label: 'Customer funded (amortized)', active: true });
    expect(by.AMORTIZED!.meta).toMatchObject({ requiresFinanceReview: true });
    expect(by.COMPANY_FUNDED).toMatchObject({ label: 'Pretium funded', active: true });
    expect(by.NOT_DISCUSSED).toMatchObject({ label: 'To be determined', active: true });
    expect(by.ZERO_CER!.active).toBe(false);
    expect(by.SHARED!.active).toBe(false);
    expect(funding.every((f) => f.provisional)).toBe(true);
  });

  it('the public config offers the four choices, labels the retired ones and exposes the routes', async () => {
    const cfg = PublicConfigResponse.parse((await as('KAM').get('/api/v1/config/public')).json());
    expect(cfg.valueLists.tooling_funding_model!.map((v) => v.code).sort()).toEqual([
      'AMORTIZED',
      'COMPANY_FUNDED',
      'CUSTOMER_FUNDED',
      'NOT_DISCUSSED',
    ]);
    expect(cfg.retiredValues?.tooling_funding_model).toMatchObject({
      ZERO_CER: '$0 CER (customer-reimbursed capital)',
      SHARED: 'Shared (company and customer)',
    });
    expect(Array.isArray(cfg.settings.terms_exception_routes)).toBe(true);
  });
});

describe('N19-07: a Net 60 exception goes to Leadership, with a document', () => {
  it('opens with the senior tier recorded and tells Leadership only', async () => {
    const qn = await inEngineering();
    const res = await as('KAM').put(`/api/v1/quotes/${qn}/terms`, {
      termsPaymentTermsCode: 'NET_60',
    });
    ok(res);
    expect(detail(res).commercial.terms.exception).toMatchObject({
      status: 'pending',
      paymentTermsCode: 'NET_60',
      approverLabel: 'Leadership',
      documentRequired: true,
      document: null,
      canDecide: false,
      canUploadDocument: true,
    });
    const [request] = await requests(qn);
    expect(request).toMatchObject({
      approverPermission: 'terms.exception.decide.senior',
      documentRequired: true,
      status: 'pending',
    });
    const told = await notified(qn, 'quote.terms_exception_requested');
    expect(told.map((n) => n.userId)).toEqual([ids.Leadership]);
    expect(told[0]!.body).toContain('Waiting for Leadership');
    expect(told[0]!.body).toContain('supporting document');
    // The timeline says who decides.
    const [event] = await db.db
      .select()
      .from(schema.activityEvent)
      .where(
        and(
          eq(schema.activityEvent.quoteId, (await quoteRow(qn)).id),
          eq(schema.activityEvent.type, 'terms_exception_requested'),
        ),
      );
    expect(event!.payload).toMatchObject({ approver: 'Leadership', documentRequired: true });
  });

  it('the pricing lead is refused with whose decision it is; Leadership approves only with the document', async () => {
    const qn = await inEngineering();
    ok(await as('KAM').put(`/api/v1/quotes/${qn}/terms`, { termsPaymentTermsCode: 'NET_90' }));

    const lead = await decideException(qn, 'PricingLead', 'approve', 'Fine by me');
    expect(lead.statusCode).toBe(403);
    expect(lead.json<{ detail: string }>().detail).toBe(
      'This payment-terms exception is decided by Leadership',
    );
    expect(
      detail(await as('PricingLead').get(`/api/v1/quotes/${qn}`)).commercial.terms.exception
        ?.canDecide,
    ).toBe(false);

    const view = detail(await as('Leadership').get(`/api/v1/quotes/${qn}`)).commercial.terms
      .exception!;
    expect(view).toMatchObject({ canDecide: true, canUploadDocument: false });
    expect(view.decideNote).toMatch(/Attach the supporting document/);

    const noDoc = await decideException(qn, 'Leadership', 'approve', 'Strategic account');
    expect(noDoc.statusCode).toBe(422);
    expect(errorPaths(noDoc)).toEqual(['/document']);
    expect(errorCodes(noDoc)).toEqual(['MISSING_FIELD']);

    // Leadership does not upload (no attachment.upload); the KAM does.
    expect((await uploadDocument(qn, 'leadership')).statusCode).toBe(403);
    ok(await uploadDocument(qn), 201);
    const withDoc = detail(await as('Leadership').get(`/api/v1/quotes/${qn}`)).commercial.terms
      .exception!;
    expect(withDoc.document).toMatchObject({ fileName: 'cfo-approval.pdf', version: 1 });
    expect(withDoc.decideNote).toBeNull();

    const approved = await decideException(qn, 'Leadership', 'approve', 'CFO memo attached');
    ok(approved);
    expect(detail(approved).commercial.terms.exception).toMatchObject({
      status: 'approved',
      approverLabel: 'Leadership',
    });
    expect(detail(approved).commercial.terms.exception?.decidedByName).toBeTruthy();
    const decided = (await notified(qn, 'quote.terms_exception_decided')).filter(
      (n) => n.userId === ids.KAM,
    );
    expect(decided).toHaveLength(1);
    const audit = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.quoteId, (await quoteRow(qn)).id),
          eq(schema.auditEvent.entity, 'terms_exception_request'),
          eq(schema.auditEvent.action, 'update'),
        ),
      );
    expect(audit[0]!.after).toMatchObject({
      status: 'approved',
      approverPermission: 'terms.exception.decide.senior',
    });
  });

  it('rejecting needs no document', async () => {
    const qn = await inEngineering();
    ok(await as('KAM').put(`/api/v1/quotes/${qn}/terms`, { termsPaymentTermsCode: 'NET_120' }));
    const rejected = await decideException(qn, 'Leadership', 'reject', 'Too long for this account');
    ok(rejected);
    expect(detail(rejected).commercial.terms.exception?.status).toBe('rejected');
  });

  it('allowed and denied for every role, on both tiers', async () => {
    // Net 45: the pricing lead's tier. Net 60: Leadership's. Every other role is refused on each.
    for (const [code, allowed] of [
      ['NET_45', 'PricingLead'],
      ['NET_60', 'Leadership'],
    ] as const) {
      const qn = await inEngineering();
      ok(await as('KAM').put(`/api/v1/quotes/${qn}/terms`, { termsPaymentTermsCode: code }));
      if (code === 'NET_60') ok(await uploadDocument(qn), 201);
      for (const role of PERSONA_ROLES.filter((r) => r !== allowed)) {
        const denied = await decideException(qn, role, 'approve', 'x');
        expect(denied.statusCode, `${code} ${role}: ${denied.body}`).toBe(403);
      }
      ok(await decideException(qn, allowed, 'approve', 'Agreed'));
    }
    // PostAward has no persona: the domain test (terms-routes.test.ts) checks every role in ROLES.
  });

  it('a requester who holds the senior permission may not decide their own request', async () => {
    const qn = await inEngineering();
    ok(await as('KAM').put(`/api/v1/quotes/${qn}/terms`, { termsPaymentTermsCode: 'NET_60' }));
    ok(await uploadDocument(qn), 201);
    // As if a Leadership member (who also enters terms in another role) had entered them.
    const [request] = await requests(qn);
    await db.db
      .update(schema.termsExceptionRequest)
      .set({ requestedBy: ids.Leadership })
      .where(eq(schema.termsExceptionRequest.id, request!.id));
    const view = detail(await as('Leadership').get(`/api/v1/quotes/${qn}`)).commercial.terms
      .exception!;
    expect(view.canDecide).toBe(false);
    expect(view.decideNote).toMatch(/You entered these payment terms/);
    const own = await decideException(qn, 'Leadership', 'approve', 'Mine');
    expect(own.statusCode).toBe(403);
  });
});

describe('N19-07: Net 45 behaves as before (the pricing lead, no document)', () => {
  it('opens for the pricing lead, who approves with a rationale only', async () => {
    const qn = await inEngineering();
    const res = await as('KAM').put(`/api/v1/quotes/${qn}/terms`, {
      termsPaymentTermsCode: 'NET_45',
    });
    ok(res);
    expect(detail(res).commercial.terms.exception).toMatchObject({
      approverLabel: 'the pricing lead',
      documentRequired: false,
    });
    const told = await notified(qn, 'quote.terms_exception_requested');
    expect(told.map((n) => n.userId)).toEqual([ids.PricingLead]);
    expect((await decideException(qn, 'Leadership', 'approve', 'x')).statusCode).toBe(403);
    ok(await decideException(qn, 'PricingLead', 'approve', 'Within our usual range'));
  });

  it('the pricing lead may decide a Net 45 request they entered (no bar on that tier)', async () => {
    const qn = await inEngineering();
    ok(
      await as('PricingLead').put(`/api/v1/quotes/${qn}/terms`, {
        termsPaymentTermsCode: 'NET_45',
      }),
    );
    ok(await decideException(qn, 'PricingLead', 'approve', 'Agreed with the customer'));
  });
});

describe('N19-07: a config change does not reroute an open request', () => {
  it('keeps the tier the request opened with; a new request follows the new config', async () => {
    const qn = await inEngineering();
    ok(await as('KAM').put(`/api/v1/quotes/${qn}/terms`, { termsPaymentTermsCode: 'NET_60' }));
    const [before] = await db.db
      .select()
      .from(schema.appSetting)
      .where(eq(schema.appSetting.key, 'terms_exception_routes'));
    // An Admin moves Net 60 to the pricing lead, without a document.
    await setSetting('terms_exception_routes', [
      {
        codes: ['NET_45', 'NET_60'],
        approverPermission: 'terms.exception.decide',
        approverLabel: 'the pricing lead',
        documentRequired: false,
      },
      {
        codes: ['NET_90', 'NET_120', 'OTHER'],
        approverPermission: 'terms.exception.decide.senior',
        approverLabel: 'Leadership',
        documentRequired: true,
      },
    ]);
    try {
      expect((await decideException(qn, 'PricingLead', 'approve', 'x')).statusCode).toBe(403);
      expect(
        detail(await as('KAM').get(`/api/v1/quotes/${qn}`)).commercial.terms.exception,
      ).toMatchObject({ approverLabel: 'Leadership', documentRequired: true });
      const next = await inEngineering();
      ok(await as('KAM').put(`/api/v1/quotes/${next}/terms`, { termsPaymentTermsCode: 'NET_60' }));
      expect((await requests(next))[0]).toMatchObject({
        approverPermission: 'terms.exception.decide',
        documentRequired: false,
      });
      ok(await decideException(next, 'PricingLead', 'approve', 'Moved to my tier'));
    } finally {
      await setSetting('terms_exception_routes', before!.value);
    }
  });

  it('the Admin console refuses a code that is not on the payment-terms list', async () => {
    const [row] = await db.db
      .select()
      .from(schema.appSetting)
      .where(eq(schema.appSetting.key, 'terms_exception_routes'));
    const res = await as('Admin').patch(`/api/v1/admin/config/settings/terms_exception_routes`, {
      version: row!.version,
      value: [
        {
          codes: ['NET_75'],
          approverPermission: 'terms.exception.decide',
          approverLabel: 'the pricing lead',
          documentRequired: false,
        },
      ],
      changeReason: 'FB-31 integration test',
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.body).toContain('NET_75');
    const bad = await as('Admin').patch(`/api/v1/admin/config/settings/terms_exception_routes`, {
      version: row!.version,
      value: [
        {
          codes: ['NET_45'],
          approverPermission: 'config.manage',
          approverLabel: 'x',
          documentRequired: false,
        },
      ],
      changeReason: 'FB-31 integration test',
    });
    expect(bad.statusCode, bad.body).toBe(422);
  });
});

describe('N19-08: funding', () => {
  it('a retired code is refused for a new choice; a quote that holds one still reads and saves', async () => {
    const qn = await inFinalReview();
    const refused = await as('EngLead').put(`/api/v1/quotes/${qn}/terms/engineering`, {
      toolingFundingModel: 'ZERO_CER',
    });
    expect(refused.statusCode).toBe(422);
    // An old quote holding $0 CER (set before FB-31).
    await db.db
      .update(schema.quote)
      .set({ toolingFundingModel: 'ZERO_CER' })
      .where(eq(schema.quote.quoteNumber, qn));
    const read = detail(await as('Approver').get(`/api/v1/quotes/${qn}`));
    expect(read.commercial.terms.toolingFundingModel).toBe('ZERO_CER');
    const review = ReviewSummary.parse(
      (await as('Approver').get(`/api/v1/quotes/${qn}/review-summary`)).json(),
    );
    expect(review.termsAndLegal.toolingFundingModelLabel).toBe(
      '$0 CER (customer-reimbursed capital)',
    );
    // Another term still saves (the retired code is checked only when it changes).
    ok(await as('EngLead').put(`/api/v1/quotes/${qn}/terms/engineering`, { termsMoq: '50k' }));
    ok(
      await as('Approver').put(`/api/v1/quotes/${qn}/terms/capital`, {
        termsMoldOwnership: 'CUSTOMER',
        termsAmortized: false,
        termsMinSupply: 'None',
        termsAgreementInPlace: false,
        finalized: true,
      }),
    );
  });

  it('amortized adds the finance review by Leadership and blocks release until it is given', async () => {
    const qn = await inFinalReview();
    ok(
      await as('EngLead').put(`/api/v1/quotes/${qn}/terms/engineering`, {
        toolingFundingModel: 'AMORTIZED',
      }),
    );
    ok(
      await as('Approver').put(`/api/v1/quotes/${qn}/terms/capital`, {
        termsMoldOwnership: 'PRETIUM',
        termsAmortized: true,
        termsAmortizationMonths: 36,
        termsMinSupply: 'None',
        termsAgreementInPlace: false,
        finalized: true,
      }),
    );
    await answerToolingCommitment(app, qn);
    const extra = detail(await as('Leadership').get(`/api/v1/quotes/${qn}`)).commercial
      .additionalApprovals;
    expect(extra.map((a) => [a.ruleKey, a.signoffKey, a.signoffLabel, a.canSign])).toEqual([
      ['amortized_finance_review', 'finance_review', 'Finance review (Leadership)', true],
    ]);
    const refused = await decide(qn, 'G4', { outcomeKey: 'approve' }, 'Approver');
    expect(refused.statusCode).toBe(422);
    expect(errorCodes(refused)).toContain('ADDITIONAL_APPROVAL_REQUIRED');
    // Finance and the sales leader cannot give it.
    for (const role of ['Finance', 'SalesLeader'] as Role[]) {
      const res = await as(role).post(`/api/v1/quotes/${qn}/final-review/signoffs`, {
        ruleKey: 'amortized_finance_review',
        signoffKey: 'finance_review',
      });
      expect(res.statusCode, role).toBe(403);
    }
    ok(
      await as('Leadership').post(`/api/v1/quotes/${qn}/final-review/signoffs`, {
        ruleKey: 'amortized_finance_review',
        signoffKey: 'finance_review',
      }),
    );
    ok(await decide(qn, 'G4', { outcomeKey: 'approve' }, 'Approver'), 201);
  });

  it('lump sum and Pretium funded need no extra sign-off', async () => {
    const qn = await inFinalReview();
    for (const code of ['CUSTOMER_FUNDED', 'COMPANY_FUNDED']) {
      ok(
        await as('EngLead').put(`/api/v1/quotes/${qn}/terms/engineering`, {
          toolingFundingModel: code,
        }),
      );
      expect(
        detail(await as('Leadership').get(`/api/v1/quotes/${qn}`)).commercial.additionalApprovals,
      ).toEqual([]);
    }
  });
});
