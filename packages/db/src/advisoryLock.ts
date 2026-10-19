import type { Sql } from 'postgres';

/**
 * Advisory lock keys (64-bit). One per background job, so only one App Service instance runs it.
 * Keep them unique and never reuse a retired key.
 */
export const ADVISORY_LOCKS = {
  /** B-06: Salesforce delta sync. */
  sfSync: 606_001n,
  /** B-13: daily proposal validity expiry flags. */
  validityExpiry: 1_301_001n,
  /** B-18: the email dispatcher (and the to-qualify digest). */
  notificationDispatch: 1_801_001n,
} as const;

/**
 * Run `fn` while holding a session-level `pg_try_advisory_lock(key)` on a reserved connection.
 * Returns `{ acquired: false }` immediately when another session holds it. The lock is released in
 * `finally`, and Postgres drops it on its own if the process dies (the session ends).
 */
export async function withAdvisoryLock<T>(
  sql: Sql,
  key: bigint,
  fn: () => Promise<T>,
): Promise<{ acquired: true; result: T } | { acquired: false }> {
  const conn = await sql.reserve();
  try {
    const [row] = await conn<{ locked: boolean }[]>`
      select pg_try_advisory_lock(${key.toString()}::bigint) as locked`;
    if (!row?.locked) return { acquired: false };
    try {
      return { acquired: true, result: await fn() };
    } finally {
      await conn`select pg_advisory_unlock(${key.toString()}::bigint)`;
    }
  } finally {
    conn.release();
  }
}
