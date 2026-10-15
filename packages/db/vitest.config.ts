import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'db',
    include: ['src/**/*.test.ts', 'seeds/**/*.test.ts'],
    environment: 'node',
  },
});
