import { describe, expect, it } from 'vitest';

import { msalConfiguration } from './msal';
import { canFromMe } from './permissions';
import { devSession } from './session';

describe('msal configuration', () => {
  it('uses the tenant authority, origin redirect and sessionStorage', () => {
    const cfg = msalConfiguration(
      {
        authMode: 'entra',
        tenantId: 'tenant-1',
        spaClientId: 'spa-1',
        apiScope: 'api://x/access_as_user',
      },
      'https://ccq.example',
    );
    expect(cfg.auth).toMatchObject({
      clientId: 'spa-1',
      authority: 'https://login.microsoftonline.com/tenant-1',
      redirectUri: 'https://ccq.example',
    });
    expect(cfg.cache?.cacheLocation).toBe('sessionStorage');
  });
});

describe('dev session', () => {
  it('sends the current persona header', async () => {
    const s = devSession('kam');
    expect(await s.headers()).toEqual({ 'x-dev-user': 'kam' });
    s.setPersona('admin');
    expect(await s.headers()).toEqual({ 'x-dev-user': 'admin' });
  });
});

describe('canFromMe', () => {
  it('checks the /me permission list', () => {
    const me = {
      user: { id: 'x', displayName: 'x', upn: 'x', email: null },
      roles: ['Pricing'],
      permissions: ['quoting.edit'],
      scope: { type: 'all' as const },
      featureFlags: {},
      authMode: 'dev' as const,
    };
    expect(canFromMe(me, 'quoting.edit')).toBe(true);
    expect(canFromMe(me, 'gate.G4.decide')).toBe(false);
    expect(canFromMe(undefined, 'quoting.edit')).toBe(false);
  });
});
