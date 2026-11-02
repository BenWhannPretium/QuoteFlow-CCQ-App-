import { HealthResponse, PROBLEM_CONTENT_TYPE } from '@ccq/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp, mailGuardFor } from './app';
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

describe('mailGuardFor (test mail guard)', () => {
  const graph = { MAIL_MODE: 'graph' };
  const entra = {
    ENTRA_TENANT_ID: '00000000-0000-0000-0000-000000000000',
    ENTRA_API_AUDIENCE: 'api://quoteflow',
    ENTRA_SPA_CLIENT_ID: '11111111-1111-1111-1111-111111111111',
    FILESTORE_MODE: 'blob',
    BLOB_ACCOUNT_URL: 'https://x.blob.core.windows.net',
    BLOB_CONTAINER: 'c',
  };

  it('guards Graph mail in test with the allowlist and redirect', () => {
    expect(
      mailGuardFor(
        testConfig({
          ...graph,
          APP_ENVIRONMENT: 'test',
          MAIL_ALLOWLIST: ' Ben@pretiumpkg.com, uat1@pretiumpkg.com ,',
          MAIL_REDIRECT_TO: 'ccq-test@pretiumpkg.com',
        }),
      ),
    ).toEqual({
      label: 'TEST',
      allow: ['ben@pretiumpkg.com', 'uat1@pretiumpkg.com'],
      redirectTo: 'ccq-test@pretiumpkg.com',
    });
  });

  it('fails safe: Graph mail with no APP_ENVIRONMENT in production is guarded, nothing allowed', () => {
    const config = testConfig({ ...graph, NODE_ENV: 'production', AUTH_MODE: 'entra', ...entra });
    expect(mailGuardFor(config)).toEqual({ label: 'NOT PROD', allow: [] });
  });

  it('is off in prod, and for smtp and fake mail', () => {
    expect(
      mailGuardFor(testConfig({ ...graph, ...entra, AUTH_MODE: 'entra', APP_ENVIRONMENT: 'prod' })),
    ).toBeNull();
    expect(mailGuardFor(testConfig({ MAIL_MODE: 'smtp', APP_ENVIRONMENT: 'test' }))).toBeNull();
    expect(mailGuardFor(testConfig({ APP_ENVIRONMENT: 'test' }))).toBeNull();
  });
});
