import { afterEach, describe, expect, it, vi } from 'vitest';

import { setAuthSession, type AuthSession } from '@/auth/session';

import { api, ApiError, isApiError } from './api';

const me = {
  user: {
    id: '0192f0c0-0000-7000-8000-000000000001',
    displayName: 'Pat',
    upn: 'pat@example.com',
    email: null,
  },
  roles: ['KAM'],
  permissions: ['quote.read'],
  scope: { type: 'all' },
  featureFlags: {},
  authMode: 'entra',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function session(): AuthSession & { calls: boolean[] } {
  const calls: boolean[] = [];
  return {
    mode: 'entra',
    calls,
    headers: ({ forceRefresh = false } = {}) => {
      calls.push(forceRefresh);
      return Promise.resolve({ authorization: `Bearer ${forceRefresh ? 'fresh' : 'cached'}` });
    },
    signIn: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthSession(null);
});

describe('api client auth', () => {
  it('attaches the bearer token', async () => {
    const s = session();
    setAuthSession(s);
    const fetchMock = vi.fn().mockResolvedValue(json(200, me));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.me()).resolves.toMatchObject({ roles: ['KAM'] });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { authorization: 'Bearer cached' },
    });
  });

  it('re-acquires the token once on 401, then succeeds', async () => {
    const s = session();
    setAuthSession(s);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          json(401, { type: 'about:blank', title: 'Unauthorized', status: 401 }),
        )
        .mockResolvedValueOnce(json(200, me)),
    );
    await expect(api.me()).resolves.toBeTruthy();
    expect(s.calls).toEqual([false, true]);
  });

  it('gives up after the second 401', async () => {
    setAuthSession(session());
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(json(401, { type: 'about:blank', title: 'Unauthorized', status: 401 })),
      );
    vi.stubGlobal('fetch', fetchMock);
    const err = await api.me().catch((e: unknown) => e);
    expect(isApiError(err, 401)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces 403 problem details without retrying', async () => {
    const s = session();
    setAuthSession(s);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(403, {
          type: 'about:blank',
          title: 'Forbidden',
          status: 403,
          detail: 'No QuoteFlow role assigned; ask IT to add you to an SG-CCQ group',
        }),
      ),
    );
    const err = await api.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).message).toMatch(/SG-CCQ/);
    expect(s.calls).toEqual([false]);
  });

  it('public calls send no credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { authMode: 'dev', personas: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.authConfig()).resolves.toMatchObject({ authMode: 'dev' });
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      method: 'GET',
      headers: { accept: 'application/json' },
    });
  });

  it('the Salesforce sync is a POST, and its 202 (still running) is data', async () => {
    setAuthSession(session());
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json(202, { outcome: 'running', runId: null, counts: {} }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.syncSalesforce()).resolves.toEqual({
      outcome: 'running',
      runId: null,
      counts: {},
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/admin/salesforce/sync');
    expect(init.method).toBe('POST');
  });

  it('authenticated calls fail fast with no session', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(api.me()).rejects.toThrow(/Not signed in/);
  });
});
