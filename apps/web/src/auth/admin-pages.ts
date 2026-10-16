import type { PermissionName } from './permissions';

/**
 * The permission each /admin page needs (UI guard; the API checks it again on every call). The usage
 * audit pages are Leadership + Admin (audit.read), the override log overrideLog.read, the outcomes
 * report analytics.read (B-13); every other
 * Admin page is configuration (config.manage).
 */
export function adminPagePermission(pathname: string): PermissionName {
  if (pathname.startsWith('/admin/audit') || pathname.startsWith('/admin/reports/usage')) {
    return 'audit.read';
  }
  if (pathname.startsWith('/admin/override-log')) return 'overrideLog.read';
  // B-13: the outcomes report is analytics (SalesLeader, Leadership, Admin and the other analytics roles).
  if (pathname.startsWith('/admin/reports/outcomes')) return 'analytics.read';
  return 'config.manage';
}
