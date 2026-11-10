import { createDb } from '../client';
import { redactUrl, requireDatabaseUrl } from './env';
import { fb12Report, renderFb12Report } from '../fb12Report';

/**
 * FB-12 `pnpm --filter @ccq/db fb12:report`: quotes on retired market codes (with the market they would
 * move to) and what migration 0037 does to this database's market list and draft scoring model. Read only;
 * the report goes to stdout (quote numbers only).
 */
const url = requireDatabaseUrl();
const client = createDb(url, { max: 1 });
try {
  const report = await fb12Report(client.db);
  process.stdout.write(renderFb12Report(report, new Date()));
  console.warn(`FB-12 report read ${redactUrl(url)}; nothing was changed`);
} finally {
  await client.close();
}
