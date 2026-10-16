import { createDb } from '@ccq/db';

import { buildApp } from './app';
import { ConfigError, loadConfig } from './config';

function fail(message: string): never {
  // Logger isn't configured yet; write a clear message and exit non-zero.
  console.error(`[quoteflow-api] refusing to start\n${message}`);
  process.exit(1);
}

let config;
try {
  config = loadConfig();
} catch (err) {
  fail(err instanceof ConfigError ? err.message : String(err));
}

const db = createDb(config.DATABASE_URL);
const app = await buildApp(config, { db });
// Fail fast: config errors and undeclared route permissions stop the boot here.
try {
  await app.ready();
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

const shutdown = (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  app.close().then(
    () => process.exit(0),
    (err: unknown) => {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    },
  );
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  app.log.fatal({ err }, 'failed to listen');
  process.exit(1);
}

// Background jobs start only once the server is listening (never in tests that build the app).
app.sfSync?.start();
app.validityExpiry?.start();
