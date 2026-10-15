import { useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { useCurrentUser } from '@/auth';
import { TooltipProvider } from '@/components/ui/tooltip';

import { BottomNav } from './BottomNav';
import { Header } from './Header';
import { navItemsFor } from './nav';
import { SideNav } from './SideNav';

/**
 * Skip link, green header, left rail (desktop) or bottom tabs (≤ 640 px), and <main>.
 * 16 px side gutters on mobile; bottom padding clears the tab bar.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useCurrentUser();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const items = navItemsFor(me);
  return (
    <TooltipProvider delayDuration={300}>
      <div className="bg-background min-h-dvh">
        <a
          href="#main"
          className="bg-action text-action-foreground sr-only z-[70] rounded-md px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to main content
        </a>
        <Header />
        <div className="flex">
          <SideNav items={items} pathname={pathname} />
          <main
            id="main"
            tabIndex={-1}
            className="min-w-0 flex-1 px-4 pt-6 pb-28 sm:px-6 sm:pb-10 lg:px-8"
          >
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
        <BottomNav items={items} pathname={pathname} />
      </div>
    </TooltipProvider>
  );
}
