import type { TokenCredential } from '@azure/identity';
import { describe, expect, it } from 'vitest';

import { GraphClient, type FetchLike } from './client';
import { FileStoreError } from './filestore';

const credential: TokenCredential = {
  getToken: () => Promise.resolve({ token: 't', expiresOnTimestamp: Date.now() + 3_600_000 }),
};

/** A Graph that accepts the connection and never answers: only the abort signal ends the request. */
const hangs = (calls: { signals: (AbortSignal | null | undefined)[] }): FetchLike => {
  return (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      calls.signals.push(init.signal);
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
};

describe('GraphClient request timeout', () => {
  // Audit 2026-11-17: fetch has no timeout of its own, and callers hold a database connection while a
  // Graph call runs. A connection that hung held that connection (and, for the offer letter, the quote's
  // row lock) for as long as the platform allowed.
  it('aborts a request that never answers, retries it, then reports Graph as unavailable', async () => {
    const calls = { signals: [] as (AbortSignal | null | undefined)[] };
    const client = new GraphClient({
      credential,
      fetch: hangs(calls),
      retries: 1,
      sleep: () => Promise.resolve(),
      timeoutMs: 40,
    });
    const started = Date.now();
    const failure = await client
      .send({ method: 'GET', path: '/drives/d/root' })
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(FileStoreError);
    expect((failure as FileStoreError).code).toBe('UNAVAILABLE');
    expect(calls.signals).toHaveLength(2);
    expect(calls.signals.every((s) => s?.aborted)).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('gives a request that carries file bytes its own, longer limit', async () => {
    const calls = { signals: [] as (AbortSignal | null | undefined)[] };
    const client = new GraphClient({
      credential,
      fetch: hangs(calls),
      retries: 0,
      sleep: () => Promise.resolve(),
      timeoutMs: 5_000,
      uploadTimeoutMs: 40,
    });
    const failure = await client
      .send({
        method: 'PUT',
        path: 'https://upload.example/session',
        anonymous: true,
        rawBody: new Uint8Array(8),
      })
      .catch((e: unknown) => e);
    expect((failure as FileStoreError).code).toBe('UNAVAILABLE');
    expect(calls.signals).toHaveLength(1);
  });

  it('leaves a request that answers in time alone', async () => {
    const client = new GraphClient({
      credential,
      fetch: () => Promise.resolve(new Response('{"ok":true}', { status: 200 })),
      timeoutMs: 40,
    });
    const res = await client.send({ method: 'GET', path: '/me' });
    expect(res.status).toBe(200);
  });
});
