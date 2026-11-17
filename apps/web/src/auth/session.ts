import {
  type AccountInfo,
  BrowserAuthError,
  InteractionRequiredAuthError,
  type IPublicClientApplication,
  type RedirectRequest,
} from '@azure/msal-browser';
import { DEV_USER_HEADER } from '@ccq/contracts';

/** How the API client authenticates. Set once by <AuthGate>, before any authenticated query runs. */
export interface AuthSession {
  mode: 'entra' | 'dev';
  /** Headers for an API call. `forceRefresh` skips cached tokens (used once after a 401). */
  headers(opts?: { forceRefresh?: boolean }): Promise<Record<string, string>>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}

let current: AuthSession | null = null;

export const setAuthSession = (session: AuthSession | null) => {
  current = session;
};
export const getAuthSession = () => current;

/** Thrown while the browser is navigating to Entra; callers just stop. */
export class RedirectingError extends Error {
  constructor() {
    super('Redirecting to Microsoft sign-in…');
    this.name = 'RedirectingError';
  }
}

/**
 * MSAL's code for "the hidden-iframe renewal could not complete". Once the SPA's refresh token has
 * expired (24 hours: a tab left open overnight) MSAL falls back to that iframe; the app forbids being
 * framed (CSP `frame-ancestors 'none'`), so the wait ends in `timed_out` after about ten seconds, not in
 * an InteractionRequiredAuthError. From `acquireTokenSilent`, msal-browser 5.23 throws this code only
 * there, after the refresh token has already failed: a plain network stall does not produce it.
 */
const SILENT_RENEWAL_FAILED = new Set(['timed_out']);

/** How long after a sign-in redirect another one is refused, so a redirect that does not help cannot loop. */
const REDIRECT_GUARD_MS = 60_000;
const REDIRECT_GUARD_KEY = 'ccq.signInRedirectAt';

/** Whether a sign-in redirect was started from this tab within the guard window. */
export function redirectedRecently(storage: Pick<Storage, 'getItem'>, now: number): boolean {
  const at = Number(storage.getItem(REDIRECT_GUARD_KEY));
  return Number.isFinite(at) && at > 0 && now - at < REDIRECT_GUARD_MS;
}

/**
 * Whether a failed silent token request means "send the user to sign in". Without the second case the
 * error was rethrown: every save showed a raw MSAL message, and a reload ended on "Can't reach
 * QuoteFlow" until the tab was closed.
 */
export function needsInteractiveSignIn(err: unknown): boolean {
  if (err instanceof InteractionRequiredAuthError) return true;
  return err instanceof BrowserAuthError && SILENT_RENEWAL_FAILED.has(err.errorCode);
}

/** Entra: silent token for `api://…/access_as_user`, redirect when interaction is required. */
export function entraSession(pca: IPublicClientApplication, apiScope: string): AuthSession {
  const request: RedirectRequest = { scopes: [apiScope] };
  // One redirect for the whole page. Every query on screen fails the same way at the same moment, and
  // MSAL refuses a second interaction while one is in progress (`interaction_in_progress`, which reached
  // the user as a raw toast before the page navigated).
  let redirecting: Promise<void> | null = null;
  const redirectToSignIn = (account: AccountInfo) => {
    if (!redirecting) {
      try {
        sessionStorage.setItem(REDIRECT_GUARD_KEY, String(Date.now()));
      } catch {
        // Storage unavailable: the redirect still goes ahead, without the loop guard.
      }
      redirecting = pca.acquireTokenRedirect({ ...request, account }).catch((err: unknown) => {
        // The redirect never started (`interaction_in_progress`, a network blip while MSAL read the
        // authority): the page is still here. Forget the attempt, or every later request in this tab
        // would get this same rejection until a reload; and lift the loop guard, which is about a
        // redirect that came back without helping, not one that never left.
        redirecting = null;
        try {
          sessionStorage.removeItem(REDIRECT_GUARD_KEY);
        } catch {
          // Storage unavailable: nothing was recorded.
        }
        throw err;
      });
    }
    return redirecting;
  };
  const guardTripped = () => {
    try {
      return redirectedRecently(sessionStorage, Date.now());
    } catch {
      return false;
    }
  };
  return {
    mode: 'entra',
    async headers({ forceRefresh = false } = {}) {
      const account = pca.getActiveAccount() ?? pca.getAllAccounts()[0];
      if (!account) {
        await pca.loginRedirect(request);
        throw new RedirectingError();
      }
      try {
        const result = await pca.acquireTokenSilent({ ...request, account, forceRefresh });
        return { authorization: `Bearer ${result.accessToken}` };
      } catch (err) {
        // Not straight after a redirect: if signing in again did not cure it, a second trip would not
        // either, and the page would bounce to Microsoft and back for good. Show the error instead.
        if (needsInteractiveSignIn(err) && (redirecting || !guardTripped())) {
          await redirectToSignIn(account);
          throw new RedirectingError();
        }
        throw err;
      }
    },
    signIn: () => pca.loginRedirect(request),
    signOut: () => pca.logoutRedirect({ account: pca.getActiveAccount() }),
  };
}

/** AUTH_MODE=dev: the persona header. Never used against an Entra-mode API. */
export function devSession(
  initialPersona: string,
): AuthSession & { setPersona(key: string): void } {
  let persona = initialPersona;
  return {
    mode: 'dev',
    headers: () => Promise.resolve({ [DEV_USER_HEADER]: persona }),
    setPersona: (key) => {
      persona = key;
    },
    signIn: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
  };
}
