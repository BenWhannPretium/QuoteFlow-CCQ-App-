import * as React from 'react';

import { cn } from '@/lib/utils';

/** 16 px text on mobile so iOS Safari doesn't zoom on focus. */
const controlClass =
  'border-input bg-card text-foreground placeholder:text-muted-foreground w-full min-w-0 rounded-md border px-3 text-base sm:text-sm disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(controlClass, 'min-h-11 py-2 sm:min-h-10', className)}
      {...props}
    />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(controlClass, 'min-h-24 py-2', className)}
      {...props}
    />
  );
}

function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(controlClass, 'min-h-11 py-2 sm:min-h-10', className)}
      {...props}
    />
  );
}

export { controlClass, Input, NativeSelect, Textarea };
