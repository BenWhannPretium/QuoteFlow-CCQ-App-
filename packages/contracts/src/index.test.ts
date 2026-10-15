import { describe, expect, it } from 'vitest';

import { HealthResponse, ProblemDetails } from './index';

describe('@ccq/contracts', () => {
  it('parses a health response', () => {
    const parsed = HealthResponse.parse({
      status: 'ok',
      version: 'abc123',
      db: 'up',
      time: new Date().toISOString(),
    });
    expect(parsed.db).toBe('up');
  });

  it('rejects an unknown db state', () => {
    expect(
      HealthResponse.safeParse({ status: 'ok', version: 'x', db: 'maybe', time: 'now' }).success,
    ).toBe(false);
  });

  it('accepts a problem with extension members', () => {
    const p = ProblemDetails.parse({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      foo: 1,
    });
    expect(p.status).toBe(404);
  });
});
