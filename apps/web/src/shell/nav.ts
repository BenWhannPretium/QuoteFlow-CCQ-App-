import type { MeResponse } from '@ccq/contracts';

import { canFromMe } from '@/auth/permissions';

export type NavKey =
  | 'home'
  | 'intake'
  | 'proposals'
  | 'queue-engineering'
  | 'queue-pricing'
  | 'pipeline'
  | 'qualify'
  | 'approvals'
  | 'analytics'
  | 'audit'
  | 'admin';

export interface NavItem {
  key: NavKey;
  /** Rail label. */
  label: string;
  /** Bottom tab bar label (short). */
  shortLabel: string;
  to: string;
  /** Search params for `to` (the G1 queue is `/approvals?gate=G1`). */
  search?: Record<string, string>;
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
 * Engineer works their assignments (engReview.edit, assigned), Leadership reads the queue
 * (engQueue.read), Pricing works the pricing queue (Leadership and Admin read it, pricingQueue.read).
 * The Approver's queue is Approvals: Final Review (B-12), plus the override requests an approver
 * decides (B-09). Leadership reads the Final Review queue (finalReview.read).
 * Leadership reads the usage audit log (audit.read) without the rest of Admin.
 */
export interface NavOptions {
  /** `g1_enabled` (from the G1 gate row in public config). When false the "To qualify" queue is hidden. */
  g1Enabled?: boolean;
}

export function navItemsFor(me: MeResponse, { g1Enabled = true }: NavOptions = {}): NavItem[] {
  const can = (permission: string) => canFromMe(me, permission);
  const items: NavItem[] = [item('home', 'Home', 'Home', '/')];

  if (can('quote.create')) items.push(item('intake', 'New intake', 'Intake', '/intake/new'));
  // B-13: a KAM's open proposals (the customer decision; outcome.record, own quotes).
  if (can('outcome.record'))
    items.push(item('proposals', 'My proposals', 'Proposals', '/proposals'));
  if (can('gate.G1.decide') && g1Enabled) {
    items.push({
      ...item('qualify', 'To qualify', 'Qualify', '/approvals'),
      search: { gate: 'G1' },
    });
  }
  // B-10: the queue page needs engQueue.read. An Engineer (no queue.assign) sees it as "My assignments"
  // with the read-only queue below; Leadership reads it; the EngLead and Admin own it.
  if (can('engQueue.read')) {
    items.push(
      can('engReview.edit') && !can('queue.assign')
        ? item('queue-engineering', 'My assignments', 'Assignments', '/queue/engineering')
        : item('queue-engineering', 'Engineering queue', 'Queue', '/queue/engineering'),
    );
  }
  // B-11: the pricing queue needs pricingQueue.read: Pricing works it, Leadership and Admin read it.
  if (can('pricingQueue.read')) {
    items.push(item('queue-pricing', 'Pricing queue', 'Pricing', '/queue/pricing'));
  }
  if (can('quote.read')) {
    items.push(item('pipeline', 'Pipeline', 'Pipeline', '/quotes', ['/quotes', '/board']));
  }
  // B-12: Approvals holds the Final Review queue (Approver decides, Leadership and Admin read), the
  // "To qualify" tab and the override requests an approver decides.
  if (can('finalReview.read') || can('gate.G4.decide') || can('override.approve')) {
    items.push(item('approvals', 'Approvals', 'Approvals', '/approvals'));
  }
  if (can('analytics.read')) items.push(item('analytics', 'Analytics', 'Analytics', '/analytics'));
  // B-19: Admin is config.read (Leadership reads every configuration screen; only Admin changes).
  if (can('config.read')) items.push(item('admin', 'Admin', 'Admin', '/admin'));
  else if (can('audit.read')) items.push(item('audit', 'Audit log', 'Audit', '/admin/audit'));
  return items;
}

export function isNavItemActive(
  navItem: NavItem,
  pathname: string,
  search: Record<string, unknown> = {},
): boolean {
  if (navItem.to === '/') return pathname === '/';
  // Items that share a path (Approvals vs the G1 queue) are told apart by their search params: the
  // "To qualify" tab is `?gate=G1` or `?tab=to-qualify`; every other tab (Final Review, Overrides) is Approvals.
  const wantsGate = navItem.search?.gate;
  const shown =
    search.tab === 'to-qualify'
      ? 'G1'
      : search.gate === 'G4'
        ? undefined
        : (search.gate ?? undefined);
  if (navItem.to === '/approvals' && shown !== wantsGate) return false;
  // B-12: the Final Review screen lives under /quotes/:qn/review but belongs to Approvals.
  const isReview = /^\/quotes\/[^/]+\/review$/.test(pathname);
  if (navItem.key === 'approvals')
    return (
      isReview || navItem.activePrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
    );
  if (isReview) return false;
  return navItem.activePrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The bottom tab bar fits five tabs; beyond that the last slot becomes "More". */
export const MAX_TABS = 5;

export function splitTabs(items: NavItem[]): { tabs: NavItem[]; overflow: NavItem[] } {
  if (items.length <= MAX_TABS) return { tabs: items, overflow: [] };
  return { tabs: items.slice(0, MAX_TABS - 1), overflow: items.slice(MAX_TABS - 1) };
}
