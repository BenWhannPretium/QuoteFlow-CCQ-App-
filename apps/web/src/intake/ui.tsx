import { AlertTriangleIcon, CheckIcon, CircleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { STEPS } from './model';

/**
 * One labelled control with its one-line "why we ask" help (config `intake_field_help`), an
 * optional amber note and the required marker for fields a blocking rule reads.
 */
export function Field({
  id,
  label,
  help,
  required,
  note,
  children,
  className,
}: {
  id: string;
  label: string;
  help?: string | undefined;
  required?: boolean;
  /** Amber, non-blocking note (e.g. "Quotes without a drawing usually take longer"). */
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid min-w-0 gap-1.5', className)} data-field={id}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && (
          <span className="text-muted-foreground ml-1 text-xs font-normal">(required)</span>
        )}
      </label>
      {children}
      {help && (
        <p id={`${id}-help`} className="text-muted-foreground text-xs">
          {help}
        </p>
      )}
      {note && <Notice tone="warning">{note}</Notice>}
    </div>
  );
}

/** Amber = "Engineering may ask"; blocking = needed before submit. Neither uses red text on red. */
export function Notice({
  tone,
  children,
  className,
  testId,
}: {
  tone: 'warning' | 'blocking' | 'info';
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const Icon = tone === 'blocking' ? CircleAlertIcon : AlertTriangleIcon;
  return (
    <div
      data-testid={testId}
      data-tone={tone}
      className={cn(
        'flex items-start gap-2 rounded-md px-3 py-2 text-sm',
        tone === 'warning' && 'bg-warning text-warning-foreground',
        tone === 'blocking' && 'border-destructive bg-card border-2',
        tone === 'info' && 'bg-muted text-foreground',
        className,
      )}
    >
      {tone !== 'info' && <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Step indicator: full labels from `sm`, "Step n of 4 · Title" on a phone. */
export function Stepper({
  current,
  onSelect,
  canSelect,
}: {
  current: number;
  onSelect: (n: number) => void;
  canSelect: (n: number) => boolean;
}) {
  const title = STEPS.find((s) => s.n === current)?.title ?? '';
  return (
    <nav aria-label="Intake steps" className="mb-6">
      <p className="text-muted-foreground mb-2 text-sm sm:hidden" aria-live="polite">
        Step {current} of {STEPS.length} · <span className="text-foreground">{title}</span>
      </p>
      <ol className="flex gap-1.5 sm:gap-2">
        {STEPS.map((s) => {
          const done = s.n < current;
          const active = s.n === current;
          return (
            <li key={s.n} className="min-w-0 flex-1">
              <button
                type="button"
                disabled={!canSelect(s.n)}
                onClick={() => onSelect(s.n)}
                aria-current={active ? 'step' : undefined}
                aria-label={`Step ${s.n}: ${s.title}`}
                className={cn(
                  'flex min-h-11 w-full flex-col items-start gap-1 text-left disabled:cursor-default',
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-full rounded-full',
                    active || done ? 'bg-primary' : 'bg-muted',
                  )}
                />
                <span
                  className={cn(
                    'hidden items-center gap-1 text-xs sm:flex',
                    active ? 'text-foreground font-semibold' : 'text-muted-foreground',
                  )}
                >
                  {done && <CheckIcon aria-hidden className="size-3" />}
                  {s.n}. {s.title}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="bg-card rounded-card shadow-card grid gap-4 border p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'rounded-pill inline-flex items-center px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        className,
      )}
    >
      {children}
    </span>
  );
}
