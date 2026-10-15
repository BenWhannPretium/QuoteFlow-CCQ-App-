import type { ErrorComponentProps } from '@tanstack/react-router';

import { ForbiddenPage } from '@/auth';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { isApiError } from '@/lib/api';

/** Error boundary for a page: 403 gets the access page, anything else an inline error. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  if (isApiError(error, 403)) return <ForbiddenPage detail={error.problem.detail} />;
  return (
    <div data-testid="route-error">
      <PageHeader title="Something went wrong" />
      <ErrorState error={error} onRetry={reset} />
    </div>
  );
}
