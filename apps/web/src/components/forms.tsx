import { EyeOffIcon } from 'lucide-react';
import { cloneElement, isValidElement, useId, type ReactNode } from 'react';

import { isApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

// Small form helpers shared by the Engineering (B-10) and Quoting (B-11) tabs.

export interface ServerError {
  path: string;
  message: string;
}

/** A problem+json's `errors[]` (or its detail) as field errors. */
export const problemErrors = (err: unknown): ServerError[] =>
  isApiError(err)
    ? ((err.problem as { errors?: ServerError[] }).errors ?? [
        { path: '/', message: err.problem.detail ?? err.problem.title },
      ])
    : [{ path: '/', message: 'Something went wrong. Try again.' }];

export function errorFor(errors: ServerError[], field: string): string | undefined {
  return errors.find((e) => e.path === `/${field}`)?.message;
}

/**
 * A labelled form field. The control's hint and error are tied to it with `aria-describedby`, and an
 * error sets `aria-invalid` (DR-engineering-01: a screen reader hears the message with the field).
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;
  const control = children(id);
  const wired = isValidElement<Record<string, unknown>>(control)
    ? cloneElement(control, {
        'aria-describedby':
          [control.props['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined,
        ...(error ? { 'aria-invalid': true } : {}),
      })
    : control;
  return (
    <div className={cn('grid content-start gap-1.5', error && 'text-destructive')}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {wired}
      {hint && (
        <span id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="text-destructive text-xs" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * The errors that have no field of their own. Pass `inline` (the paths a `Field` already shows) so a
 * message is shown once, not under the field and again here (DR-engineering-01, DR-pricing-finance-06).
 * The same message is listed once.
 */
export function FormErrors({
  errors,
  inline,
}: {
  errors: ServerError[];
  inline?: (path: string) => boolean;
}) {
  const seen = new Set<string>();
  const shown = errors.filter((e) => {
    if (inline?.(e.path) || seen.has(e.message)) return false;
    seen.add(e.message);
    return true;
  });
  if (shown.length === 0) return null;
  return (
    <ul role="alert" className="text-destructive grid gap-1 text-sm">
      {shown.map((e) => (
        <li key={e.path + e.message}>{e.message}</li>
      ))}
    </ul>
  );
}

export function HiddenValue() {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <EyeOffIcon className="size-3.5" aria-hidden="true" />
      Hidden (commercial)
    </span>
  );
}
