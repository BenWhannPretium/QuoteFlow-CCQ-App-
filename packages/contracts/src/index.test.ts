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

describe('intake contracts', () => {
  it('maps a draft to the domain values, resolving a free-text neck finish', async () => {
    const { intakeValues, IntakeDraftData } = await import('./intake');
    const data = IntakeDraftData.parse({
      sfOpportunityId: '006SYN000000000001',
      customer: { status: 'not_yet_established', name: 'New Co', location: 'Austin, TX' },
      neckFinish: 'OTHER',
      neckFinishOther: '  53mm lug ',
      components: ['CONTAINER'],
    });
    const values = intakeValues(data, ['OTHER']);
    expect(values).toMatchObject({
      sf_opportunity_id: '006SYN000000000001',
      customer: { status: 'not_yet_established', name: 'New Co', sf_account_id: null },
      neck_finish: '53mm lug',
      components: ['CONTAINER'],
      ship_to: null,
      est_annual_volume_confirmed: false,
    });
    expect(intakeValues({ neckFinish: '28-410' }, ['OTHER']).neck_finish).toBe('28-410');
  });

  it('rejects a malformed opportunity id or date in a draft', async () => {
    const { IntakeDraftData } = await import('./intake');
    expect(IntakeDraftData.safeParse({ sfOpportunityId: 'nope' }).success).toBe(false);
    expect(IntakeDraftData.safeParse({ expectedCloseDate: '10/23/2026' }).success).toBe(false);
  });
});
