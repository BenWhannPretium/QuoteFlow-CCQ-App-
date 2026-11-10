import { createDb } from '../client';
import { redactUrl, requireDatabaseUrl } from './env';
import { fb09Report, renderFb09Report } from '../fb09Report';

/**
 * FB-09 `pnpm --filter @ccq/db fb09:report`: quotes with a retired resin and quotes on a placeholder plant
 * (read only). Quote numbers only. Real quotes are never remapped by this step.
 */
const url = requireDatabaseUrl();
const client = createDb(url, { max: 1 });
try {
  process.stdout.write(renderFb09Report(await fb09Report(client.db), new Date()));
  console.warn(`FB-09 report read ${redactUrl(url)}; nothing was changed`);
} finally {
  await client.close();
}
