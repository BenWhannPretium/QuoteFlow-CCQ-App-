import { afterEach, describe, expect, it, vi } from 'vitest';

import { RedirectingError } from '@/auth/session';

import { ApiError } from './api';
import { describeError, errorPresentation } from './errors';
import { createQueryClient } from './query-client';
import { toast, toastStore } from './toast';

const apiError = (status: number, extra: Record<string, unknown> = {}) =>
  new ApiError({ type: 'about:blank', title: `HTTP ${status}`, status, ...extra });

afterEach(() => {
  toastStore.reset();
  vi.useRealTimers();
});

describe('errorPresentation', () => {
  it('toasts server faults and network failures, keeps 4xx inline', () => {
    expect(errorPresentation(apiError(500))).toBe('toast');
    expect(errorPresentation(apiError(503))).toBe('toast');
    expect(errorPresentation(new TypeError('Failed to fetch'))).toBe('toast');
    expect(errorPresentation(apiError(400))).toBe('inline');
    expect(errorPresentation(apiError(403))).toBe('inline');
    expect(errorPresentation(apiError(404))).toBe('inline');
    expect(errorPresentation(new RedirectingError())).toBe('ignore');
  });
});

describe('describeError', () => {
  it('uses problem+json detail for client errors', () => {
    expect(describeError(apiError(422, { title: 'Invalid', detail: 'Pick a plant' }))).toEqual({
      title: 'Invalid',
      message: 'Pick a plant',
    });
  });

  it('gives server errors a friendly title', () => {
    expect(describeError(apiError(500)).title).toBe('Something went wrong on our side');
  });
});

describe('global query error handling', () => {
  const fail = (err: Error) => () => Promise.reject(err);

  it('toasts once per kind of 5xx and never for 4xx', async () => {
    const client = createQueryClient();
    const opts = { retry: false } as const;
    await client.prefetchQuery({ queryKey: ['a'], queryFn: fail(apiError(500)), ...opts });
    await client.prefetchQuery({ queryKey: ['b'], queryFn: fail(apiError(500)), ...opts });
    await client.prefetchQuery({ queryKey: ['c'], queryFn: fail(apiError(404)), ...opts });
    const toasts = toastStore.getSnapshot();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      variant: 'error',
      title: 'Something went wrong on our side',
    });
  });

  it('respects meta.silentErrors', async () => {
    const client = createQueryClient();
    await client.prefetchQuery({
      queryKey: ['d'],
      queryFn: fail(apiError(502)),
      retry: false,
      meta: { silentErrors: true },
    });
    expect(toastStore.getSnapshot()).toHaveLength(0);
  });

  it('does not retry client errors', () => {
    const retry = createQueryClient().getDefaultOptions().queries?.retry as (
      n: number,
      e: unknown,
    ) => boolean;
    expect(retry(0, apiError(404))).toBe(false);
    expect(retry(0, apiError(503))).toBe(true);
    expect(retry(1, apiError(503))).toBe(false);
  });
});

describe('toast store', () => {
  it('caps the queue, auto-dismisses, and replaces toasts with the same key', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 6; i++) toast.info({ title: `t${i}` });
    expect(toastStore.getSnapshot().map((t) => t.title)).toEqual(['t2', 't3', 't4', 't5']);
    vi.advanceTimersByTime(5_000);
    expect(toastStore.getSnapshot()).toHaveLength(0);

    toast.error({ title: 'x', key: 'k' });
    toast.error({ title: 'y', key: 'k' });
    expect(toastStore.getSnapshot().map((t) => t.title)).toEqual(['y']);
  });
});
