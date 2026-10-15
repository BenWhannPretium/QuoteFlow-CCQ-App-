import { runMigrations } from '../migrate';
import { redactUrl, requireDatabaseUrl } from './env';

const url = requireDatabaseUrl();
await runMigrations(url);
console.warn(`migrations applied to ${redactUrl(url)}`);
