import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index';

export interface DbClientOptions {
  /** Max pool size. Defaults to 10. */
  max?: number;
  /** Seconds to wait for a connection before failing. Defaults to 5. */
  connectTimeoutSeconds?: number;
}

export function createDb(databaseUrl: string, options: DbClientOptions = {}) {
  const sql = postgres(databaseUrl, {
    max: options.max ?? 10,
    connect_timeout: options.connectTimeoutSeconds ?? 5,
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });

  return {
    db,
    sql,
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
      await sql.end({ timeout: 5 });
    },
  };
}

export type DbClient = ReturnType<typeof createDb>;
