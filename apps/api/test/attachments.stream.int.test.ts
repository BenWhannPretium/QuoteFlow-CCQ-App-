import { mkdtemp, rm, stat } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { AttachmentUploadResponse, DEV_USER_HEADER } from '@ccq/contracts';
import type { DbClient } from '@ccq/db';
import {
  GraphClient,
  MockGraphDrive,
  SharePointFileStore,
  fakeCredential,
  type FileStore,
} from '@ccq/integrations';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { personaFor } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

const MB = 1024 * 1024;
const SIZE = 50 * MB;

let db: DbClient;
let shared: DbClient;
let dbUrl = '';
let root = '';
let quoteNumber = '';

beforeAll(async () => {
  const fresh = await freshSfDatabase('attachments_stream');
  db = fresh.client;
  shared = { ...db, close: () => Promise.resolve() };
  dbUrl = fresh.url;
  root = await mkdtemp(join(tmpdir(), 'ccq-stream-'));
  const [row] = await db.db.execute<{ quote_number: string }>(
    sql`select quote_number from quote where status <> 'closed' order by quote_number limit 1`,
  );
  quoteNumber = row!.quote_number;
}, 120_000);
afterAll(async () => {
  await db.close();
  await rm(root, { recursive: true, force: true });
});

/** A 50 MB multipart body generated on the fly: one reused 64 KB buffer, nothing accumulated. */
function body(boundary: string): AsyncIterable<Uint8Array> {
  const piece = Buffer.alloc(64 * 1024, 0x20);
  return (async function* () {
    yield Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nspec\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n${SIZE}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.pdf"\r\n` +
        'Content-Type: application/pdf\r\n\r\n',
    );
    const header = Buffer.from('%PDF-1.7\n');
    yield header;
    let sent = header.length;
    while (sent < SIZE) {
      const n = Math.min(piece.length, SIZE - sent);
      // A fresh buffer per piece, as a socket delivers them.
      yield Buffer.from(piece.subarray(0, n));
      sent += n;
    }
    yield Buffer.from(`\r\n--${boundary}--\r\n`);
  })();
}

async function uploadMeasured(fileStore?: FileStore) {
  const app = await buildApp(
    testConfig({ DATABASE_URL: dbUrl, FILESTORE_LOCAL_DIR: root, LOG_LEVEL: 'silent' }),
    { db: shared, ...(fileStore ? { fileStore } : {}) },
  );
  await app.listen({ port: 0, host: '127.0.0.1' });
  try {
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const boundary = '----ccqstream';
    const gc = (globalThis as { gc?: () => void }).gc;
    gc?.();
    const baseline = process.memoryUsage().rss;
    let peak = baseline;
    let ticks = 0;
    const sampler = setInterval(() => {
      // Collect now and then, so RSS measures what is still referenced, not garbage awaiting GC.
      if (gc && ++ticks % 5 === 0) gc();
      peak = Math.max(peak, process.memoryUsage().rss);
    }, 10);
    // node:http with pipeline, not fetch: fetch pulls an async-iterable body ahead of the socket
    // (measured: ~the whole file), which would charge the client's buffering to the server.
    const res = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: `/api/v1/quotes/${quoteNumber}/attachments`,
          headers: {
            [DEV_USER_HEADER]: personaFor('KAM'),
            'content-type': `multipart/form-data; boundary=${boundary}`,
          },
        },
        (r) => {
          let text = '';
          r.setEncoding('utf8');
          r.on('data', (c: string) => (text += c));
          r.on('end', () => resolve({ status: r.statusCode ?? 0, text }));
        },
      );
      pipeline(Readable.from(body(boundary)), req).catch(reject);
    });
    const json: unknown = JSON.parse(res.text);
    clearInterval(sampler);
    peak = Math.max(peak, process.memoryUsage().rss);
    return { status: res.status, json, growth: peak - baseline };
  } finally {
    await app.close();
  }
}

describe('uploads stream (never buffered)', () => {
  it('a 50 MB upload to the local store grows RSS by < 50 MB and lands intact', async () => {
    const { status, json, growth } = await uploadMeasured();
    expect(status, JSON.stringify(json)).toBe(201);
    const item = AttachmentUploadResponse.parse(json).item;
    expect(item.size).toBe(SIZE);
    expect((await stat(join(root, 'CCQ', quoteNumber, 'big.pdf'))).size).toBe(SIZE);
    expect(growth, `RSS grew ${(growth / MB).toFixed(1)} MB`).toBeLessThan(50 * MB);
  }, 120_000);

  it('a 50 MB upload to SharePoint goes in 5 MB ranges and grows RSS by < 50 MB', async () => {
    const drive = new MockGraphDrive(); // keeps a hash, not the bytes
    const store = new SharePointFileStore(
      new GraphClient({ credential: fakeCredential(), fetch: drive.fetch }),
      { driveId: drive.driveId },
    );
    const { status, json, growth } = await uploadMeasured(store);
    expect(status, JSON.stringify(json)).toBe(201);
    expect(AttachmentUploadResponse.parse(json).item.size).toBe(SIZE);
    expect(drive.requests.filter((r) => r.method === 'PUT')).toHaveLength(10);
    expect(growth, `RSS grew ${(growth / MB).toFixed(1)} MB`).toBeLessThan(50 * MB);
  }, 120_000);
});
