import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ErrorState } from '@/components/ErrorState';
import { SkeletonCard } from '@/components/Skeletons';
import { analyticsApiQuery, type AnalyticsSearch } from '@/lib/analytics-search';

/** Every chart's data is fetched server-side: the page only draws it. */
export function useChart<T>(
  name: string,
  search: AnalyticsSearch,
  fn: (q: ReturnType<typeof analyticsApiQuery>) => Promise<T>,
  enabled = true,
): UseQueryResult<T> {
  return useQuery({
    queryKey: ['analytics', name, search],
    queryFn: () => fn(analyticsApiQuery(search)),
    enabled,
    staleTime: 60_000,
  });
}

export function Boundary<T>({
  query,
  children,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <SkeletonCard />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <>{children(query.data)}</>;
}

export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-h`} id={id} className="grid scroll-mt-20 gap-4">
      <div className="grid gap-1">
        <h2 id={`${id}-h`} className="font-display text-xl">
          {title}
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm">{description}</p>
      </div>
      {children}
    </section>
  );
}
