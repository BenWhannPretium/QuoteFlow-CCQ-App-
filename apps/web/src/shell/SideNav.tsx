import { Link } from '@tanstack/react-router';

import { cn } from '@/lib/utils';

import { isNavItemActive, type NavItem } from './nav';
import { NAV_ICONS } from './NavIcon';

/** Desktop left rail (≥ 641 px). */
export function SideNav({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    // The panel stretches with the page; the list inside stays in view while scrolling.
    <nav aria-label="Primary" className="bg-card hidden w-60 shrink-0 border-r sm:block">
      <div className="sticky top-0 max-h-dvh overflow-y-auto px-3 py-5">
        <ul className="grid gap-1">
          {items.map((item) => {
            const active = isNavItemActive(item, pathname);
            const Icon = NAV_ICONS[item.key];
            return (
              <li key={item.key}>
                <Link
                  to={item.to}
                  data-nav={item.key}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'text-foreground-2 hover:bg-accent hover:text-foreground relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium',
                    active &&
                      'bg-secondary text-secondary-foreground before:bg-action before:absolute before:inset-y-2 before:-left-3 before:w-1 before:rounded-r',
                  )}
                >
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
