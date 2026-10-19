import type { MetricInfo } from '@ccq/contracts';
import { InfoIcon } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * The info tooltip every metric carries: its definition and its time window. A popover rather than a
 * hover tooltip, so it opens on touch and from the keyboard and can be read at leisure.
 */
export function InfoTip({ label, info }: { label: string; info: MetricInfo }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`About ${label}: definition and time window`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-8 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
        >
          <InfoIcon className="size-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="grid gap-3 text-sm" data-testid="info-popover">
        <div className="grid gap-1">
          <p className="text-emphasis text-xs font-semibold tracking-wider uppercase">Definition</p>
          <p>{info.definition}</p>
        </div>
        <div className="grid gap-1">
          <p className="text-emphasis text-xs font-semibold tracking-wider uppercase">
            Time window
          </p>
          <p>{info.window}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
