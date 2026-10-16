import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

import { formatDuration } from './format';

export const stageTimesQueryKey = (quoteNumber: string) => ['stage-times', quoteNumber] as const;

/**
 * Time in each stage, excluding holds (the same `computeTimeInStage` the dashboards use). A thin
 * horizontal bar with one segment per stage, and the numbers as a list for screen readers and
 * small screens.
 */
export function StageTimeBar({ quoteNumber }: { quoteNumber: string }) {
  const times = useQuery({
    queryKey: stageTimesQueryKey(quoteNumber),
    queryFn: () => api.stageTimes(quoteNumber),
  });
  if (!times.data || times.data.stages.length === 0) return null;
  const stages = times.data.stages;
  const total = stages.reduce((n, s) => n + s.activeMs, 0) || 1;
  return (
    <section aria-labelledby="stage-times-heading" className="grid gap-2" data-testid="stage-times">
      <h2 id="stage-times-heading" className="text-sm font-semibold">
        Time in stage <span className="text-muted-foreground font-normal">(excluding holds)</span>
      </h2>
      <div className="bg-muted flex h-2.5 w-full overflow-hidden rounded-full" aria-hidden="true">
        {stages.map((s, i) => (
          <span
            key={s.stageKey}
            className={cn(
              'h-full',
              s.current ? 'bg-primary' : i % 2 === 0 ? 'bg-line-strong' : 'bg-muted-foreground',
            )}
            style={{ width: `${Math.max(1, (s.activeMs / total) * 100)}%` }}
          />
        ))}
      </div>
      <ul className="text-foreground-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {stages.map((s) => (
          <li key={s.stageKey} className={cn(s.current && 'text-foreground font-semibold')}>
            {s.label}: {formatDuration(s.activeMs)}
            {s.heldMs > 0 && ` (+${formatDuration(s.heldMs)} on hold)`}
            {s.visits > 1 && ` · ${s.visits} visits`}
            {s.current && ' · now'}
          </li>
        ))}
      </ul>
    </section>
  );
}
