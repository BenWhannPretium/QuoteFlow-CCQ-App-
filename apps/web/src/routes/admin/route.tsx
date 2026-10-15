import { createFileRoute, Outlet } from '@tanstack/react-router';

import { RequirePermission } from '@/auth';

/** Every /admin/* page needs config.manage (the API checks it again on every call). */
export const Route = createFileRoute('/admin')({
  component: () => (
    <RequirePermission permission="config.manage">
      <Outlet />
    </RequirePermission>
  ),
});
