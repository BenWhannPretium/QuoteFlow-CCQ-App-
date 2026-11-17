import type { ErrorComponentProps } from '@tanstack/react-router';

import { ForbiddenPage } from '@/auth';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { isApiError } from '@/lib/api';
import { isStaleBuildError } from '@/lib/stale-build';

/**
 * Error boundary for a page: 403 gets the access page, a page that belongs to a build that has since
 * been replaced gets "reload", anything else an inline error.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
  if (isApiError(error, 403)) return <ForbiddenPage detail={error.problem.detail} />;
  if (isStaleBuildError(error)) {
    // "Try again" would ask for the same file, which the new build no longer has.
    return (
      <div data-testid="route-error-stale-build" role="alert">
        <PageHeader title="QuoteFlow was updated" />
        <p className="text-muted-foreground mb-4 text-sm">
          This page was opened before the update and has to be reloaded. Anything already saved is
          safe.
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
