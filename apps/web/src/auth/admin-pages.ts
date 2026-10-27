import type { PermissionName } from './permissions';

/**
 * The permission each /admin page needs (UI guard; the API checks it again on every call). The usage
 * audit pages are Leadership + Admin (audit.read), the override log overrideLog.read, the outcomes
 * report analytics.read (B-13). The configuration console (B-19) is config.read, so Leadership reads it;
 * its edit controls need config.manage (Admin). The ERF linkage report and the UI kit stay Admin-only.
 */
export function adminPagePermission(pathname: string): PermissionName {
  if (pathname.startsWith('/admin/audit') || pathname.startsWith('/admin/reports/usage')) {
    return 'audit.read';
  }
  if (pathname.startsWith('/admin/override-log')) return 'overrideLog.read';
  // B-23: feedback can show commercial figures (screenshots), so Admin only.
  if (pathname.startsWith('/admin/feedback')) return 'feedback.triage';
  // B-13: the outcomes report is analytics (SalesLeader, Leadership, Admin and the other analytics roles).
  if (pathname.startsWith('/admin/reports/outcomes')) return 'analytics.read';
  if (pathname.startsWith('/admin/reports/erf-linkage') || pathname.startsWith('/admin/ui-kit')) {
    return 'config.manage';
  }
  return 'config.read';
}
