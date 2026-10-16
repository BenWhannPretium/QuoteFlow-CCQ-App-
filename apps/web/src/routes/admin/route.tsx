import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';

import { RequirePermission } from '@/auth';
import { adminPagePermission } from '@/auth/admin-pages';

/** Every /admin/* page is permission-guarded: config.manage, or audit.read / overrideLog.read (B-09). */
export const Route = createFileRoute('/admin')({
  component: AdminLayout,
});

function AdminLayout() {
  const { pathname } = useLocation();
  return (
    <RequirePermission permission={adminPagePermission(pathname)}>
      <Outlet />
    </RequirePermission>
  );
}
