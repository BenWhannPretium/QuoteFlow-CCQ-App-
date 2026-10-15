import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AuthGate } from './auth';
import { Toaster } from './components/Toaster';
import { createQueryClient } from './lib/query-client';
import { routeTree } from './routeTree.gen';
import { RouteError } from './shell/RouteError';
import { ThemeProvider } from './theme/ThemeProvider';
import './index.css';

const queryClient = createQueryClient();

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  // Errors in a page render inside the shell, next to the navigation.
  defaultErrorComponent: RouteError,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element missing from index.html');

createRoot(rootEl).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {/* Sign-in (MSAL redirect or dev persona) and GET /me before any route renders. */}
        <AuthGate>
          <RouterProvider router={router} />
        </AuthGate>
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
