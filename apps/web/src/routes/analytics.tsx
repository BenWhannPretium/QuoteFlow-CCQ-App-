import { createFileRoute, redirect } from '@tanstack/react-router';

import { analyticsRedirectSearch } from '@/lib/command-center';

/**
 * FB-18 (W13-29): Analytics is a view of the Command Center, not a page of its own. This address stays
 * so bookmarks and links in emails and documents keep working: it redirects to `/?view=analytics` with
 * every filter the link carried. Who may read analytics is unchanged: the Command Center shows the 403
 * page to a user without `analytics.read`, and the API enforces it on every analytics route.
 */
export const Route = createFileRoute('/analytics')({
  validateSearch: analyticsRedirectSearch,
  beforeLoad: ({ search }) => {
    // `throw: true` makes the router throw its own redirect (nothing here throws a non-Error value).
    redirect({ to: '/', search, replace: true, throw: true });
  },
});
