import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface TimelineItem {
  id: string;
  /** ISO 8601 UTC; shown in the user's locale. */
  at: string;
  title: ReactNode;
  actor?: ReactNode;
  detail?: ReactNode;
  /** Colours the marker: stage changes and gate decisions stand out. */
  kind?: 'stage' | 'gate' | 'override' | 'note' | 'system';
}

const MARKER: Record<NonNullable<TimelineItem['kind']>, string> = {
  stage: 'bg-primary',
  gate: 'bg-action',
  override: 'bg-tier-high-foreground',
  note: 'bg-muted-foreground',
  system: 'bg-line-strong',
};

const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Shell only: B-09 feeds it the audit timeline. Items render in the order given. */
export function Timeline({
  items,
  label = 'Timeline',
  className,
}: {
  items: TimelineItem[];
  label?: string;
  className?: string;
}) {
  return (
    <ol aria-label={label} className={cn('relative grid gap-5', className)}>
      {items.map((item, i) => (
        <li key={item.id} className="relative grid grid-cols-[1rem_1fr] gap-3">
          <span className="relative flex justify-center" aria-hidden="true">
            <span className={cn('mt-1.5 size-2.5 rounded-full', MARKER[item.kind ?? 'system'])} />
            {i < items.length - 1 && <span className="bg-border absolute top-5 -bottom-5 w-px" />}
          </span>
          <div className="grid min-w-0 gap-0.5">
            <p className="text-sm font-medium">{item.title}</p>
            <p className="text-muted-foreground text-xs">
              <time dateTime={item.at}>{formatter.format(new Date(item.at))}</time>
              {item.actor && <> · {item.actor}</>}
            </p>
            {item.detail && <div className="text-foreground-2 text-sm">{item.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
