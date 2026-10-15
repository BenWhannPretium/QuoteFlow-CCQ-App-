import { describe, expect, it } from 'vitest';

import { createDb } from './index';

describe('@ccq/db', () => {
  it('reports down for an unreachable database without throwing', async () => {
    const client = createDb('postgres://nobody:nothing@127.0.0.1:1/none', {
      connectTimeoutSeconds: 1,
    });
    await expect(client.ping()).resolves.toBe(false);
    await client.close();
  });
});
