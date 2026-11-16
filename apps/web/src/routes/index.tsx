import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { LandingPage } from '@/landing/LandingPage';
import { parseCommandCenterSearch } from '@/lib/command-center';

/**
 * `/` is the Command Center (FB-18, W13-29): "My work" (the role's landing, `?view=work`; `?as=` picks
 * the role for a multi-role user) and "Analytics" (`?view=analytics`, with the analytics filters in the
 * URL). With no `view` it opens on the view the user chose last.
 */
export const Route = createFileRoute('/')({
  validateSearch: parseCommandCenterSearch,
  component: Home,
});

function Home() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <LandingPage
      search={search}
      onAnalyticsSearchChange={(next) =>
        void navigate({
          to: '/',
          search: { ...(search.as ? { as: search.as } : {}), ...next, view: 'analytics' },
          replace: true,
        })
      }
    />
  );
}
