import { usePublicConfig, stageLabel } from '@/config/public-config';
import { cn } from '@/lib/utils';

/** A quote's stage, labelled from config (falls back to the key while config loads). */
export function StageBadge({ stageKey, className }: { stageKey: string; className?: string }) {
  const { data } = usePublicConfig();
  const stage = data?.stages.find((s) => s.key === stageKey);
  return (
    <span
      data-stage={stageKey}
      className={cn(
        'rounded-pill border-line-strong text-foreground-2 bg-card inline-flex items-center gap-1.5 border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        stage?.terminal && 'bg-muted',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 rounded-full',
          stage?.terminal ? 'bg-muted-foreground' : 'bg-primary',
        )}
      />
      {stageLabel(data, stageKey)}
    </span>
  );
}
