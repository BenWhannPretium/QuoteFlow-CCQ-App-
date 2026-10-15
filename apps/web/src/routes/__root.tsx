import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  // TODO(B-05): app shell (nav, Pretium theme, role switcher in AUTH_MODE=dev).
  return (
    <div className="min-h-screen">
      <header className="border-b px-4 py-3">
        <span className="font-semibold">QuoteFlow</span>
        <span className="text-muted-foreground ml-2 text-sm">Commercial Capital Quoting</span>
      </header>
      <main className="mx-auto max-w-3xl p-4">
        <Outlet />
      </main>
    </div>
  );
}
