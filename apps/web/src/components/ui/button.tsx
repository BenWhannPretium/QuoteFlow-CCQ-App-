import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Copper (`action`) is the call to action; green (`primary`) is for brand emphasis and selected
 * states. Default size is 44 px tall on mobile (tap target) and 40 px from `sm` up.
 */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-pill text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  {
    variants: {
      variant: {
        action: 'bg-action text-action-foreground hover:bg-action-hover',
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-line-strong bg-card text-foreground hover:bg-accent',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'text-foreground hover:bg-accent',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        link: 'text-emphasis underline-offset-4 hover:underline',
      },
      size: {
        default: 'min-h-11 px-5 sm:min-h-10',
        sm: 'min-h-11 px-3 text-sm sm:min-h-8',
        lg: 'min-h-12 px-6 text-base',
        icon: 'size-11 sm:size-10',
      },
    },
    defaultVariants: { variant: 'action', size: 'default' },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...(asChild ? {} : { type: type ?? 'button' })}
      {...props}
    />
  );
}

export { Button, buttonVariants };
