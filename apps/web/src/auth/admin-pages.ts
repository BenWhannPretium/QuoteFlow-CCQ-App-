import type { PermissionName } from './permissions';

/**
 * The permission each /admin page needs (UI guard; the API checks it again on every call). The usage
 * audit pages are Leadership + Admin (audit.read), the override log overrideLog.read; every other
 * Admin page is configuration (config.manage).
 */
export function adminPagePermission(pathname: string): PermissionName {
  if (pathname.startsWith('/admin/audit') || pathname.startsWith('/admin/reports/usage')) {
    return 'audit.read';
  }
  if (pathname.startsWith('/admin/override-log')) return 'overrideLog.read';
  return 'config.manage';
}
