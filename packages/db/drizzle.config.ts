import { existsSync } from 'node:fs';

import { defineConfig } from 'drizzle-kit';

const rootEnv = new URL('../../.env', import.meta.url);
if (!process.env.DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://ccq:ccq@localhost:5432/ccq',
  },
  strict: true,
  verbose: true,
});
