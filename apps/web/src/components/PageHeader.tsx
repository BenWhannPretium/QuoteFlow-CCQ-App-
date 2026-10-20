import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The page's single <h1>, with an optional eyebrow, description and actions. Set on a faint drafting
 * grid and closed by a ruler rule; the eyebrow is a spec-sheet label.
 */
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
    <header className={cn('rise relative isolate mb-8', className)}>
      <div
        aria-hidden="true"
        className="blueprint-grid pointer-events-none absolute -inset-x-4 -top-6 bottom-0 -z-10 sm:-inset-x-8 sm:-top-8 lg:-inset-x-12"
      />
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pb-5">
        <div className="grid min-w-0 gap-2.5">
          {eyebrow && (
            <p className="spec-label text-emphasis flex items-center gap-2">
              <span aria-hidden="true" className="bg-action inline-block size-1.5" />
              {eyebrow}
            </p>
          )}
          <h1 className="font-display text-[2rem] leading-[1.05] text-balance sm:text-[2.625rem]">
            {title}
          </h1>
          {description && (
            <p className="text-muted-foreground max-w-prose text-[0.9375rem] leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div aria-hidden="true" className="ruler-rule" />
    </header>
  );
}
