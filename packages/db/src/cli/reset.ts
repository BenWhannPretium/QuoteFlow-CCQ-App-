import { dropAll, runMigrations } from '../migrate';
import { redactUrl, requireDatabaseUrl } from './env';
import { runSeed } from './seed';

const url = requireDatabaseUrl();
if (process.env.NODE_ENV === 'production') {
  console.error('db:reset is disabled when NODE_ENV=production');
  process.exit(1);
}
await dropAll(url);
await runMigrations(url);
console.warn(`database reset and migrated: ${redactUrl(url)}`);
// --demo: the 12-quote demo set (one per stage) instead of the 150-quote synthetic set.
const demo = process.argv.includes('--demo');
const synthetic = !demo && !process.argv.includes('--no-synthetic');
await runSeed(url, { synthetic, demo });
console.warn(`seeded config${synthetic ? ' + synthetic data' : ''}${demo ? ' + demo quotes' : ''}`);
