import { HealthResponse, PROBLEM_CONTENT_TYPE } from '@ccq/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from './app';
import { fakeDb, testConfig } from './test-utils';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('app', () => {
  it('GET /api/v1/health reports db up', async () => {
    app = await buildApp(testConfig(), { db: fakeDb(true) });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = HealthResponse.parse(res.json());
    expect(body).toMatchObject({ status: 'ok', db: 'up', version: 'test-sha' });
  });

  it('GET /api/v1/health returns 503 when db is down', async () => {
    app = await buildApp(testConfig(), { db: fakeDb(false) });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', db: 'down' });
  });

  it('unknown routes return RFC 9457 problem+json', async () => {
    app = await buildApp(testConfig(), { db: fakeDb() });
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(res.json()).toMatchObject({ type: 'about:blank', title: 'Not Found', status: 404 });
  });

  it('500s are problem+json without leaking internals', async () => {
    app = await buildApp(testConfig(), { db: fakeDb() });
    app.get('/boom', { config: { public: true } }, () => {
      throw new Error('secret internal detail');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret internal detail');
    expect(res.json()).toMatchObject({ status: 500, title: 'Internal Server Error' });
  });

  it('sets security headers', async () => {
    app = await buildApp(testConfig(), { db: fakeDb() });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('exposes OpenAPI docs outside production', async () => {
    app = await buildApp(testConfig(), { db: fakeDb() });
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ paths: Record<string, unknown> }>().paths).toHaveProperty('/api/v1/health');
  });
});
