import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config';

const base = {
  DATABASE_URL: 'postgres://ccq:ccq@localhost:5432/ccq',
  APP_BASE_URL: 'http://localhost:5173',
};

describe('loadConfig', () => {
  it('accepts a minimal dev config and applies defaults', () => {
    const c = loadConfig({ ...base, AUTH_MODE: 'dev' });
    expect(c.NODE_ENV).toBe('development');
    expect(c.PORT).toBe(3000);
    expect(c.GIT_SHA).toBe('dev');
  });

  it('treats blank values as unset', () => {
    const c = loadConfig({ ...base, AUTH_MODE: 'dev', ENTRA_TENANT_ID: '', PORT: ' ' });
    expect(c.ENTRA_TENANT_ID).toBeUndefined();
    expect(c.PORT).toBe(3000);
  });

  it('refuses AUTH_MODE=dev with NODE_ENV=production', () => {
    expect(() => loadConfig({ ...base, AUTH_MODE: 'dev', NODE_ENV: 'production' })).toThrow(
      /AUTH_MODE=dev is forbidden when NODE_ENV=production/,
    );
  });

  it('requires Entra settings when AUTH_MODE=entra', () => {
    try {
      loadConfig({ ...base, AUTH_MODE: 'entra' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).issues.join('\n')).toMatch(/ENTRA_TENANT_ID/);
      expect((err as ConfigError).issues.join('\n')).toMatch(/ENTRA_API_AUDIENCE/);
    }
  });

  it('accepts production with Entra', () => {
    const c = loadConfig({
      ...base,
      NODE_ENV: 'production',
      AUTH_MODE: 'entra',
      ENTRA_TENANT_ID: '00000000-0000-0000-0000-000000000000',
      ENTRA_API_AUDIENCE: 'api://quoteflow',
    });
    expect(c.AUTH_MODE).toBe('entra');
  });

  it('rejects a non-postgres DATABASE_URL and a missing AUTH_MODE', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: 'mysql://x@y/z' })).toThrow(ConfigError);
  });
});
