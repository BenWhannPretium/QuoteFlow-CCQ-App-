import sql from 'mssql';

import { PRICING_TIMEOUT_MS, PricingNotConfiguredError } from './reader';
import type { SqlQueryRunner, SqlStatement } from './sql';

/**
 * TDS connections for the two M5 routes. Encrypted, certificate-checked, read-only intent, a small
 * pool and the 10 s request timeout. Credentials come from Key Vault (App Service Key Vault references
 * for Route A's password; the App Service managed identity for Route B) and are never logged.
 */

/** Route A: a read-only SQL login scoped to the views Cory exposes on a replica. */
export interface SqlServerRouteConfig {
  server: string;
  port?: number | undefined;
  database: string;
  user: string;
  /** From Key Vault. Never logged. */
  password: string;
  /** Only for a lab server with a self-signed certificate. Never in Azure. */
  trustServerCertificate?: boolean | undefined;
}

/** Route B: the D&A copy in Fabric, via its SQL analytics endpoint, with Entra auth. */
export interface FabricRouteConfig {
  /** e.g. `xxxx.datawarehouse.fabric.microsoft.com`. */
  server: string;
  /** The lakehouse / warehouse name. */
  database: string;
  /** Client id of a user-assigned managed identity; omit for the system-assigned one. */
  managedIdentityClientId?: string | undefined;
}

const common = {
  requestTimeout: PRICING_TIMEOUT_MS,
  connectionTimeout: PRICING_TIMEOUT_MS,
  pool: { max: 4, min: 0, idleTimeoutMillis: 60_000 },
};

export function sqlServerConfig(c: SqlServerRouteConfig): sql.config {
  return {
    ...common,
    server: c.server,
    ...(c.port ? { port: c.port } : {}),
    database: c.database,
    user: c.user,
    password: c.password,
    options: {
      encrypt: true,
      trustServerCertificate: c.trustServerCertificate ?? false,
      // ApplicationIntent=ReadOnly: routed to a readable secondary when the server has one.
      readOnlyIntent: true,
      appName: 'QuoteFlow-CCQ',
    },
  };
}

export function fabricConfig(c: FabricRouteConfig): sql.config {
  return {
    ...common,
    server: c.server,
    port: 1433,
    database: c.database,
    // tedious's DefaultAzureCredential: the App Service managed identity in Azure, `az login` locally.
    authentication: {
      type: 'azure-active-directory-default',
      options: c.managedIdentityClientId ? { clientId: c.managedIdentityClientId } : {},
    },
    options: { encrypt: true, trustServerCertificate: false, appName: 'QuoteFlow-CCQ' },
  };
}

/** Runs parameterized statements on a lazily connected pool; a failed connect is retried next call. */
export class MssqlQueryRunner implements SqlQueryRunner {
  private pool: sql.ConnectionPool | null = null;
  private connecting: Promise<sql.ConnectionPool> | null = null;

  constructor(private readonly config: sql.config) {
    if (!config.server || !config.database) throw new PricingNotConfiguredError('server/database');
  }

  private connect(): Promise<sql.ConnectionPool> {
    if (this.pool?.connected) return Promise.resolve(this.pool);
    this.connecting ??= new sql.ConnectionPool(this.config)
      .connect()
      .then((pool) => {
        this.pool = pool;
        return pool;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  async query(statement: SqlStatement): Promise<Record<string, unknown>[]> {
    const pool = await this.connect();
    const request = pool.request();
    for (const p of statement.params) {
      request.input(p.name, p.type === 'int' ? sql.Int : sql.NVarChar(400), p.value);
    }
    const result = await request.query<Record<string, unknown>>(statement.text);
    return result.recordset ?? [];
  }

  async close(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    await pool?.close();
  }
}
