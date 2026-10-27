import { useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { DevPersonaSwitcher, useCurrentUser } from '@/auth';
import { ReportIssueDialog, ReportIssueFooter } from '@/components/feedback/ReportIssue';
import { TooltipProvider } from '@/components/ui/tooltip';
import { usePublicConfig } from '@/config/public-config';

import { BottomNav } from './BottomNav';
import { Header } from './Header';
import { navItemsFor } from './nav';
import { SideNav } from './SideNav';

/**
 * Skip link; full-height green rail beside a paper top bar and <main> (desktop), or the green band
 * and bottom tabs (≤ 640 px). 16 px side gutters on mobile; bottom padding clears the tab bar.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useCurrentUser();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const { data: config } = usePublicConfig();
  const g1Enabled = config?.gates.find((g) => g.key === 'G1')?.enabled ?? true;
  const items = navItemsFor(me, { g1Enabled });
  return (
    <TooltipProvider delayDuration={300}>
      <div className="bg-background min-h-dvh">
        <a
          href="#main"
          className="bg-action text-action-foreground sr-only z-[70] rounded-md px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to main content
        </a>
        <div className="flex">
          <SideNav items={items} pathname={pathname} search={search} />
          <div className="flex min-w-0 flex-1 flex-col">
            <DevPersonaSwitcher />
            <Header />
            <main
              id="main"
              tabIndex={-1}
              className="relative min-w-0 flex-1 px-4 pt-6 pb-28 sm:px-8 sm:pt-8 sm:pb-12 lg:px-12"
            >
              <div className="mx-auto max-w-6xl">{children}</div>
              <ReportIssueFooter />
            </main>
          </div>
        </div>
        <BottomNav items={items} pathname={pathname} search={search} />
        <ReportIssueDialog />
      </div>
    </TooltipProvider>
  );
}
