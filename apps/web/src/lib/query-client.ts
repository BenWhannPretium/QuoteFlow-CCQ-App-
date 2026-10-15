import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { isApiError } from './api';
import { describeError, errorPresentation } from './errors';
import { toast } from './toast';

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: {
      /** The screen handles every error itself (e.g. the sign-in gate): no global toast. */
      silentErrors?: boolean;
    };
    mutationMeta: {
      silentErrors?: boolean;
    };
  }
}

function report(err: unknown, silent: boolean | undefined) {
  if (silent || errorPresentation(err) !== 'toast') return;
  const { title, message } = describeError(err);
  // One toast per kind of failure, however many queries fail at once.
  toast.error({ title, description: message, key: `${title}|${message}` });
}

/**
 * Global error routing: 5xx and network failures toast; 4xx stay inline (the screen renders
 * <ErrorState>). Client errors are never retried; they won't change on a second try.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: (err, query) => report(err, query.meta?.silentErrors) }),
    mutationCache: new MutationCache({
      onError: (err, _vars, _ctx, mutation) => report(err, mutation.meta?.silentErrors),
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, err) => !(isApiError(err) && err.status < 500) && count < 1,
      },
    },
  });
}
