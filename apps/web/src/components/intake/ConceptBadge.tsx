import { cn } from '@/lib/utils';

/**
 * FB-24 (N17-03): marks a concept / innovation request (a class in `intake_min_spec_exempt_classes`)
 * wherever its request class or its assumptions are shown, so Engineering, Pricing and Final Review read
 * the quote as a concept built on assumptions. Text, not colour alone.
 */
export function ConceptBadge({ className }: { className?: string }) {
  return (
    <span
      data-testid="concept-badge"
      className={cn(
        'border-primary/40 bg-primary/10 text-foreground rounded-pill inline-flex items-center border px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        className,
      )}
    >
      Concept
    </span>
  );
}

/** The concept classes from `/config/public` (`intake_min_spec_exempt_classes`; empty while loading). */
export function conceptClassesFrom(settings: Record<string, unknown> | undefined): string[] {
  const v = settings?.intake_min_spec_exempt_classes;
  return Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string') : [];
}
