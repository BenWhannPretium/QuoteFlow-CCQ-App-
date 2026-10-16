import { cn } from '@/lib/utils';

/**
 * Priority tier chip. Tier names come from the scoring model config; these four have brand colours
 * (contrast-checked in tokens.css) and any other name renders in the Standard style.
 */
const TIER_CLASS: Record<string, string> = {
  critical: 'bg-tier-critical text-tier-critical-foreground',
  high: 'bg-tier-high text-tier-high-foreground',
  standard: 'bg-tier-standard text-tier-standard-foreground',
  low: 'bg-tier-low text-tier-low-foreground',
};

export function TierChip({
  tier,
  label,
  overridden = false,
  className,
}: {
  /** Tier key (`HIGH`) or label; the colour follows it. */
  tier: string;
  /** What to show (`High`); defaults to `tier`. */
  label?: string | null;
  /** The tier comes from an approved override (B-09), not the score. */
  overridden?: boolean;
  className?: string;
}) {
  const style = TIER_CLASS[tier.toLowerCase()] ?? TIER_CLASS.standard;
  return (
    <span
      data-tier={tier.toLowerCase()}
      className={cn(
        'rounded-pill inline-flex items-center px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        style,
        className,
      )}
    >
      {label ?? tier}
      {overridden && <span className="ml-1 font-normal opacity-90">(override)</span>}
    </span>
  );
}
