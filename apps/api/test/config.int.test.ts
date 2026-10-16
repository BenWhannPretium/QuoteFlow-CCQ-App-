import { PublicConfigResponse } from '@ccq/contracts';
import { createDb, type DbClient } from '@ccq/db';
import { seedConfig } from '@ccq/db/seeds';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://ccq:ccq@localhost:5432/ccq_test';
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  db = createDb(url);
  await db.db.transaction((tx) => seedConfig(tx)); // idempotent
  app = await buildApp(testConfig({ DATABASE_URL: url }), { db });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('GET /api/v1/config/public', () => {
  it('returns the seeded labels, lists and UI settings', async () => {
    const res = await asRole(app, 'KAM').get('/api/v1/config/public');
    expect(res.statusCode, res.body).toBe(200);
    const body = PublicConfigResponse.parse(res.json());

    // Hybrid workflow, in board order, with labels from the table rather than code.
    expect(body.stages[0]?.key).toBe('INTAKE');
    expect(body.stages.map((s) => s.sort)).toEqual(body.stages.map((_, i) => i));
    expect(body.stages.every((s) => s.label.length > 0)).toBe(true);
    const stageKeys = new Set(body.stages.map((s) => s.key));
    expect(body.gates.every((g) => stageKeys.has(g.stageKey))).toBe(true);
    expect(body.outcomes.length).toBeGreaterThan(0);

    expect(body.reasonCodes.length).toBeGreaterThan(0);
    expect(Object.keys(body.valueLists)).toEqual(expect.arrayContaining(['resin', 'plant']));
    expect(body.tiers.map((t) => [t.tier, t.label])).toEqual([
      ['CRITICAL', 'Critical'],
      ['HIGH', 'High'],
      ['STANDARD', 'Standard'],
      ['LOW', 'Low'],
    ]);
  });

  it('exposes only the allow-listed settings', async () => {
    const res = await asRole(app, 'Engineer').get('/api/v1/config/public');
    const { settings } = PublicConfigResponse.parse(res.json());
    expect(settings).toHaveProperty('g1_enabled');
    expect(settings).toHaveProperty('validity_days_default');
    expect(settings).not.toHaveProperty('default_scope_type');
  });

  it('omits inactive reason codes', async () => {
    await db.sql`update reason_code set active = false where code = (select code from reason_code order by context, sort limit 1)`;
    try {
      const res = await asRole(app, 'Pricing').get('/api/v1/config/public');
      const body = PublicConfigResponse.parse(res.json());
      const [inactive] = await db.sql<{ context: string; code: string }[]>`
        select context, code from reason_code where active = false limit 1`;
      expect(inactive).toBeDefined();
      expect(
        body.reasonCodes.some((r) => r.context === inactive!.context && r.code === inactive!.code),
      ).toBe(false);
    } finally {
      await db.sql`update reason_code set active = true`;
    }
  });
});
