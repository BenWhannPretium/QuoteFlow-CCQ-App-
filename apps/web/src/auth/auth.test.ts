import { BrowserAuthError, InteractionRequiredAuthError } from '@azure/msal-browser';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api';

import { meErrorBlocksApp } from './me-gate';
import { msalConfiguration } from './msal';
import { canFromMe } from './permissions';
import {
  devSession,
  needsInteractiveSignIn,
  redirectedRecently,
  RedirectingError,
} from './session';

describe('msal configuration', () => {
  it('uses the tenant authority, origin redirect and sessionStorage', () => {
    const cfg = msalConfiguration(
      {
        authMode: 'entra',
        environment: 'test',
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

const apiError = (status: number) =>
  new ApiError({ type: 'about:blank', title: 'x', status, instance: '/api/v1/me' });

describe('needsInteractiveSignIn (a failed silent token request)', () => {
  it('sends the user to sign in when Entra asks for interaction', () => {
    expect(needsInteractiveSignIn(new InteractionRequiredAuthError('login_required', 'test'))).toBe(
      true,
    );
  });

  it('also when the hidden-iframe renewal cannot complete (a tab left open past 24 hours)', () => {
    expect(needsInteractiveSignIn(new BrowserAuthError('timed_out', 'test'))).toBe(true);
  });

  it('but not for anything else: a network failure is not a reason to leave the page', () => {
    expect(needsInteractiveSignIn(new BrowserAuthError('no_network_connectivity', 'test'))).toBe(
      false,
    );
    expect(needsInteractiveSignIn(new BrowserAuthError('interaction_in_progress', 'test'))).toBe(
      false,
    );
    expect(needsInteractiveSignIn(new Error('timed_out'))).toBe(false);
    expect(needsInteractiveSignIn(undefined)).toBe(false);
  });
});

describe('redirectedRecently (the sign-in redirect loop guard)', () => {
  const storage = (value: string | null) => ({ getItem: () => value });
  const now = 1_800_000_000_000;

  it('is true for a minute after a redirect was started from this tab', () => {
    expect(redirectedRecently(storage(String(now - 5_000)), now)).toBe(true);
    expect(redirectedRecently(storage(String(now - 59_000)), now)).toBe(true);
  });

  it('is false once the minute has passed, or when nothing was recorded', () => {
    expect(redirectedRecently(storage(String(now - 61_000)), now)).toBe(false);
    expect(redirectedRecently(storage(null), now)).toBe(false);
    expect(redirectedRecently(storage('not a number'), now)).toBe(false);
  });
});

describe('meErrorBlocksApp (a failed /me query)', () => {
  it('always takes the page when there is no identity yet (first load)', () => {
    expect(meErrorBlocksApp(false, new Error('Failed to fetch'))).toBe(true);
    expect(meErrorBlocksApp(false, apiError(500))).toBe(true);
    expect(meErrorBlocksApp(false, apiError(403))).toBe(true);
  });

  it('keeps the app on screen when a background refetch hits a blip', () => {
    expect(meErrorBlocksApp(true, new Error('Failed to fetch'))).toBe(false);
    expect(meErrorBlocksApp(true, apiError(502))).toBe(false);
    expect(meErrorBlocksApp(true, apiError(429))).toBe(false);
  });

  it('still takes the page when the identity itself is no longer good', () => {
    expect(meErrorBlocksApp(true, apiError(401))).toBe(true);
    expect(meErrorBlocksApp(true, apiError(403))).toBe(true);
    expect(meErrorBlocksApp(true, new RedirectingError())).toBe(true);
  });
});
