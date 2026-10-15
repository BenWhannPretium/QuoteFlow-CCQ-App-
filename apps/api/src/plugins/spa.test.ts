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
        WEB_DIST_DIR: dist,
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

  it('does not expose swagger docs in production', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.headers['content-type']).toContain('text/html'); // SPA fallback, not the spec
  });
});
