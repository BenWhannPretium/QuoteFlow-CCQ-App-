import * as React from 'react';

import { cn } from '@/lib/utils';

/** Placeholder block while data loads. Pulse stops under prefers-reduced-motion. */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('bg-surface-3 animate-pulse rounded-md', className)}
      {...props}
    />
  );
}

export { Skeleton };
