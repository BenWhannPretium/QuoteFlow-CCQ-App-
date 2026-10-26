import { describe, expect, it } from 'vitest';

import {
  FabricApiError,
  FabricRestMirrorReader,
  fabricMirrorHealth,
  type FabricTableStatus,
} from './mirroring';
import { fakeCredential } from '../graph/testing';

const table = (name: string, status: string, latency: number | null = 5): FabricTableStatus => ({
  schema: 'public',
  table: name,
  status,
  processedRows: 10,
  lastSyncAt: '2026-10-26T12:00:00Z',
  latencySeconds: latency,
  errorCode: null,
});

describe('fabricMirrorHealth', () => {
  it('Running with every table replicating or snapshotting is healthy', () => {
    const h = fabricMirrorHealth('Running', [
      table('quote', 'Replicating', 12),
      table('audit_event', 'Snapshotting', null),
    ]);
    expect(h).toEqual({
      healthy: true,
      counts: {
        tables: 2,
        replicating: 1,
        snapshotting: 1,
        failed: 0,
        stopped: 0,
        maxLatencySeconds: 12,
      },
      error: null,
    });
  });

  it('a stopped mirror or a failed table is unhealthy, with a data-free reason', () => {
    expect(fabricMirrorHealth('Stopped', []).error).toBe('mirroring is Stopped');
    const h = fabricMirrorHealth('Running', [
      { ...table('quote', 'Failed'), errorCode: 'SchemaChanged' },
      table('customer', 'Replicating'),
    ]);
    expect(h.healthy).toBe(false);
    expect(h.counts.failed).toBe(1);
    expect(h.error).toBe('1 table(s) not replicating: quote Failed (SchemaChanged)');
  });
});

describe('FabricRestMirrorReader', () => {
  const calls: string[] = [];
  const reader = new FabricRestMirrorReader({
    credential: fakeCredential(),
    workspaceId: 'ws-1',
    mirroredDatabaseId: 'db-1',
    fetch: (url, init) => {
      calls.push(`${init.method} ${url}`);
      if (url.endsWith('/getMirroringStatus'))
        return Promise.resolve(Response.json({ status: 'Running' }));
      if (url.includes('continuationToken=next'))
        return Promise.resolve(
          Response.json({
            data: [
              { sourceSchemaName: 'public', sourceTableName: 'customer', status: 'Replicating' },
            ],
          }),
        );
      return Promise.resolve(
        Response.json({
          continuationToken: 'next',
          data: [
            {
              sourceSchemaName: 'public',
              sourceTableName: 'quote',
              status: 'Replicating',
              metrics: {
                processedRows: 7,
                lastSyncDateTime: '2026-10-26T12:00:00Z',
                lastSyncLatencyInSeconds: 30,
              },
            },
          ],
        }),
      );
    },
  });

  it('reads the mirror and every page of tables', async () => {
    expect(await reader.mirroringStatus()).toBe('Running');
    const tables = await reader.tablesStatus();
    expect(tables.map((t) => t.table)).toEqual(['quote', 'customer']);
    expect(tables[0]).toMatchObject({ processedRows: 7, latencySeconds: 30 });
    expect(calls[0]).toBe(
      'POST https://api.fabric.microsoft.com/v1/workspaces/ws-1/mirroredDatabases/db-1/getMirroringStatus',
    );
  });

  it('turns an error response into a FabricApiError with the Fabric error code', async () => {
    const failing = new FabricRestMirrorReader({
      credential: fakeCredential(),
      workspaceId: 'ws',
      mirroredDatabaseId: 'db',
      fetch: () => Promise.resolve(Response.json({ errorCode: 'ItemNotFound' }, { status: 404 })),
    });
    await expect(failing.mirroringStatus()).rejects.toEqual(
      new FabricApiError('ItemNotFound', 404),
    );
  });
});
