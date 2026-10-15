import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integrations',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
