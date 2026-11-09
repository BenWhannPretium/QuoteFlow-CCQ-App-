import { InfoIcon } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** FB-04 (F-022, V-055): an (i) beside the funding options that lists each option's help text (meta.helpText). */
export function FundingHelp({
  options,
  className = 'sm:col-span-2 sm:-mt-2',
}: {
  options: readonly { code: string; label: string; meta: Record<string, unknown> }[];
  /** Layout in the parent: the Commercial panel's two-column grid spans both columns by default. */
  className?: string;
}) {
  const withHelp = options.filter((o) => typeof o.meta.helpText === 'string');
  if (withHelp.length === 0) return null;
  return (
    <div className={cn('flex items-end pb-1.5', className)}>
      <Popover>
        <PopoverTrigger
          className="text-emphasis inline-flex min-h-8 items-center gap-1 rounded px-1 text-xs underline-offset-4 hover:underline"
          data-testid="funding-help"
        >
          <InfoIcon className="size-3.5" aria-hidden="true" />
          What do the funding options mean?
        </PopoverTrigger>
        <PopoverContent className="w-[min(28rem,calc(100vw-2rem))]" align="start">
          <dl className="grid gap-2 text-xs">
            {withHelp.map((o) => (
              <div key={o.code}>
                <dt className="font-semibold">{o.label}</dt>
                <dd className="text-muted-foreground">{String(o.meta.helpText)}</dd>
              </div>
            ))}
          </dl>
        </PopoverContent>
      </Popover>
    </div>
  );
}
