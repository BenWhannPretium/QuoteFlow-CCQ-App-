import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';

/** Test-only: a local signing key and JWKS standing in for the Entra tenant keys. */
export const TEST_TENANT = '11111111-2222-3333-4444-555555555555';
export const TEST_AUDIENCE = 'api://quoteflow-test';
export const TEST_API_CLIENT_ID = '99999999-8888-7777-6666-555555555555';
export const TEST_SPA_CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

export async function testKeys() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const keySet = createLocalJWKSet({ keys: [jwk] });

  /** Sign an Entra-shaped access token. `exp`/`nbf`/`iat` are seconds relative to now. */
  async function sign(
    claims: JWTPayload = {},
    {
      expiresIn = 3600,
      notBefore = -60,
      key = privateKey,
    }: { expiresIn?: number; notBefore?: number; key?: Parameters<SignJWT['sign']>[0] } = {},
  ) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      oid: '0b8e1c9e-0000-4000-8000-000000000001',
      preferred_username: 'pat.kam@pretium.example',
      name: 'Pat Kam',
      scp: 'access_as_user',
      roles: ['CCQ.KAM'],
      tid: TEST_TENANT,
      iss: `https://login.microsoftonline.com/${TEST_TENANT}/v2.0`,
      aud: TEST_AUDIENCE,
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })
      .setIssuedAt(now + notBefore)
      .setNotBefore(now + notBefore)
      .setExpirationTime(now + expiresIn)
      .sign(key);
  }

  return { keySet, sign, privateKey };
}

export const entraTestEnv = {
  AUTH_MODE: 'entra',
  ENTRA_TENANT_ID: TEST_TENANT,
  ENTRA_API_AUDIENCE: TEST_AUDIENCE,
  ENTRA_API_CLIENT_ID: TEST_API_CLIENT_ID,
  ENTRA_SPA_CLIENT_ID: TEST_SPA_CLIENT_ID,
};
