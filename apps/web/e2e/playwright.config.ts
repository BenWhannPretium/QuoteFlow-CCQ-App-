import { defineConfig, devices } from '@playwright/test';

// Smoke: run the production API (which serves the built SPA) and drive it with Chromium.
// Requires `pnpm build` and a migrated DATABASE_URL.
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ../../api/dist/server.js',
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      NODE_ENV: 'production',
      PORT: String(port),
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://ccq:ccq@localhost:5432/ccq',
      // Entra values are placeholders: B-01 has no authenticated routes yet.
      AUTH_MODE: 'entra',
      ENTRA_TENANT_ID: '00000000-0000-0000-0000-000000000000',
      ENTRA_API_AUDIENCE: 'api://quoteflow-e2e',
      APP_BASE_URL: baseURL,
      GIT_SHA: process.env.GIT_SHA ?? 'e2e',
      LOG_LEVEL: 'warn',
    },
  },
});
