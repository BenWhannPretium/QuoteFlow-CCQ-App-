import { Link } from '@tanstack/react-router';
import { SearchIcon } from 'lucide-react';

import { DevPersonaSwitcher, UserMenu } from '@/auth';

import { GlobalSearch } from './GlobalSearch';
import { NotificationBell } from './NotificationBell';

/** The green brand band: wordmark, search, notifications, account. Dev persona strip on top. */
export function Header() {
  return (
    <header data-surface="header" className="bg-header text-header-foreground">
      <DevPersonaSwitcher />
      <div className="flex min-h-16 items-center gap-2 px-4 sm:gap-4 sm:px-6">
        <Link to="/" className="flex min-h-11 shrink-0 items-center gap-2 rounded-md">
          <span className="font-display text-2xl leading-none tracking-tight">QuoteFlow</span>
          <span className="text-header-muted hidden text-xs tracking-wide lg:inline">
            Commercial Capital Quoting
          </span>
        </Link>
        <GlobalSearch className="mx-auto hidden w-full max-w-md sm:block" />
        <div className="ml-auto flex items-center gap-1 sm:ml-0">
          <Link
            to="/quotes"
            aria-label="Search quotes"
            className="hover:bg-header-control inline-flex size-11 items-center justify-center rounded-full sm:hidden"
          >
            <SearchIcon className="size-5" aria-hidden="true" />
          </Link>
          <NotificationBell />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
