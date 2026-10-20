import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-card border-line-strong relative isolate flex flex-col items-center gap-3 overflow-hidden border border-dashed px-4 py-10 text-center',
        className,
      )}
    >
      <div aria-hidden="true" className="blueprint-grid absolute inset-0 -z-10" />
      {Icon && (
        <span className="bg-card text-secondary-foreground border-line-strong flex size-12 items-center justify-center rounded-sm border">
          <Icon className="size-6" strokeWidth={1.5} aria-hidden="true" />
        </span>
      )}
      <div className="grid max-w-sm gap-1">
        <p className="font-display text-lg">{title}</p>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      {action}
    </div>
  );
}
