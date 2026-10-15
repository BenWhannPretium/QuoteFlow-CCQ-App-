import type { DevPersona } from '@ccq/contracts';
import { createContext, useContext } from 'react';

import type { AuthSession } from './session';

export interface AuthContextValue {
  session: AuthSession;
  /** AUTH_MODE=dev only. */
  dev?: {
    personas: DevPersona[];
    persona: string;
    setPersona(key: string): void;
  };
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthGate>');
  return ctx;
}
