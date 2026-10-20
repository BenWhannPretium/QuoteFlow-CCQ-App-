import { cn } from '@/lib/utils';

/** "QuoteFlow" in the display serif with a copper registration dot; the product line under it. */
export function Wordmark({
  withLine = false,
  className,
}: {
  withLine?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('grid gap-1', className)}>
      <span className="font-display flex items-baseline text-[1.6rem] leading-none font-[420] tracking-[-0.02em]">
        QuoteFlow
        <span
          aria-hidden="true"
          className="bg-action ml-0.5 inline-block size-[5px] rounded-full"
        />
      </span>
      {withLine && (
        <span className="spec-label text-rail-muted text-[0.625rem]">
          Commercial Capital Quoting
        </span>
      )}
    </span>
  );
}
