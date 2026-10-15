import { defineConfig } from 'vitest/config';

// Vitest "workspace": `pnpm vitest` from the root runs every package's unit project at once.
// Turbo still runs each package's own `test` script for caching in `pnpm test`.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/api', 'apps/web'],
  },
});
