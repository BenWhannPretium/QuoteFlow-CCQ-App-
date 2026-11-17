/**
 * The Postgres SQLSTATE of an error, found on the error itself or anywhere in its `cause` chain: drizzle
 * wraps the driver's error (`DrizzleQueryError` → `PostgresError`), so the code is rarely on the top
 * level.
 */
export function pgCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let depth = 0; depth < 8 && e && typeof e === 'object'; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

export interface PgProblem {
  status: 400 | 409;
  code: string;
  detail: string;
}

/**
 * The safety net for a database error no service mapped itself. These states are not server faults: two
 * requests collided, or a value the request schema let through does not fit its column. They used to
 * surface as a bare 500. The wording never quotes the database (its messages can echo row values).
 *
 * - 23505 unique violation, 23503 foreign-key violation: a concurrent change (a double click, two
 *   people on one record). 409.
 * - 40001 serialization failure, 40P01 deadlock: Postgres aborted one of two colliding transactions.
 *   409, safe to retry.
 * - class 22 (data exception: 22008 date out of range, 22P02 invalid text, 22003 numeric overflow,
 *   22001 too long): the input does not fit. 400.
 *
 * Anything else (a NOT NULL or CHECK violation, a missing relation, a lost connection) stays a 500: it
 * is a defect or an outage and must page as one.
 */
export function pgProblem(err: unknown): PgProblem | null {
  const code = pgCode(err);
  if (!code) return null;
  if (code === '23505' || code === '23503') {
    return {
      status: 409,
      code: 'conflict',
      detail:
        'This was changed by someone else at the same moment, or was sent twice. Reload and try again.',
    };
  }
  if (code === '40001' || code === '40P01') {
    return {
      status: 409,
      code: 'conflict_retry',
      detail: 'Two changes to the same record collided. Nothing was saved; try again.',
    };
  }
  if (code.startsWith('22')) {
    return {
      status: 400,
      code: 'invalid_value',
      detail:
        'A value in the request is not valid for its field (out of range, or the wrong form).',
    };
  }
  return null;
}
