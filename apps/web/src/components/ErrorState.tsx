import { AlertTriangleIcon, LockIcon, SearchXIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { isApiError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { cn } from '@/lib/utils';

/**
 * Inline error for a failed query (RFC 9457 aware): the problem's title and detail, field errors
 * when present, and the request reference for support. 403 and 404 get their own wording.
 */
export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const status = isApiError(error) ? error.status : undefined;
  const { title, message } =
    status === 403
      ? {
          title: 'You don’t have access to this',
          message:
            (isApiError(error) && error.problem.detail) ||
            'Your QuoteFlow role doesn’t allow this. If you think it should, ask an admin.',
        }
      : status === 404
        ? {
            title: 'Not found',
            message:
              (isApiError(error) && error.problem.detail) ||
              'It may have been removed, or the link is wrong.',
          }
        : describeError(error);
  const fieldErrors = isApiError(error) ? (error.problem.errors ?? []) : [];
  const reference = isApiError(error) ? error.problem.instance : undefined;
  const Icon = status === 403 ? LockIcon : status === 404 ? SearchXIcon : AlertTriangleIcon;

  return (
    <div
      role="alert"
      data-status={status}
      className={cn('bg-card rounded-card flex gap-3 border p-4 sm:p-5', className)}
    >
      <Icon className="text-emphasis mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="grid min-w-0 gap-1.5">
        <p className="font-semibold">{title}</p>
        <p className="text-muted-foreground text-sm">{message}</p>
        {fieldErrors.length > 0 && (
          <ul className="text-sm">
            {fieldErrors.map((e) => (
              <li key={`${e.path}:${e.message}`}>
                <span className="font-medium">{e.path}</span>: {e.message}
              </li>
            ))}
          </ul>
        )}
        {reference && (
          <p className="text-muted-foreground text-xs">
            Reference: <span className="font-mono break-all">{reference}</span>
          </p>
        )}
        {onRetry && (status === undefined || status >= 500) && (
          <div>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
