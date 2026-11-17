import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../app';
import { fakeDb, testConfig } from '../test-utils';

describe('production SPA serving', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    const dist = mkdtempSync(join(tmpdir(), 'ccq-web-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root">spa</div>');
    app = await buildApp(
      testConfig({
        NODE_ENV: 'production',
        AUTH_MODE: 'entra',
        ENTRA_TENANT_ID: 'tenant',
        ENTRA_API_AUDIENCE: 'api://ccq',
        ENTRA_SPA_CLIENT_ID: 'spa-client',
        WEB_DIST_DIR: dist,
        FILESTORE_MODE: 'sharepoint',
        SP_SITE_ID: 'site',
        SP_DRIVE_ID: 'drive',
        MAIL_MODE: 'graph',
        RATE_LIMIT_MAX: '2',
      }),
      { db: fakeDb() },
    );
  });
  afterAll(() => app.close());

  it('serves index.html at /', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('spa');
  });

  it('falls back to index.html for client routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/quotes/123' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('keeps problem+json 404s for unknown API routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('does not count SPA files against the rate limit (RATE_LIMIT_MAX is 2 here)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (await app.inject({ method: 'GET', url: i % 2 ? '/' : '/quotes/1' })).statusCode,
      );
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
  });

  it('limits a public API route per client address, whatever source port the front end reports', async () => {
    // One caller, three connections: App Service can append `address:port` to X-Forwarded-For.
    const statuses: number[] = [];
    for (const port of [50001, 50002, 50003]) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/config',
        headers: { 'x-forwarded-for': `203.0.113.9:${port}` },
      });
      statuses.push(res.statusCode);
    }
    expect(statuses).toEqual([200, 200, 429]);
    // Another caller is unaffected.
    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/config',
      headers: { 'x-forwarded-for': '198.51.100.7:50001' },
    });
    expect(other.statusCode).toBe(200);
  });

  it('does not expose swagger docs in production', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.headers['content-type']).toContain('text/html'); // SPA fallback, not the spec
  });
});
