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
      expect((err as ConfigError).issues.join('\n')).toMatch(/ENTRA_SPA_CLIENT_ID/);
    }
  });

  it('accepts production with Entra', () => {
    const c = loadConfig({
      ...base,
      NODE_ENV: 'production',
      AUTH_MODE: 'entra',
      ENTRA_TENANT_ID: '00000000-0000-0000-0000-000000000000',
      ENTRA_API_AUDIENCE: 'api://quoteflow',
      ENTRA_SPA_CLIENT_ID: '11111111-1111-1111-1111-111111111111',
    });
    expect(c.AUTH_MODE).toBe('entra');
    expect(c.ENTRA_API_SCOPE).toBe('access_as_user');
  });

  it('rejects a non-postgres DATABASE_URL and a missing AUTH_MODE', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: 'mysql://x@y/z' })).toThrow(ConfigError);
  });
});

describe('Salesforce config', () => {
  const base = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://ccq:ccq@localhost:5432/ccq',
    AUTH_MODE: 'dev',
    APP_BASE_URL: 'http://localhost:5173',
  };

  it('defaults to the fake reader, the UAT login URL and a 15-minute sync', () => {
    const config = loadConfig(base);
    expect(config.SF_MODE).toBe('fake');
    expect(config.SF_LOGIN_URL).toBe('https://test.salesforce.com');
    expect(config.SF_SYNC_INTERVAL_MINUTES).toBe(15);
  });

  it('SF_MODE=live requires the connected app, user and key', () => {
    expect(() => loadConfig({ ...base, SF_MODE: 'live' })).toThrow(
      /SF_CLIENT_ID is required when SF_MODE=live[\s\S]*SF_USERNAME[\s\S]*SF_PRIVATE_KEY/,
    );
    expect(
      loadConfig({
        ...base,
        SF_MODE: 'live',
        SF_CLIENT_ID: 'key',
        SF_USERNAME: 'integration@pretiumpkg.com.uat',
        SF_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\n...',
      }).SF_MODE,
    ).toBe('live');
  });

  it('the login URL must be https', () => {
    expect(() => loadConfig({ ...base, SF_LOGIN_URL: 'http://test.salesforce.com' })).toThrow(
      /SF_LOGIN_URL/,
    );
  });
});
