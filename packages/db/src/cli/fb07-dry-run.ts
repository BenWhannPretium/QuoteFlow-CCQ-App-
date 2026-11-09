import { createDb } from '../client';
import { redactUrl, requireDatabaseUrl } from './env';
import { fb07DryRun, renderFb07DryRun } from '../fb07DryRun';

/**
 * FB-07 `pnpm --filter @ccq/db fb07:dry-run`: what migration 0031 would do to this database (read only).
 * Run it before deploying FB-07, as the migration login; the report goes to stdout (quote numbers and
 * pricer names only).
 */
const url = requireDatabaseUrl();
const client = createDb(url, { max: 1 });
try {
  const report = await fb07DryRun(client.db);
  process.stdout.write(renderFb07DryRun(report, new Date()));
  console.warn(`FB-07 dry run read ${redactUrl(url)}; nothing was changed`);
} finally {
  await client.close();
}
