import { EyeOffIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';

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
  return (
    <div className={cn('grid content-start gap-1.5', error && 'text-destructive')}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children(id)}
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
      {error && (
        <span className="text-destructive text-xs" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function FormErrors({ errors }: { errors: ServerError[] }) {
  if (errors.length === 0) return null;
  return (
    <ul role="alert" className="text-destructive grid gap-1 text-sm">
      {errors.map((e) => (
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
