import { defineConfig } from 'vitest/config';

// FB-28: tests for the shell scripts in this folder (run by the root `pnpm test`).
export default defineConfig({
  test: {
    name: 'scripts',
    root: import.meta.dirname,
    include: ['**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
