import { DEV_USER_HEADER } from '@ccq/contracts';
import type { DbClient } from '@ccq/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * DR-cross-cutting-03: a NUL character (`\u0000`) in text, search or a query parameter is refused with a
 * 400 problem ("contains an invalid character") on every route, never a 500.
 * DR-cross-cutting-08: a path parameter over the router's limit gets an RFC 9457 problem, not
 * Fastify's own body, and the long path is not echoed back.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  const fresh = await freshSfDatabase('dr_input');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url, RATE_LIMIT_MAX: '100000' }), { db });
  await app.ready();
}, 120_000);
afterAll(async () => {
  await app.close();
});

const send = (persona: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: { [DEV_USER_HEADER]: persona },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });

describe('DR-cross-cutting-03: NUL characters', () => {
  const NUL = '\u0000';
  it.each([
    ['kam', 'GET', '/api/v1/quotes?q=%00', undefined],
    ['kam', 'GET', '/api/v1/quotes/board?q=a%00b', undefined],
    ['kam', 'GET', '/api/v1/quotes/export.csv?q=%00', undefined],
    ['kam', 'GET', '/api/v1/quotes?stage=%00', undefined],
    ['admin', 'GET', '/api/v1/users?q=%00', undefined],
    ['leadership', 'GET', '/api/v1/analytics/pipeline?region=%00', undefined],
    ['kam', 'POST', '/api/v1/quotes/drafts', { data: { bidReference: `x${NUL}y` } }],
    ['kam', 'POST', '/api/v1/feedback', { category: 'bug', message: `broken${NUL}` }],
  ] as const)('%s %s %s → 400 problem', async (persona, method, url, body) => {
    const res = await send(persona, method, url, body);
    expect(res.statusCode, res.body).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({
      status: 400,
      code: 'invalid_character',
      errors: [{ message: 'Contains an invalid character' }],
    });
  });

  it('ordinary text with quotes, accents and emoji is untouched', async () => {
    const res = await send('kam', 'GET', `/api/v1/quotes?q=${encodeURIComponent("O'Conner é 😀")}`);
    expect(res.statusCode, res.body).toBe(200);
  });
});

describe('DR-cross-cutting-08: a very long path parameter', () => {
  it('answers a problem+json 414 without echoing the path', async () => {
    const long = 'a'.repeat(5000);
    const res = await send('kam', 'GET', `/api/v1/quotes/${long}`);
    expect(res.statusCode).toBe(414);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({
      status: 414,
      code: 'uri_too_long',
      detail: 'A value in the address is too long',
    });
    expect(res.body.length).toBeLessThan(600);
  });
});
