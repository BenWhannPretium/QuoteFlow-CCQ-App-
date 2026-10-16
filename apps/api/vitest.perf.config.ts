import { defineConfig } from 'vitest/config';

// B-14 performance check (opt-in, not part of `pnpm verify`): `pnpm --filter @ccq/api test:perf`.
// Builds its own `<TEST_DATABASE_URL>_perf` database with ≥ 500 open quotes and leaves it in place.
export default defineConfig({
  test: {
    name: 'api:perf',
    include: ['test/perf/**/*.perf.test.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
