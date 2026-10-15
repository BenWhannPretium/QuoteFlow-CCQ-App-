import type { MeResponse } from '@ccq/contracts';

import { canFromMe } from '@/auth/permissions';

export type NavKey =
  | 'home'
  | 'intake'
  | 'queue-engineering'
  | 'queue-pricing'
  | 'pipeline'
  | 'approvals'
  | 'analytics'
  | 'admin';

export interface NavItem {
  key: NavKey;
  /** Rail label. */
  label: string;
  /** Bottom tab bar label (short). */
  shortLabel: string;
  to: string;
  /** Extra path prefixes that mark the item active (Pipeline covers /quotes and /board). */
  activePrefixes: string[];
}

const item = (
  key: NavKey,
  label: string,
  shortLabel: string,
  to: string,
  activePrefixes: string[] = to === '/' ? [] : [to],
): NavItem => ({ key, label, shortLabel, to, activePrefixes });

/**
 * The navigation for the signed-in user, driven by `/me` permissions (the same check as `useCan`),
 * so a matrix change in `role_permission` changes the nav with no code change. UI only: the API
 * enforces every permission.
 *
 * "My queue" is labelled per role: the EngLead owns the engineering queue (queue.assign), an
 * Engineer works their assignments (engReview.edit, assigned), Pricing works the pricing queue.
 * The Approver's queue is Approvals.
 */
export function navItemsFor(me: MeResponse): NavItem[] {
  const can = (permission: string) => canFromMe(me, permission);
  const items: NavItem[] = [item('home', 'Home', 'Home', '/')];

  if (can('quote.create')) items.push(item('intake', 'New intake', 'Intake', '/intake/new'));
  if (can('engReview.edit')) {
    items.push(
      can('queue.assign')
        ? item('queue-engineering', 'Engineering queue', 'Queue', '/queue/engineering')
        : item('queue-engineering', 'My assignments', 'Assignments', '/queue/engineering'),
    );
  }
  if (can('quoting.edit')) {
    items.push(item('queue-pricing', 'Pricing queue', 'Pricing', '/queue/pricing'));
  }
  if (can('quote.read')) {
    items.push(item('pipeline', 'Pipeline', 'Pipeline', '/quotes', ['/quotes', '/board']));
  }
  if (can('gate.G4.decide')) items.push(item('approvals', 'Approvals', 'Approvals', '/approvals'));
  if (can('analytics.read')) items.push(item('analytics', 'Analytics', 'Analytics', '/analytics'));
  if (can('config.manage')) items.push(item('admin', 'Admin', 'Admin', '/admin'));
  return items;
}

export function isNavItemActive(navItem: NavItem, pathname: string): boolean {
  if (navItem.to === '/') return pathname === '/';
  return navItem.activePrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The bottom tab bar fits five tabs; beyond that the last slot becomes "More". */
export const MAX_TABS = 5;

export function splitTabs(items: NavItem[]): { tabs: NavItem[]; overflow: NavItem[] } {
  if (items.length <= MAX_TABS) return { tabs: items, overflow: [] };
  return { tabs: items.slice(0, MAX_TABS - 1), overflow: items.slice(MAX_TABS - 1) };
}
