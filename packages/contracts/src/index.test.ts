import { describe, expect, it } from 'vitest';

import { AuthConfigResponse, HealthResponse, MeResponse, ProblemDetails, ScopeDto } from './index';

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

describe('auth contracts', () => {
  it('parses both auth config shapes', () => {
    expect(
      AuthConfigResponse.parse({
        authMode: 'entra',
        tenantId: 't',
        spaClientId: 'c',
        apiScope: 'api://x/access_as_user',
      }).authMode,
    ).toBe('entra');
    expect(
      AuthConfigResponse.parse({
        authMode: 'dev',
        personas: [{ key: 'kam', roles: ['KAM'], scope: { type: 'all' } }],
      }).authMode,
    ).toBe('dev');
  });

  it('requires values on region scopes', () => {
    expect(ScopeDto.safeParse({ type: 'region' }).success).toBe(false);
    expect(ScopeDto.safeParse({ type: 'region', values: ['West'] }).success).toBe(true);
  });

  it('parses a /me response', () => {
    const me = MeResponse.parse({
      user: {
        id: '0192f0c0-0000-7000-8000-000000000001',
        displayName: 'A',
        upn: 'a@example.com',
        email: null,
      },
      roles: ['KAM'],
      permissions: ['quote.read'],
      scope: { type: 'all' },
      featureFlags: { g1Enabled: true },
      authMode: 'dev',
      devPersona: 'kam',
    });
    expect(me.roles).toEqual(['KAM']);
  });
});
