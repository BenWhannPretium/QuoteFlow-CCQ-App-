import { Link } from '@tanstack/react-router';
import {
  BellIcon,
  LogOutIcon,
  MessageSquareWarningIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from 'lucide-react';

import { openReportIssue } from '@/components/feedback/ReportIssue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { isThemePreference } from '@/theme/theme';
import { useTheme } from '@/theme/ThemeProvider';

import { useAuth } from './context';
import { useCan, useCurrentUser } from './hooks';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

/** Name, roles, theme and sign-out. Sits on the green header band. */
export function UserMenu() {
  const me = useCurrentUser();
  const { session } = useAuth();
  const { preference, setPreference } = useTheme();
  const canReport = useCan('feedback.submit');
  return (
    // Non-modal: the page behind stays in the accessibility tree (no aria-hidden over focusables).
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        data-testid="user-menu"
        className="hover:bg-header-control flex min-h-11 items-center gap-2 rounded-pill py-1 pr-1 pl-1 sm:pr-3"
      >
        <span
          aria-hidden="true"
          className="bg-action text-action-foreground flex size-9 items-center justify-center rounded-full text-sm font-semibold"
        >
          {initials(me.user.displayName) || '?'}
        </span>
        <span className="hidden max-w-40 truncate text-sm md:inline" data-testid="current-user">
          {me.user.displayName}
        </span>
        <span className="sr-only">Account menu for {me.user.displayName}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <div className="grid gap-1 px-3 py-2">
          <p className="truncate font-semibold">{me.user.displayName}</p>
          <p className="text-muted-foreground truncate text-xs">{me.user.upn}</p>
          {/* Spans, not a list: role="menu" may only own menu items, groups and separators. */}
          <p className="mt-1 flex flex-wrap gap-1" data-testid="user-roles">
            <span className="sr-only">Roles:</span>
            {me.roles.map((role) => (
              <span
                key={role}
                className="bg-secondary text-secondary-foreground rounded-pill px-2 py-0.5 text-xs font-medium"
              >
                {role}
              </span>
            ))}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/me/preferences" data-testid="email-preferences-link">
            <BellIcon aria-hidden="true" /> Email preferences
          </Link>
        </DropdownMenuItem>
        {canReport && (
          // Opens after the menu closes (the shell owns the dialog), so focus lands in the dialog.
          <DropdownMenuItem
            onSelect={() => setTimeout(openReportIssue, 0)}
            data-testid="report-issue-menu"
          >
            <MessageSquareWarningIcon aria-hidden="true" /> Report an issue
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(v) => isThemePreference(v) && setPreference(v)}
        >
          <DropdownMenuRadioItem value="system">
            <MonitorIcon aria-hidden="true" /> System
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">
            <SunIcon aria-hidden="true" /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonIcon aria-hidden="true" /> Dark
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {me.authMode === 'entra' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void session.signOut()}>
              <LogOutIcon aria-hidden="true" /> Sign out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
