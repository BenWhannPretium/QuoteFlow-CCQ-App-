import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index';

export interface DbClientOptions {
  /** Max pool size. Defaults to 10. */
  max?: number;
  /** Seconds to wait for a connection before failing. Defaults to 5. */
  connectTimeoutSeconds?: number;
  /** Max size of the separate pool for system-context reads nested in a request. Defaults to 2. */
  systemMax?: number;
}

export function createDb(databaseUrl: string, options: DbClientOptions = {}) {
  const sql = postgres(databaseUrl, {
    max: options.max ?? 10,
    connect_timeout: options.connectTimeoutSeconds ?? 5,
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });

  // A second, small pool for a system-context read made *while a request transaction is open* (intake's
  // "other active quotes on this opportunity"). Taking that second connection from the request pool
  // deadlocked it: with every connection held by a request waiting for one more, nothing could finish.
  // Holders of a system connection run one short read and wait on nothing else, so this cannot cycle.
  // postgres.js connects lazily: a client that never makes such a read opens no connection here.
  const systemSql = postgres(databaseUrl, {
    max: options.systemMax ?? 2,
    connect_timeout: options.connectTimeoutSeconds ?? 5,
    onnotice: () => {},
  });
  const systemDb = drizzle(systemSql, { schema });

  return {
    db,
    sql,
    systemDb,
    /** Returns true if the database answers `select 1`, false on any error. */
    async ping(): Promise<boolean> {
      try {
        await sql`select 1`;
        return true;
      } catch {
        return false;
      }
    },
    async close(): Promise<void> {
      await Promise.all([sql.end({ timeout: 5 }), systemSql.end({ timeout: 5 })]);
    },
  };
}

export type DbClient = ReturnType<typeof createDb>;

export type Database = PostgresJsDatabase<typeof schema>;
/** A transaction handle, as passed to `db.transaction(fn)`. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Repositories accept either the pool or a transaction. */
export type DbOrTx = Database | Tx;
