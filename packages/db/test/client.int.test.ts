import { describe, expect, it } from 'vitest';

import { createDb } from '../src/client';

/**
 * Audit 2026-11-17 (A-05). `ping()` backs GET /health. It ran `select 1` on the request pool with no
 * bound, so with every connection busy the probe waited as long as the stuck requests did.
 */
describe('createDb().ping()', () => {
  it('answers true on a healthy pool', async () => {
    const client = createDb(process.env.DB_TEST_URL!, { max: 1 });
    try {
      expect(await client.ping()).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('answers false within its time limit when every connection is busy', async () => {
    const client = createDb(process.env.DB_TEST_URL!, { max: 1, pingTimeoutMs: 300 });
    let release: () => void = () => {};
    const held = client.sql.begin(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    // Give the transaction time to take the pool's only connection.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const started = Date.now();
    const up = await client.ping();
    const waited = Date.now() - started;
    release();
    await held;
    await client.close();
    expect(up).toBe(false);
    expect(waited).toBeLessThan(2_000);
  });

  it('answers false when the database cannot be reached', async () => {
    const client = createDb('postgres://ccq:ccq@127.0.0.1:1/none', {
      max: 1,
      connectTimeoutSeconds: 1,
      pingTimeoutMs: 5_000,
    });
    try {
      expect(await client.ping()).toBe(false);
    } finally {
      await client.close();
    }
  });
});
