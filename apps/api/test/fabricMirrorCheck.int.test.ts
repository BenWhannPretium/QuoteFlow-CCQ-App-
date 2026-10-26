import { ADVISORY_LOCKS, schema, type DbClient } from '@ccq/db';
import { listIntegrationRuns } from '@ccq/db/repos';
import { FabricApiError, FakeFabricMirrorReader, type FabricTableStatus } from '@ccq/integrations';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freshSfDatabase } from './sf-helpers';
import { runFabricMirrorCheck, type FabricMirrorCheckDeps } from '../src/jobs/fabricMirrorCheck';

const { notification } = schema;
const quiet = { info: () => undefined, error: () => undefined };

const table = (name: string, status: string): FabricTableStatus => ({
  schema: 'public',
  table: name,
  status,
  processedRows: 1,
  lastSyncAt: null,
  latencySeconds: 20,
  errorCode: null,
});

let db: DbClient;
const reader = new FakeFabricMirrorReader();
const deps = (): FabricMirrorCheckDeps => ({
  database: db.db,
  sql: db.sql,
  reader,
  logger: quiet,
  now: () => new Date('2026-10-26T15:00:00Z'),
});
const alerts = async () =>
  (
    await db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notification)
      .where(eq(notification.type, 'integration.failed'))
  )[0]!.n;

beforeAll(async () => {
  db = (await freshSfDatabase('fabric')).client;
}, 120_000);
afterAll(async () => {
  await db.close();
});

describe('Fabric mirror health check (B-27)', () => {
  it('a running mirror writes a succeeded fabric run with the counts', async () => {
    reader.status = 'Running';
    reader.tables = [table('quote', 'Replicating'), table('customer', 'Replicating')];
    const result = await runFabricMirrorCheck(deps());
    expect(result).toMatchObject({ outcome: 'succeeded', error: null });
    const [run] = await listIntegrationRuns(db.db, { source: 'fabric', limit: 1 });
    expect(run).toMatchObject({ status: 'succeeded', error: null });
    expect(run!.counts).toMatchObject({ tables: 2, replicating: 2, maxLatencySeconds: 20 });
    expect(await alerts()).toBe(0);
  });

  it('alerts Admins once when the mirror becomes unhealthy, not every hour', async () => {
    reader.tables = [table('quote', 'Failed')];
    const first = await runFabricMirrorCheck(deps());
    expect(first.outcome).toBe('failed');
    const afterFirst = await alerts();
    expect(afterFirst).toBeGreaterThan(0);
    await runFabricMirrorCheck(deps());
    expect(await alerts()).toBe(afterFirst);
  });

  it('an API error is a failed run with the code, never a throw', async () => {
    const broken = {
      mode: 'live' as const,
      mirroringStatus: () => Promise.reject(new FabricApiError('Unauthorized', 401)),
      tablesStatus: () => Promise.resolve([]),
    };
    const result = await runFabricMirrorCheck({ ...deps(), reader: broken });
    expect(result).toMatchObject({
      outcome: 'failed',
      error: 'Fabric API unavailable (Unauthorized)',
    });
  });

  it('skips while another instance holds the lock', async () => {
    const holder = await db.sql.reserve();
    try {
      await holder`select pg_advisory_lock(${ADVISORY_LOCKS.fabricMirrorCheck.toString()}::bigint)`;
      expect((await runFabricMirrorCheck(deps())).outcome).toBe('skipped');
    } finally {
      await holder`select pg_advisory_unlock(${ADVISORY_LOCKS.fabricMirrorCheck.toString()}::bigint)`;
      holder.release();
    }
  });
});
