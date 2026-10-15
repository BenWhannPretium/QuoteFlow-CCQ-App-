import {
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

/** Entra: silent token for `api://…/access_as_user`, redirect when interaction is required. */
export function entraSession(pca: IPublicClientApplication, apiScope: string): AuthSession {
  const request: RedirectRequest = { scopes: [apiScope] };
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
        if (err instanceof InteractionRequiredAuthError) {
          await pca.acquireTokenRedirect({ ...request, account });
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
