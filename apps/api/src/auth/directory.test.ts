import { describe, expect, it } from 'vitest';

import { devIdentity, devPersonas } from './dev';
import {
  createIdentityService,
  defaultScopeFrom,
  PROVISION_CACHE_MS,
  SIGN_IN_WINDOW_MS,
} from './directory';
import { AuthError } from './identity';
import { memoryDirectory } from '../test-utils';

const at = (ms: number) => () => new Date(Date.UTC(2026, 9, 20) + ms);

describe('identity service', () => {
  it('caches provisioning for 5 minutes per oid', async () => {
    const mem = memoryDirectory();
    let t = 0;
    const svc = createIdentityService(mem.directory, { now: () => at(t)() });
    const who = devIdentity('kam');
    await svc.resolve(who, {});
    t = PROVISION_CACHE_MS - 1;
    await svc.resolve(who, {});
    expect(mem.provisionCalls).toBe(1);
    t = PROVISION_CACHE_MS;
    await svc.resolve(who, {});
    expect(mem.provisionCalls).toBe(2);
  });

  it('checks the sign-in audit once per 8 hours per user', async () => {
    const mem = memoryDirectory();
    let t = 0;
    const calls: Date[] = [];
    const svc = createIdentityService(
      {
        ...mem.directory,
        recordSignIn: (u, since, meta) => {
          calls.push(since);
          return mem.directory.recordSignIn(u, since, meta);
        },
      },
      { now: () => at(t)() },
    );
    await svc.resolve(devIdentity('pricing'), { ip: '10.0.0.1' });
    t = SIGN_IN_WINDOW_MS - 1;
    await svc.resolve(devIdentity('pricing'), {});
    expect(calls).toHaveLength(1);
    t = SIGN_IN_WINDOW_MS;
    await svc.resolve(devIdentity('pricing'), {});
    expect(calls).toHaveLength(2);
    expect(calls[1]!.getTime()).toBe(at(0)().getTime());
    expect(mem.signIns[0]!.meta).toEqual({ ip: '10.0.0.1' });
  });
});

describe('default scope setting', () => {
  it('only value-less scopes can be the default; anything else is all', () => {
    expect(defaultScopeFrom('all')).toEqual({ type: 'all' });
    expect(defaultScopeFrom('owner')).toEqual({ type: 'owner' });
    expect(defaultScopeFrom('region')).toEqual({ type: 'all' });
    expect(defaultScopeFrom(undefined)).toEqual({ type: 'all' });
  });
});

describe('dev personas', () => {
  it('one persona per role plus scoped and multi-role users, with stable fake oids', () => {
    const personas = devPersonas();
    const roles = new Set(personas.flatMap((p) => p.roles));
    for (const r of [
      'KAM',
      'SalesLeader',
      'EngLead',
      'Engineer',
      'Pricing',
      'Approver',
      'Leadership',
      'Admin',
    ]) {
      expect(roles.has(r)).toBe(true);
    }
    expect(personas.some((p) => p.roles.length > 1)).toBe(true);
    expect(personas.find((p) => p.key === 'kam-owner')?.scope).toEqual({ type: 'owner' });
    expect(devIdentity('kam').oid).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('rejects a missing or unknown persona', () => {
    expect(() => devIdentity(undefined)).toThrow(AuthError);
    expect(() => devIdentity('nobody')).toThrow(/unknown persona/);
  });
});
