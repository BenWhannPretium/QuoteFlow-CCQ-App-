import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export { Skeleton };

/** Stand-in for a dashboard card. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('bg-card rounded-card shadow-card grid gap-3 border p-5', className)}>
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
}

/** Stand-in for a table or list. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('grid gap-2', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

/** Announces loading to screen readers while skeletons show. */
export function LoadingRegion({
  label = 'Loading',
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}
