import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  Outlet,
  type ErrorComponentProps,
} from '@tanstack/react-router';

import { ForbiddenPage, UserMenu } from '@/auth';
import { isApiError } from '@/lib/api';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  errorComponent: RootError,
});

function Shell({ children }: { children: React.ReactNode }) {
  // TODO(B-05): app shell (nav, Pretium theme, role-aware navigation).
  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <span className="font-semibold">QuoteFlow</span>
          <span className="text-muted-foreground ml-2 text-sm">Commercial Capital Quoting</span>
        </div>
        <UserMenu />
      </header>
      <main className="mx-auto max-w-3xl p-4">{children}</main>
    </div>
  );
}

function RootLayout() {
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

function RootError({ error }: ErrorComponentProps) {
  return (
    <Shell>
      {isApiError(error, 403) ? (
        <ForbiddenPage detail={error.problem.detail} />
      ) : (
        <p role="alert" className="text-destructive">
          Something went wrong: {error instanceof Error ? error.message : String(error)}
        </p>
      )}
    </Shell>
  );
}
