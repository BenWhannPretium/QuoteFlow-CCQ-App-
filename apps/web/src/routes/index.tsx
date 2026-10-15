import { createFileRoute } from '@tanstack/react-router';

import { LandingPage } from '@/landing/LandingPage';

interface HomeSearch {
  /** Multi-role users: which role's dashboard to show. */
  as?: string;
}

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): HomeSearch =>
    typeof search.as === 'string' && search.as ? { as: search.as } : {},
  component: Home,
});

function Home() {
  const { as } = Route.useSearch();
  return <LandingPage requestedRole={as} />;
}
