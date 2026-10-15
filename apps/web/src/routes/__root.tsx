import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  Outlet,
  type ErrorComponentProps,
} from '@tanstack/react-router';

import { NotFoundPage } from '@/auth';
import { AppShell } from '@/shell/AppShell';
import { RouteError } from '@/shell/RouteError';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  errorComponent: RootError,
  notFoundComponent: NotFound,
});

function RootLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function RootError(props: ErrorComponentProps) {
  return (
    <AppShell>
      <RouteError {...props} />
    </AppShell>
  );
}

function NotFound() {
  useDocumentTitle('Page not found');
  return <NotFoundPage />;
}
