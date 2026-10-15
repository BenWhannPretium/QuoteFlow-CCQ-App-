import { runSeed } from '../src/cli/seed';
import { dropAll, ensureDatabase, runMigrations } from '../src/migrate';

const DEFAULT_TEST_DATABASE_URL = 'postgres://ccq:ccq@localhost:5432/ccq_test';

/** The db package's own database, so it never races the API's integration tests on `ccq_test`. */
export function dbTestUrl(): string {
  const url = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL);
  url.pathname = `${url.pathname}_db`;
  return url.toString();
}

export default async function setup(): Promise<void> {
  const url = dbTestUrl();
  process.env.DB_TEST_URL = url;
  try {
    await ensureDatabase(url);
    await dropAll(url);
    await runMigrations(url);
    await runSeed(url, { synthetic: true });
  } catch (err) {
    throw new Error(
      `DB integration setup failed for ${new URL(url).host}. Is Postgres running? (\`docker compose up -d db\`)\n${String(err)}`,
    );
  }
}
