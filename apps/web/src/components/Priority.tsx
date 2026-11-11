import type { QualificationWarning, QuotePriority } from '@ccq/contracts';
import { AlertTriangleIcon, InfoIcon } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePublicConfig } from '@/config/public-config';
import { cn } from '@/lib/utils';
import { marketText, parentMarket, scoreExplanationText, valueListLabel } from '@/lib/value-label';

import { ScorePill } from './ScorePill';
import { TierChip } from './TierChip';

const pct = (w: number) => `${Math.round(w * 100)}%`;
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** The attribute-by-attribute explanation of a score (B-08). Used in the popover and the G1 dialog. */
export function ScoreBreakdownTable({
  priority,
  className,
  market,
}: {
  priority: QuotePriority;
  className?: string;
  /** FB-12: the quote's market and sub-market, shown as "Market › Sub-market" next to strategic fit. */
  market?: { market: string | null; subMarket: string | null };
}) {
  const { data: config } = usePublicConfig();
  /** The market (and sub-market) the strategic-fit points came from: the quote's own when the caller gave it. */
  const fitText = (raw: string | number | null): string | null => {
    if (market && (market.market || market.subMarket)) {
      return marketText(config, market.market, market.subMarket);
    }
    if (raw === null) return null;
    const parent = parentMarket(config, String(raw));
    return parent
      ? marketText(config, parent, String(raw))
      : valueListLabel(config, 'market', String(raw));
  };
  if (!priority.visible) {
    return (
      <p className="text-muted-foreground text-sm">
        Priority scores of other KAMs’ quotes are hidden.
      </p>
    );
  }
  if (priority.score === null || priority.breakdown.length === 0) {
    return <p className="text-muted-foreground text-sm">Not scored yet.</p>;
  }
  return (
    <div className={cn('grid gap-2', className)}>
      <table className="w-full text-left text-xs" data-testid="score-breakdown">
        <thead className="text-muted-foreground">
          <tr>
            <th scope="col" className="py-1 pr-2 font-medium">
              Attribute
            </th>
            <th scope="col" className="py-1 pr-2 text-right font-medium">
              Weight
            </th>
            <th scope="col" className="py-1 pr-2 text-right font-medium">
              Points
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Adds
            </th>
          </tr>
        </thead>
        <tbody>
          {priority.breakdown.map((b) => (
            <tr key={b.key} className="border-t align-top">
              <th scope="row" className="py-1.5 pr-2 font-normal">
                <span className="font-medium">{b.label}</span>
                {b.provisional && (
                  <span
                    className="bg-secondary text-foreground-2 rounded-pill ml-2 px-1.5 py-0.5 text-[0.6875rem] font-medium"
                    data-testid={`score-provisional-${b.key}`}
                    title="No points are set for this attribute yet (decision D-004 is open), so every value scores the neutral default."
                  >
                    provisional
                  </span>
                )}
                {b.key === 'strategic_fit' && fitText(b.raw) !== null && (
                  <span className="text-foreground-2 block" data-testid="score-market">
                    Market: {fitText(b.raw)}
                  </span>
                )}
                <span className={cn('text-muted-foreground block', b.unknown && 'italic')}>
                  {scoreExplanationText(config, b.raw, b.explanation)}
                </span>
              </th>
              <td className="py-1.5 pr-2 text-right tabular-nums">{pct(b.weight)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{num(b.points)}</td>
              <td className="py-1.5 text-right tabular-nums">{num(b.contribution)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t font-semibold">
            <th scope="row" colSpan={3} className="py-1.5 pr-2 text-right">
              Score
            </th>
            <td className="py-1.5 text-right tabular-nums">{num(priority.score)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="text-muted-foreground text-xs">
        Model v{priority.modelVersion ?? '–'} (provisional weights). Advisory only: it orders the
        queue; a person decides.
        {priority.unknowns.length > 0 &&
          ` ${priority.unknowns.length} input${priority.unknowns.length > 1 ? 's' : ''} unknown, scored neutral.`}
        {priority.tierOverridden &&
          ` Tier overridden to ${priority.tierLabel ?? priority.tier}; the score's own tier is ${
            priority.computedTierLabel ?? priority.computedTier
          }.`}
      </p>
    </div>
  );
}

/**
 * Score pill + tier chip + "Why this priority?" popover. Shows the override tier when one applies (B-09)
 * while the explanation keeps the computed score.
 */
export function PriorityBadge({
  priority,
  quoteNumber,
  showWhy = true,
  className,
  market,
}: {
  priority: QuotePriority;
  quoteNumber: string;
  showWhy?: boolean;
  className?: string;
  market?: { market: string | null; subMarket: string | null };
}) {
  if (!priority.visible) {
    return (
      <span
        className={cn('text-muted-foreground text-xs', className)}
        data-testid="priority-hidden"
      >
        Priority hidden
      </span>
    );
  }
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
      <ScorePill score={priority.score} />
      {priority.tier && (
        <TierChip
          tier={priority.tier}
          label={priority.tierLabel}
          overridden={priority.tierOverridden}
        />
      )}
      {showWhy && priority.score !== null && (
        <Popover>
          <PopoverTrigger
            className="text-emphasis inline-flex min-h-11 items-center gap-1 rounded px-1 text-xs sm:min-h-8 underline-offset-4 hover:underline"
            aria-label={`Why this priority? ${quoteNumber}`}
          >
            <InfoIcon className="size-3.5" aria-hidden="true" />
            Why?
          </PopoverTrigger>
          <PopoverContent className="w-[min(28rem,calc(100vw-2rem))]" align="start">
            <p className="mb-2 text-sm font-semibold">Why this priority?</p>
            <ScoreBreakdownTable priority={priority} {...(market ? { market } : {})} />
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}

/** G1 qualification screens (D-06): warnings only, never a block. */
/**
 * FB-10 (F-066): the platform-minimum warning the KAM saw at submit, kept for the qualifier. A warning only:
 * it never blocks a decision and needs no exception note.
 */
export function GuardrailNote({ text, className }: { text: string | null; className?: string }) {
  if (!text) return null;
  return (
    <p
      className={cn(
        'bg-warning text-warning-foreground flex items-start gap-2 rounded-md px-2.5 py-1.5 text-xs',
        className,
      )}
      data-testid="guardrail-note"
    >
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}

export function QualificationWarnings({
  warnings,
  className,
}: {
  warnings: readonly QualificationWarning[];
  className?: string;
}) {
  if (warnings.length === 0) return null;
  return (
    <ul className={cn('grid gap-1', className)} data-testid="qualification-warnings">
      {warnings.map((w) => (
        <li
          key={w.code}
          className="bg-warning text-warning-foreground flex items-start gap-2 rounded-md px-2.5 py-1.5 text-xs"
        >
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{w.message}</span>
        </li>
      ))}
    </ul>
  );
}
