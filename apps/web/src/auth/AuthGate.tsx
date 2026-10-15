import type { PublicClientApplication } from '@azure/msal-browser';
import { InteractionStatus } from '@azure/msal-browser';
import { MsalProvider, useIsAuthenticated, useMsal } from '@azure/msal-react';
import type { AuthConfigResponse, DevPersona } from '@ccq/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { api, isApiError } from '@/lib/api';

import { AuthContext, type AuthContextValue } from './context';
import { createMsal } from './msal';
import { AuthErrorPage, LoadingPage, NoRolePage, SignInPage } from './pages';
import { DEV_PERSONA_STORAGE_KEY, meQueryKey } from './permissions';
import { devSession, entraSession, RedirectingError, setAuthSession } from './session';

/**
 * Wraps the app: unauthenticated users get the branded sign-in page; signed-in users have `/me`
 * loaded into the TanStack Query cache before anything else renders.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const config = useQuery({
    queryKey: ['auth-config'],
    queryFn: api.authConfig,
    staleTime: Infinity,
  });
  if (config.isPending) return <LoadingPage message="Loading…" />;
  if (config.isError) return <AuthErrorPage message={config.error.message} />;
  return config.data.authMode === 'dev' ? (
    <DevAuth personas={config.data.personas}>{children}</DevAuth>
  ) : (
    <EntraAuth config={config.data}>{children}</EntraAuth>
  );
}

type EntraConfig = Extract<AuthConfigResponse, { authMode: 'entra' }>;

function EntraAuth({ config, children }: { config: EntraConfig; children: ReactNode }) {
  const msal = useQuery({
    queryKey: ['msal', config.tenantId, config.spaClientId],
    queryFn: () => createMsal(config),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  if (msal.isPending) return <LoadingPage />;
  if (msal.isError) return <AuthErrorPage message={msal.error.message} />;
  return (
    <MsalProvider instance={msal.data}>
      <EntraSignedIn pca={msal.data} apiScope={config.apiScope}>
        {children}
      </EntraSignedIn>
    </MsalProvider>
  );
}

function EntraSignedIn({
  pca,
  apiScope,
  children,
}: {
  pca: PublicClientApplication;
  apiScope: string;
  children: ReactNode;
}) {
  const isAuthenticated = useIsAuthenticated();
  const { inProgress } = useMsal();
  const [redirecting, setRedirecting] = useState(false);
  const value = useMemo<AuthContextValue>(() => {
    const session = entraSession(pca, apiScope);
    setAuthSession(session);
    return { session };
  }, [pca, apiScope]);

  if (!isAuthenticated) {
    if (inProgress !== InteractionStatus.None && inProgress !== InteractionStatus.Startup) {
      return <LoadingPage />;
    }
    return (
      <SignInPage
        busy={redirecting}
        onSignIn={() => {
          setRedirecting(true);
          void value.session.signIn();
        }}
      />
    );
  }
  return (
    <AuthContext.Provider value={value}>
      <MeLoader>{children}</MeLoader>
    </AuthContext.Provider>
  );
}

function readPersona(personas: DevPersona[]): string {
  try {
    const stored = sessionStorage.getItem(DEV_PERSONA_STORAGE_KEY);
    if (stored && personas.some((p) => p.key === stored)) return stored;
  } catch {
    // storage blocked: fall through to the default persona
  }
  return personas[0]?.key ?? 'kam';
}

function DevAuth({ personas, children }: { personas: DevPersona[]; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [persona, setPersonaState] = useState(() => readPersona(personas));
  const [session] = useState(() => {
    const s = devSession(persona);
    setAuthSession(s);
    return s;
  });

  const setPersona = useCallback(
    (key: string) => {
      try {
        sessionStorage.setItem(DEV_PERSONA_STORAGE_KEY, key);
      } catch {
        // per-tab convenience only
      }
      session.setPersona(key);
      setPersonaState(key);
      // Everything cached belongs to the previous persona.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth-config' });
    },
    [queryClient, session],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ session, dev: { personas, persona, setPersona } }),
    [session, personas, persona, setPersona],
  );
  return (
    <AuthContext.Provider value={value}>
      <MeLoader>{children}</MeLoader>
    </AuthContext.Provider>
  );
}

function MeLoader({ children }: { children: ReactNode }) {
  const me = useQuery({
    queryKey: meQueryKey,
    queryFn: api.me,
    staleTime: 5 * 60_000,
    retry: (count, err) => !isApiError(err) && !(err instanceof RedirectingError) && count < 2,
  });
  if (me.isPending) return <LoadingPage />;
  if (me.isError) {
    const err = me.error;
    if (err instanceof RedirectingError) return <LoadingPage message={err.message} />;
    if (isApiError(err, 403)) return <NoRolePage detail={err.problem.detail} />;
    if (isApiError(err, 401))
      return <AuthErrorPage message="Your session has expired. Sign in again." />;
    return <AuthErrorPage message={err.message} />;
  }
  return <>{children}</>;
}
