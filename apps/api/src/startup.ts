/**
 * Pure helpers for the App Service start-up entry (`azureStart.ts`), kept apart from it so they can be
 * unit-tested: that file runs migrations at import time.
 */

/**
 * Whether to load the synthetic data set at start-up (SEED_SYNTHETIC_DATA=true, set on the test
 * environment only). Refused outright when this deployment says it is production: fake users, customers
 * and quotes must never be seeded beside real ones (CLAUDE.md rule 8; B-22 purged them from prod).
 */
export function syntheticSeedRequested(env: NodeJS.ProcessEnv): boolean {
  const requested = env.SEED_SYNTHETIC_DATA === 'true';
  if (requested && env.APP_ENVIRONMENT === 'prod') {
    throw new Error(
      'SEED_SYNTHETIC_DATA=true is forbidden when APP_ENVIRONMENT=prod. Remove the setting: synthetic data is for the test environment only.',
    );
  }
  return requested;
}

const PG_CODE = /^[0-9A-Z]{5}$/;
/** Postgres error fields that name schema objects. Never `message` or `detail`: those can echo row data. */
const PG_OBJECT_FIELDS = [
  'schema_name',
  'table_name',
  'column_name',
  'constraint_name',
  'routine',
] as const;

/**
 * One line for the start-up log when database preparation fails: the error name, the Postgres code and
 * the schema objects involved (found on the error or anywhere in its `cause` chain: drizzle wraps the
 * driver's error). It deliberately carries no message text, which can quote the offending row.
 */
export function describeStartupError(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  // @ccq/db's MigrationsNotAppliedError: its message names migration tags only, never row data.
  if (err instanceof Error && name === 'MigrationsNotAppliedError') return `${name}: ${err.message}`;
  let cursor: unknown = err;
  for (let depth = 0; depth < 6 && cursor && typeof cursor === 'object'; depth++) {
    const e = cursor as Record<string, unknown>;
    if (typeof e.code === 'string' && PG_CODE.test(e.code)) {
      const objects = PG_OBJECT_FIELDS.flatMap((field) =>
        typeof e[field] === 'string' && e[field] !== '' ? [`${field}=${e[field]}`] : [],
      );
      return `${name} (${e.code})${objects.length > 0 ? ` ${objects.join(' ')}` : ''}`;
    }
    cursor = e.cause;
  }
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `${name} (${code})` : name;
}
