import { createDb, type DbClient } from '@ccq/db';
import { dropAll, ensureDatabase, runMigrations } from '@ccq/db/migrate';
import { seedConfig, seedSynthetic } from '@ccq/db/seeds';

import { DEFAULT_TEST_DATABASE_URL } from './global-setup';

/**
 * A dedicated database for the Salesforce tests, rebuilt per file: migrated, config-seeded and loaded
 * with the synthetic data (quotes linked to the fixture's opportunities). Isolated from `ccq_test`
 * so other files' integration runs can't move the sync watermark.
 */
export async function freshSfDatabase(suffix: string): Promise<{ url: string; client: DbClient }> {
  const base = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL);
  base.pathname = `${base.pathname}_${suffix}`;
  const url = base.toString();
  await ensureDatabase(url);
  await dropAll(url);
  await runMigrations(url);
  const client = createDb(url);
  await client.db.transaction(async (tx) => {
    await seedConfig(tx);
    await seedSynthetic(tx);
  });
  return { url, client };
}
