import { Link, useNavigate } from '@tanstack/react-router';
import { MoreHorizontalIcon } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { isNavItemActive, splitTabs, type NavItem } from './nav';
import { NAV_ICONS } from './NavIcon';

const tabClass =
  'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[0.6875rem] font-medium';

/** Mobile bottom tab bar (≤ 640 px). More than five items: the last tab becomes "More". */
export function BottomNav({
  items,
  pathname,
  search = {},
}: {
  items: NavItem[];
  pathname: string;
  search?: Record<string, unknown>;
}) {
  const navigate = useNavigate();
  const { tabs, overflow } = splitTabs(items);
  const overflowActive = overflow.some((i) => isNavItemActive(i, pathname, search));
  return (
    <nav
      aria-label="Primary"
      className="bg-card fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <ul className="flex">
        {tabs.map((item) => {
          const active = isNavItemActive(item, pathname, search);
          const Icon = NAV_ICONS[item.key];
          return (
            <li key={item.key} className="flex min-w-0 flex-1">
              <Link
                to={item.to}
                {...(item.search ? { search: item.search } : {})}
                data-nav={item.key}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
                className={cn(
                  tabClass,
                  active
                    ? 'text-emphasis before:bg-action relative before:absolute before:inset-x-4 before:top-0 before:h-0.5'
                    : 'text-muted-foreground',
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                <span className="max-w-full truncate" aria-hidden="true">
                  {item.shortLabel}
                </span>
              </Link>
            </li>
          );
        })}
        {overflow.length > 0 && (
          <li className="flex min-w-0 flex-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(tabClass, overflowActive ? 'text-emphasis' : 'text-muted-foreground')}
              >
                <MoreHorizontalIcon className="size-5" aria-hidden="true" />
                More
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top">
                {overflow.map((item) => {
                  const Icon = NAV_ICONS[item.key];
                  return (
                    <DropdownMenuItem
                      key={item.key}
                      data-nav={item.key}
                      onSelect={() =>
                        void navigate({
                          to: item.to,
                          ...(item.search ? { search: item.search } : {}),
                        })
                      }
                    >
                      <Icon aria-hidden="true" /> {item.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        )}
      </ul>
    </nav>
  );
}
