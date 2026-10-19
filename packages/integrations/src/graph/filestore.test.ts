import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterAll, describe, expect, it } from 'vitest';

import { BlobFileStore, contentDisposition } from './blob';
import { GraphClient } from './client';
import { describeFileStoreContract, streamOf } from './contract';
import { FileStoreError } from './filestore';
import { LocalFileStore } from './local';
import { numberedName, splitPath } from './paths';
import { SharePointFileStore, GRAPH_CHUNK_BYTES } from './sharepoint';
import { exactChunks } from './stream';
import { MemoryBlobContainer, MockGraphDrive, fakeCredential } from './testing';

const tmpRoots: string[] = [];
afterAll(async () => {
  await Promise.all(tmpRoots.map((r) => rm(r, { recursive: true, force: true })));
});

async function localSubject() {
  const root = await mkdtemp(join(tmpdir(), 'ccq-files-'));
  tmpRoots.push(root);
  const store = new LocalFileStore({
    root,
    downloadUrl: (id, name, exp) =>
      `/api/v1/files/local?i=${encodeURIComponent(id)}&n=${encodeURIComponent(name)}&e=${exp.getTime()}`,
  });
  return { store, readBack: (id: string) => readFile(join(root, id)) };
}

/** 320 KiB chunks in the contract tests, so a 1.4 MB file takes several ranges. */
function sharePointSubject(drive = new MockGraphDrive({ keepBytes: true, pageSize: 2 })) {
  const graph = new GraphClient({
    credential: fakeCredential(),
    fetch: drive.fetch,
    sleep: () => Promise.resolve(),
  });
  const store = new SharePointFileStore(graph, { driveId: drive.driveId, chunkBytes: 320 * 1024 });
  return { store, drive, readBack: (id: string) => Promise.resolve(drive.content(id)!) };
}

function blobSubject() {
  const container = new MemoryBlobContainer();
  return {
    store: new BlobFileStore(container),
    container,
    readBack: (id: string) => Promise.resolve(container.blobs.get(id)!.bytes),
  };
}

describeFileStoreContract('LocalFileStore', localSubject);
describeFileStoreContract('SharePointFileStore (mock Graph)', () =>
  Promise.resolve(sharePointSubject()),
);
describeFileStoreContract('BlobFileStore (memory container)', () => Promise.resolve(blobSubject()));

describe('SharePointFileStore specifics', () => {
  it('uses 5 MiB ranges (16 × 320 KiB) with a constant total, and no bearer on the upload URL', async () => {
    expect(GRAPH_CHUNK_BYTES).toBe(5 * 1024 * 1024);
    const drive = new MockGraphDrive();
    const graph = new GraphClient({ credential: fakeCredential(), fetch: drive.fetch });
    const store = new SharePointFileStore(graph, { driveId: drive.driveId });
    const size = 12 * 1024 * 1024 + 123;
    await store.upload(
      'CCQ/CCQ-2026-00009/big.dwg',
      streamOf(Buffer.alloc(size, 7), 65_536),
      size,
      'x',
    );
    const puts = drive.requests.filter((r) => r.method === 'PUT');
    expect(puts.map((r) => r.contentRange)).toEqual([
      `bytes 0-5242879/${size}`,
      `bytes 5242880-10485759/${size}`,
      `bytes 10485760-${size - 1}/${size}`,
    ]);
    expect(puts.every((r) => !r.auth)).toBe(true);
    // Everything else carried the token.
    expect(drive.requests.filter((r) => r.method !== 'PUT').every((r) => r.auth)).toBe(true);
  });

  it('abandons the upload session when the stream fails', async () => {
    const { store, drive } = sharePointSubject();
    const broken = new Readable({
      read() {
        this.push(Buffer.alloc(400 * 1024));
        this.destroy(new Error('client went away'));
      },
    });
    await expect(
      store.upload('CCQ/CCQ-2026-00001/a.pdf', broken, 1_000_000, 'x'),
    ).rejects.toThrow();
    expect(drive.sessions.size).toBe(0);
    expect(drive.requests.some((r) => r.method === 'DELETE')).toBe(true);
  });

  it('retries throttling and 5xx (Retry-After), then maps errors to codes', async () => {
    const { store, drive } = sharePointSubject();
    const slept: number[] = [];
    const graph = new GraphClient({
      credential: fakeCredential(),
      fetch: drive.fetch,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
    });
    const retrying = new SharePointFileStore(graph, { driveId: drive.driveId });
    drive.failures.push({ match: (m) => m === 'GET', status: 429, times: 2 });
    expect(await retrying.list('CCQ')).toEqual([]);
    expect(slept).toHaveLength(2);

    drive.failures.push({ match: () => true, status: 503, times: 10 });
    await expect(store.list('CCQ')).rejects.toMatchObject({ code: 'UNAVAILABLE', status: 503 });
    drive.failures = [{ match: () => true, status: 403, times: 1 }];
    await expect(store.list('CCQ')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('pages through large folders and tolerates a folder created concurrently (409)', async () => {
    const { store } = sharePointSubject();
    for (const n of ['a', 'b', 'c', 'd', 'e']) {
      await store.upload(`CCQ/X/${n}.pdf`, streamOf(Buffer.from(n)), 1, 'x');
    }
    expect((await store.list('CCQ/X')).map((f) => f.name)).toEqual([
      'a.pdf',
      'b.pdf',
      'c.pdf',
      'd.pdf',
      'e.pdf',
    ]);
    // A fresh store (empty folder cache) racing an existing folder.
    const again = new SharePointFileStore(
      new GraphClient({ credential: fakeCredential(), fetch: sharePointSubject().drive.fetch }),
      { driveId: 'b!mock-drive' },
    );
    await again.ensureFolder('CCQ/Y');
    await again.ensureFolder('CCQ/Y/Z');
  });

  it('returns the web URL and Graph download URL', async () => {
    const { store } = sharePointSubject();
    const f = await store.upload('CCQ/CCQ-2026-00001/a b.pdf', streamOf(Buffer.from('1')), 1, 'x');
    expect(f.webUrl).toContain('CCQ-2026-00001/a%20b.pdf');
    expect((await store.getDownloadUrl(f.itemId, { fileName: 'x' })).url).toContain(
      'download.mock',
    );
  });

  it('refuses chunk sizes Graph would reject', () => {
    const graph = new GraphClient({ credential: fakeCredential() });
    expect(() => new SharePointFileStore(graph, { driveId: 'd', chunkBytes: 5_000_000 })).toThrow(
      /320 KiB/,
    );
  });

  it('a token failure is UNAVAILABLE without leaking the credential error', async () => {
    const graph = new GraphClient({
      credential: { getToken: () => Promise.reject(new Error('AADSTS7000215 secret=hunter2')) },
      fetch: new MockGraphDrive().fetch,
    });
    const err = await new SharePointFileStore(graph, { driveId: 'd' })
      .list('CCQ')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileStoreError);
    expect((err as Error).message).not.toContain('hunter2');
  });
});

describe('BlobFileStore specifics', () => {
  it('download links are read-only SAS URLs that name the file', async () => {
    const { store } = blobSubject();
    const f = await store.upload('CCQ/CCQ-2026-00001/a.pdf', streamOf(Buffer.from('1')), 1, 'x');
    const link = await store.getDownloadUrl(f.itemId, {
      fileName: 'Drawing A.pdf',
      mime: 'application/pdf',
    });
    expect(link.url).toContain('sp=r');
    expect(new URL(link.url).searchParams.get('rscd')).toContain('filename="Drawing A.pdf"');
    expect(link.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000);
  });

  it('content-disposition is safe for any name', () => {
    expect(contentDisposition('été "x".pdf')).toBe(
      `attachment; filename="_t_ _x_.pdf"; filename*=UTF-8''%C3%A9t%C3%A9%20%22x%22.pdf`,
    );
  });
});

describe('LocalFileStore specifics', () => {
  it('needs a download route to make links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccq-files-'));
    tmpRoots.push(root);
    const store = new LocalFileStore({ root });
    const f = await store.upload('CCQ/a/x.pdf', streamOf(Buffer.from('1')), 1, 'x');
    await expect(store.getDownloadUrl(f.itemId, { fileName: 'x' })).rejects.toMatchObject({
      code: 'FAILED',
    });
    const { stream } = await store.openRead(f.itemId);
    const parts: Buffer[] = [];
    for await (const p of stream as AsyncIterable<Buffer>) parts.push(p);
    expect(Buffer.concat(parts).toString()).toBe('1');
    await expect(store.openRead('CCQ/a/missing.pdf')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('helpers', () => {
  it('exactChunks re-chunks exactly and holds the size', async () => {
    const out: number[] = [];
    for await (const c of exactChunks(streamOf(Buffer.alloc(25), 3), 25, 10)) out.push(c.length);
    expect(out).toEqual([10, 10, 5]);
    const string = Readable.from(['ab', 'cd']);
    const s: string[] = [];
    for await (const c of exactChunks(string, 4, 3)) s.push(c.toString());
    expect(s).toEqual(['abc', 'd']);
  });

  it('numberedName / splitPath', () => {
    expect(numberedName('a.pdf', 2)).toBe('a (2).pdf');
    expect(numberedName('README', 1)).toBe('README (1)');
    expect(splitPath('/CCQ/x/a.pdf/')).toEqual({ folder: 'CCQ/x', name: 'a.pdf' });
  });
});
