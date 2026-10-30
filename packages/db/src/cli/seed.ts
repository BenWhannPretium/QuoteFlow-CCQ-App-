import { pathToFileURL } from 'node:url';

import { seedConfig } from '../../seeds/config/index';
import { seedDemo } from '../../seeds/demo/index';
import { seedSynthetic } from '../../seeds/synthetic/index';
import { createDb } from '../client';
import { redactUrl, requireDatabaseUrl } from './env';

/**
 * `pnpm db:seed` loads the config seeds (idempotent, all provisional).
 * `pnpm db:seed --synthetic` also loads the synthetic data set (never real customers).
 * `pnpm db:seed --demo` also loads the demo set: one fake quote per stage, for walkthroughs.
 */
export async function runSeed(
  url: string,
  { synthetic, demo = false }: { synthetic: boolean; demo?: boolean },
): Promise<void> {
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
      if (demo) {
        const result = await seedDemo(tx);
        const quotes =
          result.quotes === 'already-present'
            ? 'already present, skipped'
            : `${result.quotes.quotes} created`;
        console.warn(`seed: demo ${result.opportunities} opportunities, quotes ${quotes}`);
      }
    });
  } finally {
    await client.close();
  }
}

// pathToFileURL, not a `file://` template: on Windows argv[1] is `C:\…`, which never matched.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = requireDatabaseUrl();
  await runSeed(url, {
    synthetic: process.argv.includes('--synthetic'),
    demo: process.argv.includes('--demo'),
  });
  console.warn(`seeded ${redactUrl(url)}`);
}
