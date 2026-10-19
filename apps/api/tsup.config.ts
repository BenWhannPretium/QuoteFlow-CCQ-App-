import { cpSync } from 'node:fs';

import { defineConfig } from 'tsup';

export default defineConfig({
  // azureStart: the App Service startup entry (migrate + config seed, then server). B-20.
  entry: ['src/server.ts', 'src/azureStart.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript source, so bundle them into the API build.
  noExternal: [/^@ccq\//],
  // azureStart runs the migrations from the deployed bundle, so ship the SQL beside it.
  onSuccess: async () => {
    cpSync('../../packages/db/migrations', 'dist/db/migrations', { recursive: true });
    cpSync('../../packages/db/sql', 'dist/db/sql', { recursive: true });
  },
});
