import { randomUUID } from 'node:crypto';

import type { Role } from '@ccq/domain';

import type { AppDeps } from './app';
import type { ProvisionedUser, RequestMeta, UserDirectory } from './auth/directory';
import { loadConfig, type AppConfig } from './config';

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://ccq:ccq@localhost:5432/ccq_test',
    AUTH_MODE: 'dev',
    APP_BASE_URL: 'http://localhost:5173',
    GIT_SHA: 'test-sha',
    // Tests change config rows directly; a cached /config/public would hide that.
    CONFIG_CACHE_SECONDS: '0',
    ...overrides,
  });
}

export function fakeDb(up = true): AppDeps['db'] {
  return { ping: () => Promise.resolve(up), close: () => Promise.resolve() };
}

/** In-memory UserDirectory for unit tests: same contract as the Postgres one. */
export function memoryDirectory(flags: Record<string, boolean> = { g1Enabled: true }) {
  const users = new Map<string, ProvisionedUser>();
  const signIns: { userId: string; at: Date; meta: RequestMeta }[] = [];
  let provisionCalls = 0;
  const directory: UserDirectory = {
    provision(identity) {
      provisionCalls += 1;
      const existing = users.get(identity.oid);
      const user: ProvisionedUser = {
        userId: existing?.userId ?? randomUUID(),
        displayName: identity.displayName,
        upn: identity.upn,
        email: identity.email,
        roles: [...identity.roles] as Role[],
        scope: existing?.scope ?? identity.dev?.scope ?? { type: 'all' },
      };
      users.set(identity.oid, user);
      return Promise.resolve(user);
    },
    recordSignIn(user, since, meta) {
      const recent = signIns.some((s) => s.userId === user.userId && s.at >= since);
      if (!recent) signIns.push({ userId: user.userId, at: new Date(), meta });
      return Promise.resolve(!recent);
    },
    featureFlags: () => Promise.resolve(flags),
  };
  return {
    directory,
    users,
    signIns,
    get provisionCalls() {
      return provisionCalls;
    },
  };
}
