import { defineConfig, devices } from '@playwright/test';

/**
 * Two stacks, both on the production web build (`pnpm build` first) and a migrated, seeded DB:
 *
 * - smoke: the production API (AUTH_MODE=entra) serving the SPA, as deployed. Signed-out flows only.
 * - shell / mobile: `vite preview` proxying /api to an API in AUTH_MODE=dev, so tests sign in as
 *   each synthetic persona. The API refuses AUTH_MODE=dev under NODE_ENV=production, which is why
 *   this stack can't reuse the smoke server.
 */
const smokePort = Number(process.env.E2E_PORT ?? 3100);
const devApiPort = Number(process.env.E2E_DEV_API_PORT ?? 3101);
const webPort = Number(process.env.E2E_WEB_PORT ?? 4173);
const smokeURL = `http://localhost:${smokePort}`;
const webURL = `http://localhost:${webPort}`;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://ccq:ccq@localhost:5432/ccq';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'smoke',
      testMatch: 'smoke.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: smokeURL },
    },
    {
      name: 'shell',
      testMatch: [
        'shell.spec.ts',
        'a11y.spec.ts',
        'admin-integrations.spec.ts',
        'intake.spec.ts',
        'g1.spec.ts',
      ],
      use: { ...devices['Desktop Chrome'], baseURL: webURL },
    },
    {
      name: 'mobile',
      testMatch: 'mobile.spec.ts',
      // 390 × 844 (iPhone 12–14 class) on Chromium.
      use: {
        ...devices['Desktop Chrome'],
        baseURL: webURL,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: 'node ../../api/dist/server.js',
      url: `${smokeURL}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        NODE_ENV: 'production',
        PORT: String(smokePort),
        DATABASE_URL: databaseUrl,
        // Placeholder Entra values: the smoke covers the signed-out experience only. MSAL never
        // contacts Entra until the user clicks "Sign in".
        AUTH_MODE: 'entra',
        ENTRA_TENANT_ID: '00000000-0000-0000-0000-000000000000',
        ENTRA_API_AUDIENCE: 'api://quoteflow-e2e',
        ENTRA_SPA_CLIENT_ID: '00000000-0000-0000-0000-0000000000e2',
        APP_BASE_URL: smokeURL,
        GIT_SHA: process.env.GIT_SHA ?? 'e2e',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: 'node ../../api/dist/server.js',
      url: `http://localhost:${devApiPort}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(devApiPort),
        DATABASE_URL: databaseUrl,
        AUTH_MODE: 'dev',
        APP_BASE_URL: webURL,
        GIT_SHA: process.env.GIT_SHA ?? 'e2e',
        RATE_LIMIT_MAX: '100000',
      },
    },
    {
      command: `pnpm exec vite preview --port ${webPort} --strictPort`,
      cwd: '..',
      url: webURL,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { VITE_API_PROXY_TARGET: `http://localhost:${devApiPort}` },
    },
  ],
});
