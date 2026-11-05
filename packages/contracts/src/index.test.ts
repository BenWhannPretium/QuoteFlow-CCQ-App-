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
        environment: 'test',
        tenantId: 't',
        spaClientId: 'c',
        apiScope: 'api://x/access_as_user',
      }).authMode,
    ).toBe('entra');
    expect(
      AuthConfigResponse.parse({
        authMode: 'dev',
        environment: 'local',
        personas: [{ key: 'kam', roles: ['KAM'], scope: { type: 'all' } }],
      }).authMode,
    ).toBe('dev');
    expect(
      AuthConfigResponse.safeParse({ authMode: 'dev', environment: 'staging', personas: [] })
        .success,
    ).toBe(false);
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
  it('maps a draft to the domain values (FB-02 neck, resin, color; blank text is null)', async () => {
    const { intakeValues, IntakeDraftData } = await import('./intake');
    const data = IntakeDraftData.parse({
      sfOpportunityId: '006SYN000000000001',
      // A typed location from an old draft is dropped (F-007: nothing about the customer is typed).
      customer: { status: 'not_yet_established', name: 'New Co', location: 'Austin, TX' },
      neckDiameter: '53',
      neckFinishType: 'CUSTOM',
      neckFinishTypeCustom: '  lug ',
      resinCustomerSpecified: true,
      resinGrade: ' Pro-fax 6331 ',
      colorType: 'NATURAL',
      colorDescription: '   ',
      components: ['CONTAINER'],
    });
    expect(data.customer).toEqual({ status: 'not_yet_established', name: 'New Co' });
    const values = intakeValues(data);
    expect(values).toMatchObject({
      sf_opportunity_id: '006SYN000000000001',
      customer: { status: 'not_yet_established', name: 'New Co', sf_account_id: null },
      neck_diameter: '53',
      neck_finish_type: 'CUSTOM',
      neck_finish_type_custom: 'lug',
      resin_customer_specified: true,
      resin_grade: 'Pro-fax 6331',
      color_type: 'NATURAL',
      color_description: null,
      components: ['CONTAINER'],
      ship_to: null,
      est_annual_volume_confirmed: false,
    });
    expect(intakeValues({}).resin_customer_specified).toBe(false);
  });

  it('rejects a malformed opportunity id or date in a draft', async () => {
    const { IntakeDraftData } = await import('./intake');
    expect(IntakeDraftData.safeParse({ sfOpportunityId: 'nope' }).success).toBe(false);
    expect(IntakeDraftData.safeParse({ quoteNeededBy: '10/23/2026' }).success).toBe(false);
  });
});
