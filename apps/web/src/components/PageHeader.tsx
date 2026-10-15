import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** The page's single <h1>, with an optional eyebrow, description and actions. */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn('mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3', className)}
    >
      <div className="grid min-w-0 gap-1">
        {eyebrow && (
          <p className="text-emphasis text-xs font-semibold tracking-widest uppercase">{eyebrow}</p>
        )}
        <h1 className="font-display text-2xl leading-tight text-balance sm:text-3xl">{title}</h1>
        {description && <p className="text-muted-foreground max-w-prose text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
