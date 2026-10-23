import { createPrivateKey, sign, type KeyObject } from 'node:crypto';

import { requestToken, type SfSession } from './oauth';

/**
 * OAuth 2.0 JWT bearer flow (RFC 7523) for the connected app's integration user.
 * https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_jwt_flow.htm
 *
 * The private key (PEM, PKCS#1 or PKCS#8) comes from Key Vault in Azure: App Service resolves a
 * Key Vault reference into `SF_PRIVATE_KEY`. Locally it is the same env var. It is never logged.
 */

export const LOGIN_URLS = {
  uat: 'https://test.salesforce.com',
  prod: 'https://login.salesforce.com',
} as const;

export interface JwtLoginConfig {
  /** Connected app consumer key. */
  clientId: string;
  /** Integration username, e.g. integration@pretiumpkg.com.uat. */
  username: string;
  /** PEM text. Literal `\n` sequences (single-line env values) are accepted. */
  privateKey: string;
  /** test.salesforce.com (UAT/sandbox) or login.salesforce.com (prod). Also the JWT audience. */
  loginUrl: string;
}

const base64url = (input: string | Buffer) => Buffer.from(input).toString('base64url');

export function loadPrivateKey(pem: string): KeyObject {
  const normalised = pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
  return createPrivateKey({ key: normalised.trim(), format: 'pem' });
}

/** A signed RS256 assertion valid for 3 minutes (Salesforce allows at most 5). */
export function jwtAssertion(config: JwtLoginConfig, now: Date = new Date()): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: config.clientId,
      sub: config.username,
      aud: config.loginUrl.replace(/\/+$/, ''),
      exp: Math.floor(now.getTime() / 1000) + 180,
    }),
  );
  const signature = sign(
    'sha256',
    Buffer.from(`${header}.${claims}`),
    loadPrivateKey(config.privateKey),
  ).toString('base64url');
  return `${header}.${claims}.${signature}`;
}

/** Exchange the assertion for an access token. Fetch is injectable for tests. */
export async function jwtLogin(
  config: JwtLoginConfig,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<SfSession> {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwtAssertion(config, now),
  });
  return await requestToken(config.loginUrl, body, 'JWT', fetchImpl);
}
