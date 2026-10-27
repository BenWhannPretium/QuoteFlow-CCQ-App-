import type { DbClient } from '@ccq/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * B-21: the rate limit is per signed-in user, not per client IP. Every request here comes from the
 * same IP (inject's 127.0.0.1), as a whole office behind one NAT would.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  const fresh = await freshSfDatabase('ratelimit');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url, RATE_LIMIT_MAX: '3' }), { db });
  await app.ready();
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('rate limit (B-21)', () => {
  it('one user over the limit gets 429; another user on the same IP is not affected', async () => {
    const kam = asRole(app, 'KAM', 'owner');
    for (let i = 0; i < 3; i++) expect((await kam.get('/api/v1/me')).statusCode).toBe(200);
    const limited = await kam.get('/api/v1/me');
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();

    expect((await asRole(app, 'Engineer').get('/api/v1/me')).statusCode).toBe(200);
  });

  it('public routes (except health, which App Service probes) are limited per IP', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await app.inject('/api/v1/auth/config')).statusCode);
    expect(codes.slice(0, 3).every((c) => c !== 429)).toBe(true);
    expect(codes[3]).toBe(429);
  });
});
