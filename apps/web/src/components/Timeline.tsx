import type { ReactNode } from 'react';

import { absoluteTime, relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

export interface TimelineItem {
  id: string;
  /** ISO 8601 UTC; shown relative ("3 hours ago") and absolute, in the user's time zone. */
  at: string;
  title: ReactNode;
  actor?: ReactNode;
  detail?: ReactNode;
  /** Right-aligned on wide screens, below the detail on phones (e.g. "Revert"). */
  action?: ReactNode;
  /** Colours the marker: stage changes and gate decisions stand out. */
  kind?: 'stage' | 'gate' | 'override' | 'note' | 'file' | 'system';
}

const MARKER: Record<NonNullable<TimelineItem['kind']>, string> = {
  stage: 'bg-primary',
  gate: 'bg-action',
  override: 'bg-tier-high-foreground',
  note: 'bg-muted-foreground',
  file: 'bg-line-strong',
  system: 'bg-line-strong',
};

/** Presentational timeline: items render in the order given (the quote timeline is newest first). */
export function Timeline({
  items,
  label = 'Timeline',
  className,
  now,
}: {
  items: TimelineItem[];
  label?: string;
  className?: string;
  /** For relative times (tests); defaults to the current time. */
  now?: Date;
}) {
  return (
    <ol aria-label={label} className={cn('relative grid gap-5', className)}>
      {items.map((item, i) => (
        <li
          key={item.id}
          className="relative grid grid-cols-[1rem_1fr] gap-3"
          data-testid="timeline-item"
          data-kind={item.kind ?? 'system'}
        >
          <span className="relative flex justify-center" aria-hidden="true">
            <span className={cn('mt-1.5 size-2.5 rounded-full', MARKER[item.kind ?? 'system'])} />
            {i < items.length - 1 && <span className="bg-border absolute top-5 -bottom-5 w-px" />}
          </span>
          <div className="grid min-w-0 gap-1 sm:grid-cols-[1fr_auto] sm:gap-x-4">
            <div className="grid min-w-0 gap-0.5">
              <p className="text-sm font-medium">{item.title}</p>
              <p className="text-muted-foreground text-xs">
                {item.actor && <>{item.actor} · </>}
                <time dateTime={item.at} title={absoluteTime(item.at)}>
                  {relativeTime(item.at, now)}
                </time>
                <span className="block sm:inline">
                  <span className="hidden sm:inline"> · </span>
                  {absoluteTime(item.at)}
                </span>
              </p>
              {item.detail && <div className="text-foreground-2 mt-1 text-sm">{item.detail}</div>}
            </div>
            {item.action && <div className="sm:self-start">{item.action}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
