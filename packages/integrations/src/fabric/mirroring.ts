import type { TokenCredential } from '@azure/identity';

import type { FetchLike } from '../graph/client';

/**
 * B-27 (L-8): read the health of the Fabric mirror of the CCQ database (Fabric REST API, v1).
 * Read-only: starting and stopping mirroring is the deploy pipeline's job (`scripts/fabric-mirroring.sh`),
 * never the app's. The caller (the App Service managed identity) needs read on the mirrored database.
 */
export const FABRIC_API_BASE_URL = 'https://api.fabric.microsoft.com/v1';
const FABRIC_SCOPE = 'https://api.fabric.microsoft.com/.default';

/** getMirroringStatus `status` (Microsoft may add values). */
export type FabricMirroringStatus =
  'Initializing' | 'Initialized' | 'Starting' | 'Running' | 'Stopping' | 'Stopped' | (string & {});

/** One table from getTablesMirroringStatus. Names and counts only: no row data. */
export interface FabricTableStatus {
  schema: string;
  table: string;
  /** Initialized | Snapshotting | Replicating | Reseeding | Stopped | Failed. */
  status: string;
  processedRows: number | null;
  lastSyncAt: string | null;
  latencySeconds: number | null;
  errorCode: string | null;
}

export interface FabricMirrorReader {
  readonly mode: 'live' | 'fake';
  mirroringStatus(): Promise<FabricMirroringStatus>;
  tablesStatus(): Promise<FabricTableStatus[]>;
}

export class FabricApiError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
  ) {
    super(`Fabric API: ${code}${status ? ` (${status})` : ''}`);
    this.name = 'FabricApiError';
  }
}

export interface FabricRestMirrorReaderOptions {
  credential: TokenCredential;
  workspaceId: string;
  mirroredDatabaseId: string;
  /** Test seam. */
  fetch?: FetchLike;
  baseUrl?: string;
}

interface TablesPage {
  continuationToken?: string;
  data?: {
    sourceSchemaName?: string;
    sourceTableName?: string;
    status?: string;
    metrics?: {
      processedRows?: number;
      lastSyncDateTime?: string;
      lastSyncLatencyInSeconds?: number;
    };
    error?: { errorCode?: string };
  }[];
}

export class FabricRestMirrorReader implements FabricMirrorReader {
  readonly mode = 'live' as const;
  private readonly fetch: FetchLike;
  private readonly base: string;

  constructor(private readonly opts: FabricRestMirrorReaderOptions) {
    this.fetch = opts.fetch ?? ((url, init) => fetch(url, init));
    const ws = encodeURIComponent(opts.workspaceId);
    const db = encodeURIComponent(opts.mirroredDatabaseId);
    this.base = `${opts.baseUrl ?? FABRIC_API_BASE_URL}/workspaces/${ws}/mirroredDatabases/${db}`;
  }

  private async post<T>(action: string, query = ''): Promise<T> {
    let token: string;
    try {
      const t = await this.opts.credential.getToken(FABRIC_SCOPE);
      if (!t) throw new Error('no token');
      token = t.token;
    } catch {
      throw new FabricApiError('TOKEN');
    }
    let res: Response;
    try {
      res = await this.fetch(`${this.base}/${action}${query}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
    } catch {
      throw new FabricApiError('NETWORK');
    }
    if (!res.ok) {
      let code = 'HTTP';
      try {
        const body = (await res.json()) as { errorCode?: unknown };
        if (typeof body.errorCode === 'string') code = body.errorCode;
      } catch {
        // no JSON body
      }
      throw new FabricApiError(code, res.status);
    }
    return (await res.json()) as T;
  }

  async mirroringStatus(): Promise<FabricMirroringStatus> {
    const body = await this.post<{ status?: string }>('getMirroringStatus');
    return body.status ?? 'Unknown';
  }

  async tablesStatus(): Promise<FabricTableStatus[]> {
    const out: FabricTableStatus[] = [];
    let token: string | undefined;
    do {
      const query = token ? `?continuationToken=${encodeURIComponent(token)}` : '';
      const page = await this.post<TablesPage>('getTablesMirroringStatus', query);
      for (const t of page.data ?? [])
        out.push({
          schema: t.sourceSchemaName ?? '',
          table: t.sourceTableName ?? '',
          status: t.status ?? 'Unknown',
          processedRows: t.metrics?.processedRows ?? null,
          lastSyncAt: t.metrics?.lastSyncDateTime ?? null,
          latencySeconds: t.metrics?.lastSyncLatencyInSeconds ?? null,
          errorCode: t.error?.errorCode ?? null,
        });
      token = page.continuationToken;
    } while (token);
    return out;
  }
}

/** A fixed answer, for tests and local dev. */
export class FakeFabricMirrorReader implements FabricMirrorReader {
  readonly mode = 'fake' as const;
  constructor(
    public status: FabricMirroringStatus = 'Running',
    public tables: FabricTableStatus[] = [],
  ) {}
  mirroringStatus() {
    return Promise.resolve(this.status);
  }
  tablesStatus() {
    return Promise.resolve(this.tables);
  }
}

export interface FabricMirrorHealth {
  healthy: boolean;
  /** Counters for integration_run.counts. */
  counts: {
    tables: number;
    replicating: number;
    snapshotting: number;
    failed: number;
    stopped: number;
    maxLatencySeconds: number;
  };
  /** Short and data-free (table names only) when unhealthy. */
  error: string | null;
}

/** Table states that are fine: copying, or about to. */
const OK_TABLE = new Set(['Initialized', 'Snapshotting', 'Replicating', 'Reseeding']);

/** Healthy = the mirror is Running and no table is Failed or Stopped. */
export function fabricMirrorHealth(
  status: FabricMirroringStatus,
  tables: readonly FabricTableStatus[],
): FabricMirrorHealth {
  const bad = tables.filter((t) => !OK_TABLE.has(t.status));
  const counts = {
    tables: tables.length,
    replicating: tables.filter((t) => t.status === 'Replicating').length,
    snapshotting: tables.filter((t) => t.status === 'Snapshotting' || t.status === 'Reseeding')
      .length,
    failed: tables.filter((t) => t.status === 'Failed').length,
    stopped: tables.filter((t) => t.status === 'Stopped').length,
    maxLatencySeconds: Math.max(0, ...tables.map((t) => t.latencySeconds ?? 0)),
  };
  const problems: string[] = [];
  if (status !== 'Running') problems.push(`mirroring is ${status}`);
  if (bad.length > 0) {
    const names = bad
      .slice(0, 5)
      .map((t) => `${t.table} ${t.status}${t.errorCode ? ` (${t.errorCode})` : ''}`);
    problems.push(
      `${bad.length} table(s) not replicating: ${names.join(', ')}${bad.length > 5 ? ', …' : ''}`,
    );
  }
  return { healthy: problems.length === 0, counts, error: problems.join('; ') || null };
}
