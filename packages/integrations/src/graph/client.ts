import {
  ClientSecretCredential,
  ManagedIdentityCredential,
  type TokenCredential,
} from '@azure/identity';

import { FileStoreError, silentFileStoreLogger, type FileStoreLogger } from './filestore';

export const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

/**
 * App-only Graph credentials. In Azure: the App Service managed identity (system-assigned, or a
 * user-assigned one by client id); IT grants it `Sites.Selected` with `write` on the CCQ site only
 * (M7). Locally: a client secret from env, for the **test** site only. Never both, never delegated.
 */
export type GraphCredentialConfig =
  | { kind: 'managed-identity'; clientId?: string | undefined }
  | { kind: 'client-secret'; tenantId: string; clientId: string; clientSecret: string };

export function createGraphCredential(config: GraphCredentialConfig): TokenCredential {
  return config.kind === 'managed-identity'
    ? config.clientId
      ? new ManagedIdentityCredential({ clientId: config.clientId })
      : new ManagedIdentityCredential()
    : new ClientSecretCredential(config.tenantId, config.clientId, config.clientSecret);
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface GraphClientOptions {
  credential: TokenCredential;
  /** Test seam: the mock Graph. */
  fetch?: FetchLike;
  baseUrl?: string;
  logger?: FileStoreLogger;
  /** Retries for 429 / 5xx (Retry-After honoured, capped). Default 3. */
  retries?: number;
  /** Test seam: waiting between retries. */
  sleep?: (ms: number) => Promise<void>;
}

export interface GraphRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path under the Graph base URL (`/drives/…`) or an absolute URL (paging links). */
  path: string;
  body?: unknown;
  /** A pre-authenticated URL (upload sessions): no bearer token is sent. */
  anonymous?: boolean;
  headers?: Record<string, string>;
  rawBody?: Uint8Array;
}

/** Graph error code from the JSON body, if any (data-free: e.g. "itemNotFound"). */
async function graphErrorCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === 'string' ? body.error.code : undefined;
  } catch {
    return undefined;
  }
}

function errorFor(status: number, graphCode: string | undefined): FileStoreError {
  const detail = `Microsoft Graph answered ${status}${graphCode ? ` (${graphCode})` : ''}`;
  if (status === 404) return new FileStoreError('NOT_FOUND', detail, status);
  if (status === 401 || status === 403) return new FileStoreError('FORBIDDEN', detail, status);
  if (status === 429) return new FileStoreError('THROTTLED', detail, status);
  if (status >= 500) return new FileStoreError('UNAVAILABLE', detail, status);
  return new FileStoreError('FAILED', detail, status);
}

/**
 * A minimal Microsoft Graph client: bearer tokens from `@azure/identity`, JSON in and out, retries on
 * throttling and 5xx. Logs carry the method, the status and Graph's error code; never paths or names.
 */
export class GraphClient {
  private readonly fetch: FetchLike;
  private readonly baseUrl: string;
  private readonly logger: FileStoreLogger;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: GraphClientOptions) {
    this.fetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.baseUrl = opts.baseUrl ?? GRAPH_BASE_URL;
    this.logger = opts.logger ?? silentFileStoreLogger;
    this.retries = opts.retries ?? 3;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async token(): Promise<string> {
    try {
      const t = await this.opts.credential.getToken(GRAPH_SCOPE);
      if (!t) throw new Error('no token');
      return t.token;
    } catch {
      this.logger.error({ op: 'token' }, 'graph token request failed');
      throw new FileStoreError('UNAVAILABLE', 'Could not get a Microsoft Graph token');
    }
  }

  /** Send a request; return the response for 2xx, throw FileStoreError otherwise. */
  async send(req: GraphRequest): Promise<Response> {
    const url = /^https?:\/\//.test(req.path) ? req.path : `${this.baseUrl}${req.path}`;
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { ...req.headers };
      if (!req.anonymous) headers.authorization = `Bearer ${await this.token()}`;
      let body: RequestInit['body'];
      if (req.rawBody) body = req.rawBody as RequestInit['body'];
      else if (req.body !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(req.body);
      }
      let res: Response;
      try {
        res = await this.fetch(url, { method: req.method, headers, ...(body ? { body } : {}) });
      } catch {
        if (attempt < this.retries) {
          await this.sleep(500 * 2 ** attempt);
          continue;
        }
        this.logger.error({ op: req.method, code: 'NETWORK' }, 'graph request failed');
        throw new FileStoreError('UNAVAILABLE', 'Microsoft Graph could not be reached');
      }
      if (res.ok) return res;
      const retriable = res.status === 429 || res.status >= 500;
      if (retriable && attempt < this.retries) {
        const after = Number(res.headers.get('retry-after'));
        await this.sleep(
          Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 500 * 2 ** attempt, 10_000),
        );
        continue;
      }
      const code = await graphErrorCode(res);
      const level = res.status === 404 ? 'info' : 'warn';
      this.logger[level](
        { op: req.method, status: res.status, graphCode: code },
        'graph request failed',
      );
      throw errorFor(res.status, code);
    }
  }

  async json<T>(req: GraphRequest): Promise<T> {
    const res = await this.send(req);
    return (res.status === 204 ? null : await res.json()) as T;
  }
}
