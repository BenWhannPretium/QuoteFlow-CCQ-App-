import { SF_TIMEOUT_MS } from './retry';

/**
 * The Salesforce OAuth token request, shared by both server-to-server logins: the JWT bearer flow
 * (jwt.ts) and the client credentials flow (below). This is the only POST in the connector, and it
 * goes to the OAuth endpoint, not the data API.
 */

/** Which login the External Client App is set up for (`SF_AUTH_FLOW`). */
export type SfAuthFlow = 'jwt' | 'client_credentials';

export interface SfSession {
  accessToken: string;
  instanceUrl: string;
}

export class SfAuthError extends Error {
  constructor(
    readonly errorCode: string,
    readonly status: number,
    flow: string = 'JWT',
  ) {
    // The SF error code only (e.g. invalid_grant); the description can echo the username.
    super(`Salesforce ${flow} login failed: ${errorCode} (HTTP ${status})`);
    this.name = 'SfAuthError';
  }
}

/** POST the grant to `{loginUrl}/services/oauth2/token`. Fetch is injectable for tests. */
export async function requestToken(
  loginUrl: string,
  body: URLSearchParams,
  flow: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SfSession> {
  const res = await fetchImpl(`${loginUrl.replace(/\/+$/, '')}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(SF_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== 'string' || typeof json.instance_url !== 'string') {
    const code = typeof json.error === 'string' ? json.error : 'login_failed';
    throw new SfAuthError(code, res.status, flow);
  }
  return { accessToken: json.access_token, instanceUrl: json.instance_url };
}

export interface ClientCredentialsConfig {
  /** External Client App consumer key. */
  clientId: string;
  /** External Client App consumer secret. In Azure a Key Vault reference. Never logged. */
  clientSecret: string;
  /**
   * The org's My Domain URL, e.g. https://pretiumpkg.my.salesforce.com. The client credentials flow
   * doesn't accept login.salesforce.com or test.salesforce.com.
   */
  loginUrl: string;
}

/**
 * OAuth 2.0 client credentials flow. The session runs as the app's "Run As" user (the read-only
 * integration user), which Rachel Dew sets on the External Client App.
 * https://help.salesforce.com/s/articleView?id=xcloud.connected_app_client_credentials_setup.htm
 */
export function clientCredentialsLogin(
  config: ClientCredentialsConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<SfSession> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  return requestToken(config.loginUrl, body, 'client credentials', fetchImpl);
}
