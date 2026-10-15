import { generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { createEntraVerifier, entraIssuer, entraJwksUrl } from './entra';
import { AuthError, NO_ROLE_MESSAGE, rolesFromClaim } from './identity';
import { TEST_API_CLIENT_ID, TEST_AUDIENCE, TEST_TENANT, testKeys } from './test-jwt';

let keys: Awaited<ReturnType<typeof testKeys>>;
let verify: ReturnType<typeof createEntraVerifier>;

beforeAll(async () => {
  keys = await testKeys();
  verify = createEntraVerifier({
    tenantId: TEST_TENANT,
    audiences: [TEST_AUDIENCE, TEST_API_CLIENT_ID],
    requiredScope: 'access_as_user',
    keySet: keys.keySet,
  });
});

async function rejection(token: Promise<string> | string): Promise<AuthError> {
  const err = await verify(await token).then(
    () => expect.unreachable('token was accepted'),
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AuthError);
  return err as AuthError;
}

describe('Entra token validation', () => {
  it('accepts a valid token and extracts the identity', async () => {
    const id = await verify(await keys.sign({ roles: ['CCQ.KAM', 'CCQ.Approver', 'Other.Role'] }));
    expect(id).toEqual({
      oid: '0b8e1c9e-0000-4000-8000-000000000001',
      upn: 'pat.kam@pretium.example',
      displayName: 'Pat Kam',
      email: 'pat.kam@pretium.example',
      roles: ['Approver', 'KAM'],
    });
  });

  it('accepts the API client id as audience (v2 tokens)', async () => {
    await expect(verify(await keys.sign({ aud: TEST_API_CLIENT_ID }))).resolves.toMatchObject({
      roles: ['KAM'],
    });
  });

  it('rejects an expired token', async () => {
    const err = await rejection(keys.sign({}, { expiresIn: -120 }));
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/expired/);
  });

  it('allows 60 s of clock skew on exp and nbf', async () => {
    await expect(verify(await keys.sign({}, { expiresIn: -30 }))).resolves.toBeTruthy();
    await expect(verify(await keys.sign({}, { notBefore: 30 }))).resolves.toBeTruthy();
    expect((await rejection(keys.sign({}, { notBefore: 300 }))).status).toBe(401);
  });

  it('rejects the wrong audience', async () => {
    const err = await rejection(keys.sign({ aud: 'api://some-other-api' }));
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/aud/);
  });

  it('rejects the wrong issuer (another tenant)', async () => {
    const err = await rejection(
      keys.sign({ iss: 'https://login.microsoftonline.com/another-tenant/v2.0' }),
    );
    expect(err.message).toMatch(/iss/);
  });

  it('rejects a token signed by a key not in the JWKS', async () => {
    const other = await generateKeyPair('RS256');
    expect((await rejection(keys.sign({}, { key: other.privateKey }))).status).toBe(401);
  });

  it('rejects garbage and alg=none tokens', async () => {
    expect((await rejection('not.a.jwt')).reason).toBe('invalid_token');
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{}').toString('base64url')}.`;
    expect((await rejection(none)).reason).toBe('invalid_token');
  });

  it('requires the access_as_user scope (rejects app-only tokens)', async () => {
    expect((await rejection(keys.sign({ scp: 'User.Read' }))).message).toMatch(/access_as_user/);
    expect((await rejection(keys.sign({ scp: undefined }))).status).toBe(401);
  });

  it('requires an oid', async () => {
    expect((await rejection(keys.sign({ oid: undefined }))).status).toBe(401);
  });

  it('rejects a valid token with no CCQ role as 403', async () => {
    for (const roles of [undefined, [], ['Other.App.Role'], ['CCQ.NotARole']]) {
      const err = await rejection(keys.sign({ roles }));
      expect(err.status).toBe(403);
      expect(err.reason).toBe('no_role');
      expect(err.message).toBe(NO_ROLE_MESSAGE);
    }
  });

  it('falls back to upn / oid when preferred_username or name is missing', async () => {
    const id = await verify(
      await keys.sign({ preferred_username: undefined, upn: 'x@pretium.example', name: undefined }),
    );
    expect(id).toMatchObject({ upn: 'x@pretium.example', displayName: 'x@pretium.example' });
  });

  it('builds the tenant issuer and JWKS URLs', () => {
    expect(entraIssuer('t1')).toBe('https://login.microsoftonline.com/t1/v2.0');
    expect(entraJwksUrl('t1').href).toBe(
      'https://login.microsoftonline.com/t1/discovery/v2.0/keys',
    );
  });
});

describe('rolesFromClaim', () => {
  it('keeps known CCQ roles, deduped and sorted', () => {
    expect(rolesFromClaim(['CCQ.Pricing', 'CCQ.Admin', 'CCQ.Pricing', 'CCQ.Bogus', 7])).toEqual([
      'Admin',
      'Pricing',
    ]);
    expect(rolesFromClaim('CCQ.KAM')).toEqual([]);
  });
});
