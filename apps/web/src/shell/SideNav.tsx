import { Link } from '@tanstack/react-router';
import { useLayoutEffect, useRef, useState } from 'react';

import pretiumLogoWhite from '@/assets/brand/pretium-horizontal-white.png';
import { cn } from '@/lib/utils';

import { isNavItemActive, type NavItem } from './nav';
import { NAV_ICONS } from './NavIcon';
import { Wordmark } from './Wordmark';

/**
 * Desktop rail (≥ 641 px): full height, deep green, wordmark on top. A copper mark slides to the
 * active item.
 */
export function SideNav({
  items,
  pathname,
  search = {},
}: {
  items: NavItem[];
  pathname: string;
  search?: Record<string, unknown>;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [mark, setMark] = useState<{ top: number; height: number } | null>(null);
  const activeKey = items.find((item) => isNavItemActive(item, pathname, search))?.key;

  useLayoutEffect(() => {
    const place = () => {
      const el = listRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
      setMark(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [activeKey, items.length]);

  return (
    <nav
      aria-label="Primary"
      data-surface="rail"
      className="text-rail-foreground sticky top-0 hidden h-dvh w-60 shrink-0 flex-col sm:flex"
      style={{
        background:
          'linear-gradient(180deg, var(--pf-rail-bg) 0%, var(--pf-rail-bg-2) 100%), var(--pf-rail-bg)',
      }}
    >
      <Link to="/" className="mx-3 mt-5 mb-6 flex min-h-11 items-center rounded-sm px-3">
        <Wordmark withLine />
      </Link>
      <div className="border-rail-line mx-6 mb-4 border-t" />
      <div className="min-h-0 flex-1 overflow-y-auto px-3">
        <ul ref={listRef} className="relative grid gap-0.5">
          {mark && (
            <span
              aria-hidden="true"
              className="bg-action ease-machined absolute -left-3 w-[3px] transition-[transform,height] duration-300"
              style={{ transform: `translateY(${mark.top}px)`, height: mark.height, top: 0 }}
            />
          )}
          {items.map((item) => {
            const active = isNavItemActive(item, pathname, search);
            const Icon = NAV_ICONS[item.key];
            return (
              <li key={item.key}>
                <Link
                  to={item.to}
                  {...(item.search ? { search: item.search } : {})}
                  data-nav={item.key}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-sm px-3 text-[0.9rem] transition-colors duration-150',
                    active
                      ? 'bg-rail-active text-rail-foreground font-medium'
                      : 'text-rail-muted hover:bg-rail-hover hover:text-rail-foreground',
                  )}
                >
                  <Icon className="size-[18px] shrink-0" strokeWidth={1.6} aria-hidden="true" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      {/* B-26 (A8): the official Pretium lockup (white, for the green rail), not a typed name. */}
      <div className="border-rail-line mx-6 mt-4 border-t py-5" data-testid="rail-brand">
        <img
          src={pretiumLogoWhite}
          alt="Pretium Packaging"
          width={128}
          height={24}
          className="h-6 w-auto opacity-90"
        />
      </div>
    </nav>
  );
}
