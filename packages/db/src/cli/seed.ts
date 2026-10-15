import { seedConfig } from '../../seeds/config/index';
import { seedSynthetic } from '../../seeds/synthetic/index';
import { createDb } from '../client';
import { redactUrl, requireDatabaseUrl } from './env';

/**
 * `pnpm db:seed` loads the config seeds (idempotent, all provisional).
 * `pnpm db:seed --synthetic` also loads the synthetic data set (never real customers).
 */
export async function runSeed(url: string, { synthetic }: { synthetic: boolean }): Promise<void> {
  const client = createDb(url, { max: 1 });
  try {
    await client.db.transaction(async (tx) => {
      await seedConfig(tx);
      console.warn(
        'seed: config (workflow, role_permission, value lists, reason codes, settings, scoring v1, sf_stage_map)',
      );
      if (synthetic) {
        const result = await seedSynthetic(tx);
        const quotes =
          result.quotes === 'already-present'
            ? 'already present, skipped'
            : `${result.quotes.quotes} created`;
        console.warn(
          `seed: synthetic ${result.users} users, ${result.customers} customers, ${result.opportunities} opportunities, quotes ${quotes}`,
        );
      }
    });
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = requireDatabaseUrl();
  await runSeed(url, { synthetic: process.argv.includes('--synthetic') });
  console.warn(`seeded ${redactUrl(url)}`);
}
