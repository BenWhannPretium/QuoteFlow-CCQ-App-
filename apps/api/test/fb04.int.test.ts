import { PublicConfigResponse, QuoteDetail, QuoteListResponse } from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import type { Role } from '@ccq/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * FB-04: the Salesforce link (F-076), the funding wording (F-022, V-055) and the strategic-fit
 * display (F-073) through the API. The override rule (F-065) is in overrides.int.test.ts.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
const as = (role: Role) => asRole(app, role);
const WHY = 'FB-04 test: set the Salesforce instance URL';

beforeAll(async () => {
  const fresh = await freshSfDatabase('fb04');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url }), { db });
  await app.ready();
}, 120_000);
afterAll(async () => {
  await app.close();
});

const anyQuote = async () => {
  const list = QuoteListResponse.parse(
    (await as('SalesLeader').get('/api/v1/quotes?pageSize=5')).json(),
  );
  return list.items[0]!;
};
const detail = async (qn: string, role: Role = 'SalesLeader') => {
  const res = await as(role).get(`/api/v1/quotes/${qn}`);
  expect(res.statusCode, res.body).toBe(200);
  return QuoteDetail.parse(res.json());
};
const setInstanceUrl = async (value: unknown) => {
  const s = (
    await db.db
      .select()
      .from(schema.appSetting)
      .where(eq(schema.appSetting.key, 'salesforce_instance_url'))
  )[0]!;
  return as('Admin').patch('/api/v1/admin/config/settings/salesforce_instance_url', {
    version: s.version,
    changeReason: WHY,
    value,
  });
};

describe('F-076: the Salesforce link', () => {
  it('is seeded empty, so the quote has no link and the plain id is shown', async () => {
    const q = await anyQuote();
    const d = await detail(q.quoteNumber);
    expect(d.sfOpportunityUrl).toBeNull();
    expect(d.sfOpportunityId).toBe(q.sfOpportunityId);
  });

  it('refuses a URL that is not https, and accepts an https instance (the trailing path is dropped)', async () => {
    for (const value of ['http://pretium.lightning.force.com', 'not a url', 42]) {
      expect((await setInstanceUrl(value)).statusCode, JSON.stringify(value)).toBe(422);
    }
    const ok = await setInstanceUrl('https://pretium.lightning.force.com/');
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it.each([
    'KAM',
    'SalesLeader',
    'EngLead',
    'Engineer',
    'Pricing',
    'PricingLead',
    'Approver',
    'Leadership',
    'Admin',
  ] as Role[])('%s sees "Open in Salesforce" on a quote they can read', async (role) => {
    const q = await anyQuote();
    const res = await as(role).get(`/api/v1/quotes/${q.quoteNumber}`);
    if (res.statusCode === 200) {
      expect(QuoteDetail.parse(res.json()).sfOpportunityUrl).toBe(
        `https://pretium.lightning.force.com/lightning/r/Opportunity/${q.sfOpportunityId}/view`,
      );
    } else {
      // Data scope (RLS) hides the quote from this persona: the link must not leak either.
      expect([403, 404]).toContain(res.statusCode);
    }
  });

  it('only an Admin can change the instance URL', async () => {
    const s = (
      await db.db
        .select()
        .from(schema.appSetting)
        .where(eq(schema.appSetting.key, 'salesforce_instance_url'))
    )[0]!;
    for (const role of [
      'KAM',
      'SalesLeader',
      'EngLead',
      'Engineer',
      'Pricing',
      'PricingLead',
      'Approver',
      'Leadership',
    ] as Role[]) {
      const res = await as(role).patch('/api/v1/admin/config/settings/salesforce_instance_url', {
        version: s.version,
        changeReason: WHY,
        value: 'https://evil.example.com',
      });
      expect(res.statusCode, role).toBe(403);
    }
  });

  it('names the Salesforce stage for each G5 outcome (the reminder text)', async () => {
    const q = await anyQuote();
    const d = await detail(q.quoteNumber);
    expect(d.customerDecision.sfStageByOutcome).toMatchObject({
      awarded: 'Verbal Award',
      lost: 'Closed Lost',
      expired: 'Closed Lost',
      negotiating: 'Negotiating',
      requote: 'Quoting',
    });
  });
});

describe('F-073: strategic fit is shown as provisional while its map is empty', () => {
  it('the priority breakdown carries the market and flags the neutral default', async () => {
    const q = await anyQuote();
    const d = await detail(q.quoteNumber);
    const fit = d.priority.breakdown.find((b) => b.key === 'strategic_fit');
    expect(fit).toBeDefined();
    if (fit && !fit.unknown) {
      expect(fit.points).toBe(50);
      expect(fit.provisional).toBe(true);
      expect(fit.raw).toBe(d.market);
    }
  });
});

describe('F-022 / V-055: the funding options', () => {
  it('serves $0 CER with its definition and the provisional Shared option', async () => {
    const cfg = PublicConfigResponse.parse((await as('KAM').get('/api/v1/config/public')).json());
    const list = cfg.valueLists.tooling_funding_model!;
    expect(list.map((v) => v.code)).toEqual([
      'COMPANY_FUNDED',
      'CUSTOMER_FUNDED',
      'ZERO_CER',
      'AMORTIZED',
      'SHARED',
    ]);
    const zero = list.find((v) => v.code === 'ZERO_CER')!;
    expect(zero.label).toBe('$0 CER (customer-reimbursed capital)');
    expect(zero.meta.helpText).toMatch(
      /reimbursed by the customer as a lump sum or through amortization/,
    );
    expect(zero.meta.helpText).toMatch(/mold PO/);
    const shared = list.find((v) => v.code === 'SHARED')!;
    expect(shared.label).toBe('Shared (company and customer)');
    expect(shared.meta.helpText).toMatch(/D-003/);
  });
});
