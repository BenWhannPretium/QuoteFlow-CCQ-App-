/**
 * The Postgres SQLSTATE of an error, found on the error itself or anywhere in its `cause` chain: drizzle
 * wraps the driver's error (`DrizzleQueryError` → `PostgresError`), so the code is rarely on the top
 * level.
 */
export function pgCode(err: unknown): string | undefined {
  return pgField(err, 'code', /^[0-9A-Z]{5}$/);
}

/** The constraint a violation names (`constraint_name` on the driver's error), if any. */
export function pgConstraint(err: unknown): string | undefined {
  return pgField(err, 'constraint_name', /./);
}

function pgField(err: unknown, field: string, shape: RegExp): string | undefined {
  let e: unknown = err;
  for (let depth = 0; depth < 8 && e && typeof e === 'object'; depth++) {
    const value = (e as Record<string, unknown>)[field];
    if (typeof value === 'string' && shape.test(value)) return value;
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
 * Data exceptions that mean "the value sent does not fit its column", and nothing else: too long
 * (22001), numeric out of range (22003), a bad or out-of-range date (22007, 22008), text that is not a
 * uuid or a number (22P02). The rest of class 22 (division by zero, a bad argument to a function, …)
 * comes from the server's own SQL and is a defect.
 */
const VALUE_DOES_NOT_FIT = new Set(['22001', '22003', '22007', '22008', '22P02']);

/**
 * The safety net for a database error no service mapped itself. These states are not server faults: two
 * requests collided, or a value the request schema let through does not fit its column. They used to
 * surface as a bare 500. The wording never quotes the database (its messages can echo row values).
 *
 * - 23505 unique violation: a concurrent change (a double click, two people on one record). 409.
 * - 40001 serialization failure, 40P01 deadlock: Postgres aborted one of two colliding transactions.
 *   409, safe to retry.
 * - the five codes above: the input does not fit. 400.
 *
 * Anything else stays a 500, because it is a defect or an outage and must show up as one (the only
 * alert on the web app counts 5xx responses): a NOT NULL, CHECK or foreign-key violation, the rest of
 * class 22, a missing relation, a lost connection.
 */
export function pgProblem(err: unknown): PgProblem | null {
  const code = pgCode(err);
  if (!code) return null;
  if (code === '23505') {
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
  if (VALUE_DOES_NOT_FIT.has(code)) {
    return {
      status: 400,
      code: 'invalid_value',
      detail:
        'A value in the request is not valid for its field (out of range, or the wrong form).',
    };
  }
  return null;
}
