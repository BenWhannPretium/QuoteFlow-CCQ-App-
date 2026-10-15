import { defineConfig } from 'vitest/config';

// Integration tests against a real Postgres: a dedicated `<TEST_DATABASE_URL db>_db` database,
// reset, migrated and seeded (config + synthetic) once per run. Locally: `docker compose up -d db`.
export default defineConfig({
  test: {
    name: 'db:integration',
    include: ['test/**/*.int.test.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
