import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { AnalyticsPage } from '@/analytics/AnalyticsPage';
import { RequirePermission } from '@/auth';
import { parseAnalyticsSearch } from '@/lib/analytics-search';

export const Route = createFileRoute('/analytics')({
  validateSearch: parseAnalyticsSearch,
  component: Analytics,
});

function Analytics() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <RequirePermission permission="analytics.read">
      <AnalyticsPage
        search={search}
        onSearchChange={(next) => void navigate({ to: '/analytics', search: next, replace: true })}
      />
    </RequirePermission>
  );
}
