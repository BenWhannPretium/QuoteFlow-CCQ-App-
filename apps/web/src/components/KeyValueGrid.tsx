import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  /** Optional key for React when labels aren't strings. */
  id?: string;
}

const COLUMNS = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3' } as const;

/** Label/value pairs as a <dl>; one column on mobile. Empty values show an en dash. */
export function KeyValueGrid({
  items,
  columns = 2,
  className,
}: {
  items: KeyValueItem[];
  columns?: keyof typeof COLUMNS;
  className?: string;
}) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4', COLUMNS[columns], className)}>
      {items.map((item, i) => (
        <div key={item.id ?? (typeof item.label === 'string' ? item.label : i)} className="min-w-0">
          <dt className="spec-label text-muted-foreground text-[0.625rem]">{item.label}</dt>
          <dd className="mt-1 text-sm break-words">
            {item.value === null || item.value === undefined || item.value === ''
              ? '–'
              : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
