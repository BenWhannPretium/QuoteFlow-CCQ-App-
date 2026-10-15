import type { Role, Scope } from '@ccq/domain';
import type { sql } from 'drizzle-orm';
import { afterAll } from 'vitest';

import { DEFAULT_ANCHOR, DEFAULT_SEED, buildPersonas } from '../seeds/synthetic/index';
import type { PersonaKey } from '../seeds/synthetic/index';
import { createRng } from '../seeds/synthetic/rng';
import { createDb } from '../src/client';
import type { Tx } from '../src/client';
import { withRequestContext } from '../src/withRequestContext';

/** A pooled client for the test file, closed after it. Connects as the (superuser) owner. */
export function testDb(max = 5) {
  const client = createDb(process.env.DB_TEST_URL!, { max });
  afterAll(() => client.close());
  return client;
}

/** The synthetic personas, rebuilt from the same seed the global setup used. */
export const personas = new Map(
  buildPersonas(createRng(DEFAULT_SEED), DEFAULT_ANCHOR).map((p) => [p.key, p]),
);
export const persona = (key: PersonaKey) => personas.get(key)!;

export async function as<T>(
  db: ReturnType<typeof createDb>['db'],
  who: { userId: string; roles: readonly Role[]; scope: Scope },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withRequestContext(db, who, fn);
}

export const asPersona = <T>(
  db: ReturnType<typeof createDb>['db'],
  key: PersonaKey,
  fn: (tx: Tx) => Promise<T>,
) => {
  const p = persona(key);
  return as(db, { userId: p.id, roles: p.roles, scope: p.scope }, fn);
};

/** Raw SQL, deliberately bypassing the repositories: RLS must hold anyway. */
export const raw = async <R extends Record<string, unknown>>(
  tx: Tx,
  query: ReturnType<typeof sql>,
) => (await tx.execute<R>(query)) as unknown as R[];

/** Postgres error code of a rejected promise (e.g. 42501 insufficient_privilege). */
export async function pgError(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    let e: unknown = err;
    while (e && typeof e === 'object') {
      if (
        'code' in e &&
        typeof e.code === 'string' &&
        /^[0-9A-Z]{5}$/.test((e as { code: string }).code)
      ) {
        return (e as { code: string }).code;
      }
      e = (e as { cause?: unknown }).cause;
    }
    throw err;
  }
}
