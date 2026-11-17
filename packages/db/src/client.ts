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
  /** How long `ping()` waits for `select 1` before it reports the database as down. Defaults to 3000. */
  pingTimeoutMs?: number;
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
      // Bounded. With every connection busy, `select 1` queues behind the requests that hold them, and
      // the health probe that asks used to wait as long as they did: the one signal meant to say "this
      // instance is stuck" hung instead of answering 503.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const gaveUp = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), options.pingTimeoutMs ?? 3000);
      });
      const answered = sql`select 1`.then(
        () => true,
        () => false,
      );
      try {
        return await Promise.race([answered, gaveUp]);
      } finally {
        clearTimeout(timer);
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
