import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'domain',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test-utils.ts', 'src/**/index.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: { lines: 95 },
    },
  },
});
