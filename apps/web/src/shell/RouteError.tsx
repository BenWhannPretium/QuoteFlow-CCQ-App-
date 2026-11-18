import type { ErrorComponentProps } from '@tanstack/react-router';

import { ForbiddenPage } from '@/auth';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { isApiError } from '@/lib/api';
import { isStaleBuildError } from '@/lib/stale-build';

/**
 * Error boundary for a page: 403 gets the access page, a page whose code could not be fetched gets
 * "reload", anything else an inline error.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
  if (isApiError(error, 403)) return <ForbiddenPage detail={error.problem.detail} />;
  if (isStaleBuildError(error)) {
    // The page's code could not be fetched. The router has already reloaded once on its own (that cures
    // a tab opened before an update), so reaching here usually means the connection, not the update.
    // "Try again" would ask for the same file from the same place; a reload is the only thing to offer.
    return (
      <div data-testid="route-error-page-load" role="alert">
        <PageHeader title="This page could not be loaded" />
        <p className="text-muted-foreground mb-4 text-sm">
          QuoteFlow may have been updated, or the connection may have dropped. Check your connection
          and reload. Anything already saved is safe.
        </p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
  return (
    <div data-testid="route-error">
      <PageHeader title="Something went wrong" />
      <ErrorState error={error} onRetry={reset} />
    </div>
  );
}
