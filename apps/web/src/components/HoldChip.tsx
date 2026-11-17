import type { DashHold } from '@ccq/contracts';
import { useState } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { holdSummary } from '@/lib/hold-text';
import { cn } from '@/lib/utils';

/**
 * FB-18 (W13-26; Zachary Cairns and Bailey Schmitt, 2026-11-13): a KAM could not see that a quote was on
 * hold. The orange "On hold" chip marks it on the Command Center lists. On hover and on keyboard focus
 * (and on a tap, for phones) it says why the quote is held, who owns the hold and when it is reviewed,
 * in the one sentence the quote header and the timeline use (`holdSummary`, FB-17). The sentence is the
 * chip's accessible name too, so a screen reader hears it without opening anything.
 */
export function HoldChip({ hold, className }: { hold: DashHold; className?: string }) {
  const [open, setOpen] = useState(false);
  const summary = holdSummary(hold);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={summary}
          data-testid="hold-chip"
          // A tap opens it (a tooltip does not open on touch by itself); the default click closes it.
          onClick={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
          // 44 px tall on a phone, 24 px on a desktop (WCAG 2.5.8); the chip inside keeps its size.
          className={cn(
            'focus-visible:ring-ring rounded-pill inline-flex min-h-11 shrink-0 items-center focus-visible:ring-2 focus-visible:outline-none sm:min-h-6',
            className,
          )}
        >
          <span className="bg-hold text-hold-foreground rounded-pill inline-flex items-center px-2 py-0.5 text-[0.6875rem] font-semibold tracking-[0.06em] whitespace-nowrap uppercase">
            On hold
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent data-testid="hold-chip-detail">{summary}</TooltipContent>
    </Tooltip>
  );
}
