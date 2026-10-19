import { defineConfig } from 'vitest/config';

// Integration tests: fastify.inject against a real Postgres (`ccq_test`).
// Locally: `docker compose up -d db`. In CI: the Postgres 16 service container.
export default defineConfig({
  test: {
    name: 'api:integration',
    include: ['test/**/*.int.test.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 60_000,
    // B-16: the streaming test collects garbage while it samples RSS, so it measures what the
    // upload holds, not what the collector hasn't reached yet.
    execArgv: ['--expose-gc'],
  },
});
