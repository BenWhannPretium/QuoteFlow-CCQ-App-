import type { MeResponse } from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { api } from '@/lib/api';

import { ForbiddenPage } from './pages';
import { canFromMe, meQueryKey, type PermissionName } from './permissions';

/** The signed-in user from `GET /me` (loaded by <AuthGate> before the app renders). */
export function useCurrentUser(): MeResponse {
  const { data } = useQuery({ queryKey: meQueryKey, queryFn: api.me, staleTime: 5 * 60_000 });
  if (!data) throw new Error('useCurrentUser must be used inside <AuthGate>');
  return data;
}

/** UI hint only: the API enforces every permission. */
export function useCan(permission: PermissionName): boolean {
  return canFromMe(useCurrentUser(), permission);
}

export function RequirePermission({
  permission,
  fallback,
  children,
}: {
  permission: PermissionName;
  /** Rendered when the user lacks the permission. Defaults to the 403 page; pass null to hide. */
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const allowed = useCan(permission);
  if (allowed) return <>{children}</>;
  return <>{fallback === undefined ? <ForbiddenPage /> : fallback}</>;
}
