import { MeResponse, PROBLEM_CONTENT_TYPE } from '@ccq/contracts';
import { PERMISSIONS } from '@ccq/domain';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../app';
import { NO_ROLE_MESSAGE } from '../auth/identity';
import { entraTestEnv, testKeys } from '../auth/test-jwt';
import { fakeDb, memoryDirectory, testConfig } from '../test-utils';
import { routeDeclarationProblem } from './auth';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const devApp = async (mem = memoryDirectory()) =>
  (app = await buildApp(testConfig(), { db: fakeDb(), directory: mem.directory }));

describe('route permission declarations', () => {
  it('classifies declarations', () => {
    expect(routeDeclarationProblem('/api/v1/x', { permission: 'quote.read' })).toBeNull();
    expect(routeDeclarationProblem('/api/v1/x', { permission: 'authenticated' })).toBeNull();
    expect(routeDeclarationProblem('/api/v1/x', { public: true })).toBeNull();
    expect(routeDeclarationProblem('/api/v1/x', {})).toMatch(/neither/);
    expect(routeDeclarationProblem('/api/v1/x', undefined)).toMatch(/neither/);
    expect(routeDeclarationProblem('/api/v1/x', { permission: 'quote.reed' })).toMatch(/unknown/);
    expect(
      routeDeclarationProblem('/api/v1/x', { public: true, permission: 'quote.read' }),
    ).toMatch(/both/);
    expect(routeDeclarationProblem('/docs/json', {})).toBeNull();
  });

  it('boot fails when an /api route lacks a permission', async () => {
    app = await buildApp(testConfig(), { db: fakeDb(), directory: memoryDirectory().directory });
    app.get('/api/v1/forgot-permission', () => ({ ok: true }));
    await expect(app.ready()).rejects.toThrow(
      /GET \/api\/v1\/forgot-permission declares neither a permission nor public: true/,
    );
  });

  it('boot fails on an unknown permission name', async () => {
    app = await buildApp(testConfig(), { db: fakeDb(), directory: memoryDirectory().directory });
    app.post('/api/v1/typo', { config: { permission: 'quote.creat' as never } }, () => ({}));
    await expect(app.ready()).rejects.toThrow(/unknown permission "quote.creat"/);
  });

  it('boots when every route declares one', async () => {
    await devApp();
    await expect(app!.ready()).resolves.toBeDefined();
  });
});

describe('AUTH_MODE=dev', () => {
  it('401 problem+json without the x-dev-user header', async () => {
    await devApp();
    const res = await app!.inject({ method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer/);
    expect(res.json()).toMatchObject({ status: 401, code: 'missing_token' });
  });

  it('401 for an unknown persona', async () => {
    await devApp();
    const res = await app!.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { 'x-dev-user': 'ceo' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'unknown_persona' });
  });

  it('GET /me returns the persona user, roles, permissions, scope and flags', async () => {
    await devApp();
    const res = await app!.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { 'x-dev-user': 'multi-role' },
    });
    expect(res.statusCode).toBe(200);
    const me = MeResponse.parse(res.json());
    expect(me.roles).toEqual(['SalesLeader', 'Approver']);
    expect(me.permissions).toEqual(expect.arrayContaining(['gate.G1.decide', 'gate.G4.decide']));
    expect(me.permissions).not.toContain('config.manage');
    expect(me).toMatchObject({
      scope: { type: 'all' },
      featureFlags: { g1Enabled: true },
      authMode: 'dev',
      devPersona: 'multi-role',
    });
  });

  it('carries the persona scope', async () => {
    await devApp();
    const res = await app!.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { 'x-dev-user': 'kam-region' },
    });
    expect(res.json()).toMatchObject({ scope: { type: 'region', values: ['West'] } });
  });

  it('GET /auth/config lists personas and needs no auth', async () => {
    await devApp();
    const res = await app!.inject({ method: 'GET', url: '/api/v1/auth/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ authMode: string; personas: { key: string }[] }>();
    expect(body.authMode).toBe('dev');
    expect(body.personas.map((p) => p.key)).toEqual(
      expect.arrayContaining(['kam', 'kam-owner', 'admin', 'multi-role']),
    );
  });

  it('records one sign_in per user per window', async () => {
    const mem = memoryDirectory();
    await devApp(mem);
    for (let i = 0; i < 3; i++) {
      await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { 'x-dev-user': 'kam' } });
    }
    await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { 'x-dev-user': 'admin' } });
    expect(mem.signIns).toHaveLength(2);
    expect(mem.provisionCalls).toBe(2); // cached for 5 minutes
  });
});

describe('route-level permission enforcement', () => {
  it('403 problem+json for a role without the permission; handler runs for one with it', async () => {
    await devApp();
    let ran = 0;
    app!.get('/api/v1/test-config', { config: { permission: 'config.manage' } }, () => {
      ran += 1;
      return { ok: true };
    });
    const denied = await app!.inject({
      method: 'GET',
      url: '/api/v1/test-config',
      headers: { 'x-dev-user': 'kam' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(denied.json()).toMatchObject({ status: 403, permission: 'config.manage' });
    expect(ran).toBe(0);

    const allowed = await app!.inject({
      method: 'GET',
      url: '/api/v1/test-config',
      headers: { 'x-dev-user': 'admin' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(ran).toBe(1);
  });

  it('qualified grants pass the route check (resource checks are the service’s job)', async () => {
    await devApp();
    app!.post('/api/v1/test-outcome', { config: { permission: 'outcome.record' } }, () => ({}));
    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/test-outcome',
      headers: { 'x-dev-user': 'kam' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects unauthorised callers before the body is validated', async () => {
    await devApp();
    const { z } = await import('zod');
    app!.post(
      '/api/v1/test-validated',
      {
        config: { permission: 'config.manage' },
        schema: { body: z.object({ name: z.string() }) },
      },
      () => ({}),
    );
    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/test-validated',
      headers: { 'x-dev-user': 'kam' },
      payload: { wrong: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('404s stay 404 without credentials', async () => {
    await devApp();
    const res = await app!.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('every domain permission is a valid route declaration', () => {
    for (const p of PERMISSIONS)
      expect(routeDeclarationProblem('/api/v1/x', { permission: p })).toBeNull();
  });
});

describe('AUTH_MODE=entra', () => {
  let keys: Awaited<ReturnType<typeof testKeys>>;
  beforeAll(async () => {
    keys = await testKeys();
  });

  const entraApp = async (mem = memoryDirectory()) =>
    (app = await buildApp(testConfig(entraTestEnv), {
      db: fakeDb(),
      directory: mem.directory,
      entraKeySet: keys.keySet,
    }));

  const me = async (token?: string) =>
    app!.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it('accepts a valid bearer token and provisions the user', async () => {
    const mem = memoryDirectory();
    await entraApp(mem);
    const res = await me(await keys.sign({ roles: ['CCQ.Pricing'] }));
    expect(res.statusCode).toBe(200);
    expect(MeResponse.parse(res.json())).toMatchObject({
      user: { displayName: 'Pat Kam', upn: 'pat.kam@pretium.example' },
      roles: ['Pricing'],
      authMode: 'entra',
    });
    expect(res.json()).not.toHaveProperty('devPersona');
    expect(mem.users.size).toBe(1);
  });

  it('401 for missing, expired and wrong-audience tokens', async () => {
    await entraApp();
    expect((await me()).statusCode).toBe(401);
    expect((await me(await keys.sign({}, { expiresIn: -300 }))).statusCode).toBe(401);
    const wrongAud = await me(await keys.sign({ aud: 'api://not-us' }));
    expect(wrongAud.statusCode).toBe(401);
    expect(wrongAud.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  it('403 with the SG-CCQ message for a token with no CCQ role', async () => {
    await entraApp();
    const res = await me(await keys.sign({ roles: [] }));
    expect(res.statusCode).toBe(403);
    expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(res.json()).toMatchObject({ status: 403, detail: NO_ROLE_MESSAGE, code: 'no_role' });
  });

  it('ignores x-dev-user in entra mode', async () => {
    await entraApp();
    const res = await app!.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { 'x-dev-user': 'admin' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('role changes in the token apply immediately, bypassing the cache', async () => {
    const mem = memoryDirectory();
    await entraApp(mem);
    await me(await keys.sign({ roles: ['CCQ.KAM', 'CCQ.Admin'] }));
    const res = await me(await keys.sign({ roles: ['CCQ.KAM'] }));
    expect(res.json()).toMatchObject({ roles: ['KAM'] });
    expect(mem.provisionCalls).toBe(2);
  });

  it('GET /auth/config returns the MSAL settings', async () => {
    await entraApp();
    const res = await app!.inject({ method: 'GET', url: '/api/v1/auth/config' });
    expect(res.json()).toEqual({
      authMode: 'entra',
      tenantId: entraTestEnv.ENTRA_TENANT_ID,
      spaClientId: entraTestEnv.ENTRA_SPA_CLIENT_ID,
      apiScope: `${entraTestEnv.ENTRA_API_AUDIENCE}/access_as_user`,
    });
  });

  it('health stays public', async () => {
    await entraApp();
    expect((await app!.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
  });
});
