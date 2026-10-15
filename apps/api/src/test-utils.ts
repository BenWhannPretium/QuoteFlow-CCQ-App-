import type { AppDeps } from './app';
import { loadConfig, type AppConfig } from './config';

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://ccq:ccq@localhost:5432/ccq_test',
    AUTH_MODE: 'dev',
    APP_BASE_URL: 'http://localhost:5173',
    GIT_SHA: 'test-sha',
    ...overrides,
  });
}

export function fakeDb(up = true): AppDeps['db'] {
  return { ping: () => Promise.resolve(up), close: () => Promise.resolve() };
}
