import { IntakeDraft, PROBLEM_CONTENT_TYPE } from '@ccq/contracts';
import type { DbClient } from '@ccq/db';
import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * Audit 2026-11-17 (A-07). Well-formed but impossible input used to pass the request schema (a
 * `YYYY-MM-DD` regex, an unbounded number, an unchecked id) and fail later as a 500: a RangeError in
 * the analytics window, Postgres 22008 (date out of range), 22P02 (not a uuid) or 22003 (numeric
 * overflow). Each is now refused at the door as a 400 problem+json that names the field.
 */

let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let draftId = '';

const expectValidationProblem = (res: LightMyRequestResponse, field: string) => {
  expect(res.statusCode, res.body).toBe(400);
  expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  const body = res.json<{ title: string; errors?: { path: string }[] }>();
  expect(body.title).toBe('Validation failed');
  expect((body.errors ?? []).map((e) => e.path).join(' ')).toContain(field);
};

beforeAll(async () => {
  const fresh = await freshSfDatabase('input_hardening');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url }), { db });
  await app.ready();
  const rows = await db.db.execute<{ id: string }>(sql`
    select s.sf_opportunity_id as id from sf_opportunity_snapshot s
    where not s.is_closed and s.account_id is not null
      and not exists (select 1 from quote q where q.sf_opportunity_id = s.sf_opportunity_id and q.status <> 'closed')
    order by s.sf_opportunity_id limit 1`);
  const created = await asRole(app, 'KAM').post('/api/v1/quotes/drafts', {
    data: { sfOpportunityId: rows[0]!.id },
  });
  expect(created.statusCode, created.body).toBe(201);
  draftId = IntakeDraft.parse(created.json()).id;
}, 120_000);

afterAll(async () => {
  await app.close();
});

describe('impossible calendar dates are a 400, never a 500', () => {
  it.each(['2026-13-45', '2026-11-31', '2026-02-30', '0000-00-00'])(
    'analytics: to=%s',
    async (day) => {
      const res = await asRole(app, 'Leadership').get(`/api/v1/analytics/pipeline?to=${day}`);
      expectValidationProblem(res, 'to');
    },
  );

  it('analytics: from is checked too, and a real date still works', async () => {
    const leader = asRole(app, 'Leadership');
    expectValidationProblem(await leader.get('/api/v1/analytics/pipeline?from=2026-00-10'), 'from');
    const ok = await leader.get('/api/v1/analytics/pipeline?from=2026-10-01&to=2026-11-17');
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it.each(['closeDateFrom', 'closeDateTo'])('quote list: %s', async (param) => {
    const kam = asRole(app, 'KAM');
    expectValidationProblem(await kam.get(`/api/v1/quotes?${param}=2026-13-45`), param);
    const ok = await kam.get(`/api/v1/quotes?${param}=2026-11-17`);
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it.each(['quoteNeededBy', 'productNeededBy'])('intake draft: %s', async (field) => {
    const kam = asRole(app, 'KAM');
    const bad = await kam.patch(`/api/v1/quotes/drafts/${draftId}`, {
      data: { [field]: '2026-11-31' },
    });
    expectValidationProblem(bad, field);
    const ok = await kam.patch(`/api/v1/quotes/drafts/${draftId}`, {
      data: { [field]: '2026-12-15' },
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });
});

describe('ids and numbers that the database would reject are a 400, never a 500', () => {
  it('analytics: kam must be user ids', async () => {
    const leader = asRole(app, 'Leadership');
    expectValidationProblem(await leader.get('/api/v1/analytics/pipeline?kam=abc'), 'kam');
    const ok = await leader.get(
      '/api/v1/analytics/pipeline?kam=00000000-0000-7000-8000-000000000001',
    );
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it.each([
    ['estAnnualRevenue', 1e15],
    ['estAnnualVolume', 1e19],
    ['heightMm', 1e12],
    ['gramWeightG', 1e12],
  ])('intake draft: %s beyond what the column holds', async (field, value) => {
    const kam = asRole(app, 'KAM');
    const bad = await kam.patch(`/api/v1/quotes/drafts/${draftId}`, { data: { [field]: value } });
    expectValidationProblem(bad, field);
  });

  it('intake draft: ordinary figures are still saved', async () => {
    const ok = await asRole(app, 'KAM').patch(`/api/v1/quotes/drafts/${draftId}`, {
      data: { estAnnualRevenue: 1_250_000.5, estAnnualVolume: 750_000, heightMm: 180.25 },
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });
});
