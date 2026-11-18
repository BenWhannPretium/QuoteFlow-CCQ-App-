import { describe, expect, it } from 'vitest';

import { checkAccessAgain } from './check-again';
import { devSession } from './session';

describe('checkAccessAgain (UX-016: "Check again" on the no-access page)', () => {
  it('asks for a fresh token, skipping the cached one, and only then asks /me again', async () => {
    const calls: string[] = [];
    const session = {
      headers: (opts?: { forceRefresh?: boolean }) => {
        calls.push(`token forceRefresh=${String(opts?.forceRefresh)}`);
        return Promise.resolve({ authorization: 'Bearer new' });
      },
    };
    await checkAccessAgain(session, () => {
      calls.push('me');
      return Promise.resolve();
    });
    expect(calls).toEqual(['token forceRefresh=true', 'me']);
  });

  it('still asks /me when the token cannot be refreshed, so the page shows why', async () => {
    let asked = 0;
    const session = { headers: () => Promise.reject(new Error('no_network_connectivity')) };
    await expect(
      checkAccessAgain(session, () => {
        asked += 1;
        return Promise.resolve();
      }),
    ).resolves.toBeUndefined();
    expect(asked).toBe(1);
  });

  it('waits for the answer from /me', async () => {
    let answered = false;
    await checkAccessAgain(devSession('kam'), async () => {
      await Promise.resolve();
      answered = true;
    });
    expect(answered).toBe(true);
  });

  it('with dev sign-in (no token) it is a plain refetch', async () => {
    let asked = 0;
    await checkAccessAgain(devSession('kam'), () => {
      asked += 1;
      return Promise.resolve();
    });
    expect(asked).toBe(1);
  });
});
