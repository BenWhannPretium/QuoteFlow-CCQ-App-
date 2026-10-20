import { usePublicConfig } from '@/config/public-config';
import { cn } from '@/lib/utils';

/**
 * A quote's place in the stage model, drawn as a measured ruler: one tick per stage (from config,
 * in order), filled up to the current stage, with a copper mark on it. A closed quote shows its
 * terminal stage at the end; the stages before it stay neutral because the rail does not know which
 * ones it passed (the time-in-stage bar has that history).
 */
export function GateRail({ stageKey, className }: { stageKey: string; className?: string }) {
  const { data } = usePublicConfig();
  if (!data) return null;
  const ordered = [...data.stages].sort((a, b) => a.sort - b.sort);
  const current = ordered.find((s) => s.key === stageKey);
  const steps = ordered.filter((s) => !s.terminal);
  if (current?.terminal) steps.push(current);
  const at = steps.findIndex((s) => s.key === stageKey);
  const closed = current?.terminal ?? false;

  return (
    <ol
      aria-label="Stage progress"
      data-testid="gate-rail"
      className={cn('grid', className)}
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((stage, i) => {
        const state = i === at ? 'current' : !closed && i < at ? 'done' : 'todo';
        return (
          <li
            key={stage.key}
            aria-current={state === 'current' ? 'step' : undefined}
            className="relative min-w-0 pt-5"
          >
            {/* Track to the next tick. */}
            {i < steps.length - 1 && (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-[7px] right-0 left-0',
                  state === 'done' ? 'bg-primary h-[2px]' : 'bg-line-strong h-px',
                )}
              />
            )}
            {/* Fine ticks between stages. */}
            {i < steps.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute top-[8px] right-0 left-0 h-[4px] opacity-70"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(90deg, var(--pf-line-2) 0 1px, transparent 1px 12.5%)',
                }}
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                'absolute top-0 left-0 h-[15px] w-px',
                state === 'done' ? 'bg-primary' : 'bg-line-strong',
              )}
            />
            {state === 'current' && (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-[3px] -left-[4px] size-[9px] rotate-45',
                  closed ? 'bg-foreground-2' : 'bg-action',
                )}
              />
            )}
            <span
              className={cn(
                'spec-label block truncate pr-3 text-[0.625rem]',
                state === 'current'
                  ? closed
                    ? 'text-foreground'
                    : 'text-emphasis'
                  : 'hidden sm:block',
                state === 'done' && 'text-foreground-2',
                state === 'todo' && 'text-muted-foreground',
              )}
              title={stage.label}
            >
              {stage.label}
              <span className="sr-only">
                {state === 'current' ? ' (current)' : state === 'done' ? ' (complete)' : ''}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
