import { HealthResponse } from '@ccq/contracts';
import { createDb } from '@ccq/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://ccq:ccq@localhost:5432/ccq_test';

describe('GET /api/v1/health (real Postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp(testConfig({ DATABASE_URL: url }), { db: createDb(url) });
  });
  afterAll(async () => {
    await app.close();
  });

  it('reports db up', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(HealthResponse.parse(res.json())).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('migrations have been applied to ccq_test', async () => {
    const db = createDb(url);
    try {
      const rows = await db.sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
      expect(rows[0]?.n).toBeGreaterThanOrEqual(1);
    } finally {
      await db.close();
    }
  });
});

describe('GET /api/v1/health (unreachable Postgres)', () => {
  it('reports db down with 503', async () => {
    const down = 'postgres://ccq:ccq@127.0.0.1:1/none';
    const app = await buildApp(testConfig({ DATABASE_URL: down }), {
      db: createDb(down, { connectTimeoutSeconds: 1 }),
    });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ db: 'down' });
    } finally {
      await app.close();
    }
  });
});
