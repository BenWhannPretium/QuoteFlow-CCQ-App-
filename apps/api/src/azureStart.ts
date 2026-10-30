/**
 * B-20: the App Service startup entry (`node apps/api/dist/azureStart.js`).
 *
 * Applies pending migrations and the config seeds, then starts the API. The config seeds are
 * idempotent and never overwrite a value an admin has edited (B-19), so running them on every start
 * keeps config in step with the code. The synthetic data set loads only when SEED_SYNTHETIC_DATA=true,
 * which is set on the **test** environment only (never production: B-22 purges synthetic data).
 * SEED_DEMO_DATA=true (test only too) loads the small demo set instead: one fake quote per stage,
 * for walkthroughs on an environment that otherwise has only live Salesforce data.
 *
 * One instance is assumed while migrating (the test plan is a single B1 instance); scale out only
 * after moving migrations to a deployment step.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDb } from '@ccq/db';
import { runMigrations } from '@ccq/db/migrate';
import { seedConfig, seedDemo, seedSynthetic } from '@ccq/db/seeds';

function fail(message: string): never {
  console.error(`[quoteflow-start] refusing to start\n${message}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail('DATABASE_URL is not set.');
// App Service leaves an unresolved Key Vault reference as the literal `@Microsoft.KeyVault(...)` text.
if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
  fail(
    'DATABASE_URL is not a postgres:// URL. If it is a Key Vault reference, it has not resolved: check the web app identity has "Key Vault Secrets User" on the vault, then restart.',
  );
}
const synthetic = process.env.SEED_SYNTHETIC_DATA === 'true';
const demo = process.env.SEED_DEMO_DATA === 'true';

// tsup copies packages/db/migrations and packages/db/sql next to this bundle (see tsup.config.ts).
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The package carries the commit it was built from (scripts/package-azure.sh). /health reports it, so
// the deploy smoke test can tell the new build from the one it replaces. An app setting still wins.
const shaFile = here('./GIT_SHA');
if (!process.env.GIT_SHA && existsSync(shaFile)) {
  const sha = readFileSync(shaFile, 'utf8').trim();
  if (sha) process.env.GIT_SHA = sha;
}

try {
  await runMigrations(databaseUrl, {
    migrationsDir: here('./db/migrations'),
    analyticsSqlDir: here('./db/sql/analytics'),
  });
  console.warn('[quoteflow-start] migrations applied');

  const client = createDb(databaseUrl, { max: 1 });
  try {
    await client.db.transaction(async (tx) => {
      await seedConfig(tx);
      if (synthetic) await seedSynthetic(tx);
      if (demo) await seedDemo(tx);
    });
  } finally {
    await client.close();
  }
  const extras = [synthetic && 'synthetic data', demo && 'demo quotes'].filter(Boolean).join(', ');
  console.warn(`[quoteflow-start] config seeded${extras ? ` (+ ${extras})` : ''}`);
} catch (err) {
  // Log the code only: Postgres messages can echo row data.
  const code = (err as { code?: string } | null)?.code;
  fail(`database preparation failed${code ? ` (${code})` : ''}: ${(err as Error).name}`);
}

// A computed specifier, so the bundler leaves server.js as its own entry instead of inlining it.
const serverEntry = new URL('./server.js', import.meta.url).href;
await import(serverEntry);
