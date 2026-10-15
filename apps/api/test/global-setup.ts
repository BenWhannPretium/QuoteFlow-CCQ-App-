import { ensureDatabase, runMigrations } from '@ccq/db/migrate';

export const DEFAULT_TEST_DATABASE_URL = 'postgres://ccq:ccq@localhost:5432/ccq_test';

/** Creates the `ccq_test` database (if needed) and applies migrations before integration tests. */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  process.env.TEST_DATABASE_URL = url;
  try {
    await ensureDatabase(url);
    await runMigrations(url);
  } catch (err) {
    throw new Error(
      `Integration DB setup failed for ${new URL(url).host}. Is Postgres running? ` +
        '(`docker compose up -d db`)\n' +
        String(err),
    );
  }
}
