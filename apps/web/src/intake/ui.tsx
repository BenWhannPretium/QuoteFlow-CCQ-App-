import { AlertTriangleIcon, CheckIcon, CircleAlertIcon } from 'lucide-react';
import { useId, useRef, type ReactNode } from 'react';

import { RequiredLabel } from '@/components/forms';
import { SectionToggle } from '@/components/SectionToggle';
import { useCollapsible } from '@/lib/collapse';
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
    // `content-start`: in a row of fields, a taller neighbour (longer help, a Salesforce note) must not
    // stretch this field's label and control rows, or the controls drift out of line.
    <div className={cn('grid min-w-0 content-start gap-1.5', className)} data-field={id}>
      <label htmlFor={id} className="text-sm font-medium" data-required={required || undefined}>
        {/* FB-15 (W13-02): a red asterisk before the label, not a grey "(required)" after it. */}
        <RequiredLabel required={Boolean(required)}>{label}</RequiredLabel>
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

/**
 * Amber = "Engineering may ask" (worth checking; you can still go on); blocking = needed before submit.
 * FB-24 (N17-09, Bailey Schmitt): blocking is "that transparent red": a light red fill (the destructive
 * token at low opacity) with a red border and its icon, so it no longer reads like a warning. Body text
 * stays the foreground colour (never red text on red); the icon is red. `FlagKey` explains the two.
 */
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
        tone === 'blocking' && 'border-destructive bg-destructive/10 text-foreground border-2',
        tone === 'info' && 'bg-muted text-foreground',
        className,
      )}
    >
      {tone !== 'info' && (
        <Icon
          aria-hidden
          className={cn('mt-0.5 size-4 shrink-0', tone === 'blocking' && 'text-destructive')}
        />
      )}
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
      {/* UX-018: on a desktop the line is not shown, but it stays in the page for a screen reader:
          hidden with display:none, a change of step was announced on a phone only. */}
      <p className="text-muted-foreground mb-2 text-sm sm:sr-only" aria-live="polite">
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
  const root = useRef<HTMLElement>(null);
  const bodyId = useId();
  // Collapsible like every section a user fills in (lib/collapse); the body stays mounted while hidden.
  const { collapsed, toggle } = useCollapsible(root);
  return (
    <section
      ref={root}
      data-collapsed={collapsed}
      className="bg-card rounded-card shadow-card grid gap-4 border p-4 sm:p-5"
    >
      {/* UX-018: the title and its action share a row only while both fit. At 320 px "Ship / fill
          destination" beside "Change destination" was a pixel-tight fit (2 px too wide on Linux), which
          scrolled the page sideways; the action now drops under the title. */}
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 className="min-w-0 text-base font-semibold">{title}</h2>
          {!collapsed && action}
        </div>
        <SectionToggle
          collapsed={collapsed}
          onToggle={toggle}
          controls={bodyId}
          headingRoot={root}
        />
      </div>
      <div id={bodyId} hidden={collapsed || undefined} className="grid gap-4">
        {children}
      </div>
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

/** FB-02 (F-008): marks a value pre-filled from Salesforce (read-only unless the field allows a change). */
export function SfTag({ testId }: { testId?: string }) {
  return (
    <Pill className="bg-muted text-muted-foreground font-medium">
      <span data-testid={testId}>from Salesforce</span>
    </Pill>
  );
}

/** A read-only value with its "from Salesforce" tag, labelled for screen readers like a field. */
export function ReadOnlyValue({
  id,
  label,
  value,
  help,
  testId,
}: {
  id: string;
  label: string;
  value: ReactNode;
  help?: string | undefined;
  /** Accepted (and ignored) so field props from config can be spread in. */
  required?: boolean;
  testId?: string;
}) {
  return (
    <div className="grid min-w-0 content-start gap-1.5" data-field={id}>
      <span id={`${id}-label`} className="text-sm font-medium">
        {label}
      </span>
      {/* As tall as a control and right under the label, so it lines up with an input beside it. The
          "from Salesforce" tag sits under it, where a pre-filled control has its note. */}
      <p
        id={id}
        aria-labelledby={`${id}-label`}
        data-testid={testId}
        className="bg-muted/50 flex min-h-11 items-center rounded-md px-3 py-2 text-sm break-words sm:min-h-10"
      >
        {value}
      </p>
      <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
        <SfTag />
        {help && <span id={`${id}-help`}>{help}</span>}
      </p>
    </div>
  );
}

/**
 * A conditional field group (FB-02): mounted only while it applies, so hidden fields are neither
 * tabbable nor read out; it eases in with the design system's enter animation (none when the user
 * prefers reduced motion).
 */
export function Reveal({ when, children }: { when: boolean; children: ReactNode }) {
  if (!when) return null;
  return (
    <div className="animate-in fade-in-0 slide-in-from-top-1 grid content-start gap-4 motion-reduce:animate-none">
      {children}
    </div>
  );
}
