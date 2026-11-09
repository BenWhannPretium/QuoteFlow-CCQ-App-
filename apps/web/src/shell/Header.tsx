import { Link } from '@tanstack/react-router';
import { SearchIcon } from 'lucide-react';

import { UserMenu } from '@/auth';

import { GlobalSearch } from './GlobalSearch';
import { NotificationBell } from './NotificationBell';
import { Wordmark } from './Wordmark';

/**
 * Mobile: the green band with the wordmark. From 641 px: a paper top bar beside the rail (the
 * wordmark lives in the rail), with search, notifications and the account menu. index.css swaps the
 * header tokens at that breakpoint.
 */
export function Header() {
  return (
    <header
      data-surface="header"
      className="bg-header text-header-foreground border-header-line/60 sticky top-0 z-30 sm:border-b sm:backdrop-blur-md"
    >
      <div className="flex min-h-16 items-center gap-2 px-4 sm:gap-4 sm:px-8 lg:px-12">
        <Link to="/" className="flex min-h-11 shrink-0 items-center rounded-sm sm:hidden">
          <Wordmark />
        </Link>
        <GlobalSearch className="hidden w-full max-w-md sm:block" />
        <div className="ml-auto flex items-center gap-1">
          <Link
            to="/quotes"
            aria-label="Search quotes"
            className="hover:bg-header-control inline-flex size-11 items-center justify-center rounded-sm sm:hidden"
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
