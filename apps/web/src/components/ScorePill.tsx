import type { ReactNode } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * A priority score (0–100). Pass `tooltip` to explain it (B-08 shows the attribute breakdown);
 * the pill then becomes a focusable button so keyboard and touch users can open it too.
 */
export function ScorePill({
  score,
  tooltip,
  label = 'Priority score',
  className,
}: {
  score: number | null | undefined;
  tooltip?: ReactNode;
  label?: string;
  className?: string;
}) {
  const text = score == null ? '–' : String(Math.round(score));
  const pill = cn(
    'rounded-pill bg-secondary text-secondary-foreground inline-flex min-w-10 items-center justify-center px-2.5 py-0.5 text-sm font-semibold tabular-nums',
    className,
  );
  const accessibleName = score == null ? `${label}: not scored` : `${label} ${text}`;
  if (!tooltip) {
    return (
      <span className={pill} aria-label={accessibleName} role="img">
        {text}
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={cn(pill, 'cursor-help')} aria-label={accessibleName}>
          {text}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
