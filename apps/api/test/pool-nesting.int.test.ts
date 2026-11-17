import { IntakeDraft } from '@ccq/contracts';
import type { DbClient } from '@ccq/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * Audit 2026-11-17 (A-01). Every intake draft response reads the opportunity's other active quotes in the
 * system context (FB-19, W13-33). That read used to take a SECOND connection from the request pool while
 * the request's own transaction still held one. With as many requests in flight as the pool has
 * connections, every one of them held a connection and waited for another: nothing could finish, nothing
 * timed out, and the health probe queued behind them. These tests fire more draft requests at once than
 * the pool has connections and require every one of them to answer.
 */

let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let draftId = '';

/** More than the request pool (10), so the old code could not make progress. */
const PARALLEL = 24;

const within = <T>(ms: number, work: Promise<T>): Promise<T | 'timed-out'> =>
  Promise.race([
    work,
    new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), ms).unref()),
  ]);

beforeAll(async () => {
  const fresh = await freshSfDatabase('pool_nesting');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url }), { db });
  await app.ready();
  const rows = await db.db.execute<{ id: string }>(sql`
    select s.sf_opportunity_id as id from sf_opportunity_snapshot s
    where not s.is_closed and s.account_id is not null
      and not exists (select 1 from quote q where q.sf_opportunity_id = s.sf_opportunity_id and q.status <> 'closed')
    order by s.sf_opportunity_id limit 1`);
  const sfOpportunityId = rows[0]?.id;
  expect(sfOpportunityId).toBeTruthy();
  const created = await asRole(app, 'KAM').post('/api/v1/quotes/drafts', {
    data: { sfOpportunityId },
  });
  expect(created.statusCode, created.body).toBe(201);
  draftId = IntakeDraft.parse(created.json()).id;
}, 120_000);

afterAll(async () => {
  await app.close();
});

describe('intake drafts under more parallel requests than the pool has connections', () => {
  it(`answers ${PARALLEL} draft reads fired at once`, async () => {
    const kam = asRole(app, 'KAM');
    const all = Promise.all(
      Array.from({ length: PARALLEL }, () => kam.get(`/api/v1/quotes/drafts/${draftId}`)),
    );
    const result = await within(10_000, all);
    expect(result, 'the requests starved each other of connections').not.toBe('timed-out');
    if (result === 'timed-out') return;
    expect(result.map((r) => r.statusCode)).toEqual(Array.from({ length: PARALLEL }, () => 200));
  }, 20_000);

  it(`answers ${PARALLEL} autosaves fired at once, and health stays reachable`, async () => {
    const kam = asRole(app, 'KAM');
    const saves = Promise.all(
      Array.from({ length: PARALLEL }, (_, i) =>
        kam.patch(`/api/v1/quotes/drafts/${draftId}`, { data: { containerSize: `${i} oz` } }),
      ),
    );
    const health = app.inject({ method: 'GET', url: '/api/v1/health' });
    const result = await within(15_000, Promise.all([saves, health]));
    expect(result, 'the requests starved each other of connections').not.toBe('timed-out');
    if (result === 'timed-out') return;
    const [saved, healthRes] = result;
    // Autosaves of one draft run one after the other (row lock); each must answer, none with a 5xx.
    expect(saved.filter((r) => r.statusCode >= 500).map((r) => r.body)).toEqual([]);
    expect(healthRes.statusCode).toBe(200);
  }, 30_000);
});
