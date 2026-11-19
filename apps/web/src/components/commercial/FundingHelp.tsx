import type { PublicValueListEntry } from '@ccq/contracts';
import { FINANCE_REVIEW_HELP_TEXT, fundingRequiresFinanceReview } from '@ccq/domain';
import { InfoIcon } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePublicConfig } from '@/config/public-config';
import { cn } from '@/lib/utils';
import { RETIRED_SUFFIX, valueListLabel } from '@/lib/value-label';

/**
 * FB-31 (N19-08): the tooling funding options a select offers: the active ones, plus the quote's own
 * code when it is no longer offered ($0 CER and Shared were retired), marked "(no longer offered)", so an
 * old quote's select still shows what it holds instead of the first option.
 */
export function useFundingOptions(current: string | null | undefined): PublicValueListEntry[] {
  const { data: config } = usePublicConfig();
  const active = config?.valueLists.tooling_funding_model ?? [];
  if (!current || active.some((e) => e.code === current)) return active;
  const retired = config?.retiredValues?.tooling_funding_model?.[current];
  return [
    ...active,
    { code: current, label: `${retired ?? current}${RETIRED_SUFFIX}`, sort: 9999, meta: {} },
  ];
}

/** FB-31: a stored funding code as its label, a retired one marked "(no longer offered)". */
export function useFundingLabel(code: string | null | undefined): string | null {
  const { data: config } = usePublicConfig();
  return valueListLabel(config, 'tooling_funding_model', code);
}

/**
 * FB-31 (N19-08; Sarah Brennan): where the funding model is chosen, the line that says the chosen option
 * needs a finance review (list meta `requiresFinanceReview`, seeded on "Customer funded (amortized)").
 */
export function FinanceReviewLine({
  code,
  options,
  className,
}: {
  code: string | null | undefined;
  options: readonly { code: string; meta: Record<string, unknown> }[];
  className?: string;
}) {
  const entry = code ? options.find((o) => o.code === code) : undefined;
  if (!fundingRequiresFinanceReview(entry?.meta)) return null;
  return (
    <p
      className={cn('text-warning-foreground bg-warning rounded-md px-2 py-1 text-xs', className)}
      data-testid="funding-finance-review"
    >
      {FINANCE_REVIEW_HELP_TEXT}
    </p>
  );
}

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
          className="text-emphasis inline-flex min-h-11 items-center gap-1 rounded px-1 sm:min-h-8 text-xs underline-offset-4 hover:underline"
          data-testid="funding-help"
        >
          <InfoIcon className="size-3.5" aria-hidden="true" />
          What do the funding options mean?
        </PopoverTrigger>
        {/* FB-25 (N17-29): it ran off the screen on a laptop. It now stays within the viewport (Radix
            gives the room left on the chosen side), scrolls on its own and flips side when there is
            no room below, as the pipeline's column chooser does. */}
        <PopoverContent
          className="max-h-[min(70dvh,var(--radix-popover-content-available-height))] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain"
          align="start"
          side="bottom"
          avoidCollisions
          tabIndex={0}
          aria-label="Funding options"
          data-testid="funding-help-content"
        >
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
