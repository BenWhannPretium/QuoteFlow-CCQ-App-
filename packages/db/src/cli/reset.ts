import { dropAll, runMigrations } from '../migrate';
import { redactUrl, requireDatabaseUrl } from './env';

const url = requireDatabaseUrl();
if (process.env.NODE_ENV === 'production') {
  console.error('db:reset is disabled when NODE_ENV=production');
  process.exit(1);
}
await dropAll(url);
await runMigrations(url);
console.warn(`database reset and migrated: ${redactUrl(url)}`);
console.warn('run `pnpm db:seed` to load seed data');
