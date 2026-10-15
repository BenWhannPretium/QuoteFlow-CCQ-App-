import {
  BrowserCacheLocation,
  PublicClientApplication,
  type Configuration,
} from '@azure/msal-browser';
import type { AuthConfigResponse } from '@ccq/contracts';

type EntraConfig = Extract<AuthConfigResponse, { authMode: 'entra' }>;

/**
 * Auth code + PKCE with the redirect flow (works on mobile Safari, where popups are blocked) and a
 * sessionStorage cache (tokens don't outlive the tab). The redirect URI is the app origin, which
 * must be registered on the SPA app registration.
 */
export function msalConfiguration(cfg: EntraConfig, origin: string): Configuration {
  return {
    auth: {
      clientId: cfg.spaClientId,
      authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
      redirectUri: origin,
      postLogoutRedirectUri: origin,
    },
    cache: { cacheLocation: BrowserCacheLocation.SessionStorage },
  };
}

/** Create, initialise and complete any pending redirect; picks the active account. */
export async function createMsal(cfg: EntraConfig): Promise<PublicClientApplication> {
  const pca = new PublicClientApplication(msalConfiguration(cfg, window.location.origin));
  await pca.initialize();
  const result = await pca.handleRedirectPromise();
  const account = result?.account ?? pca.getActiveAccount() ?? pca.getAllAccounts()[0];
  if (account) pca.setActiveAccount(account);
  return pca;
}
