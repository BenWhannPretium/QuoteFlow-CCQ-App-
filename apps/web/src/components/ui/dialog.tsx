import { XIcon } from 'lucide-react';
import { AlertDialog as AlertDialogPrimitive, Dialog as DialogPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from '@/lib/utils';

const overlayClass =
  'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50';

/** Bottom sheet on mobile, centred card from `sm` up. */
const contentClass =
  'bg-card text-card-foreground shadow-card data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-x-0 bottom-0 z-50 grid max-h-[90dvh] gap-4 overflow-y-auto rounded-t-card border p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card sm:p-6';

/**
 * Return focus to whatever opened the dialog. Radix only restores focus to a `<Dialog.Trigger>`;
 * our dialogs are usually opened from state (`open` prop), which would otherwise drop focus to
 * <body> on close.
 */
function useReturnFocus(
  onOpenAutoFocus?: (e: Event) => void,
  onCloseAutoFocus?: (e: Event) => void,
) {
  const returnTo = React.useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (e: Event) => {
      returnTo.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      onOpenAutoFocus?.(e);
    },
    onCloseAutoFocus: (e: Event) => {
      onCloseAutoFocus?.(e);
      if (e.defaultPrevented || !returnTo.current?.isConnected) return;
      e.preventDefault();
      returnTo.current.focus();
    },
  };
}

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogContent({
  className,
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  const focus = useReturnFocus(onOpenAutoFocus, onCloseAutoFocus);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content className={cn(contentClass, className)} {...props} {...focus}>
        {children}
        <DialogPrimitive.Close className="text-muted-foreground hover:text-foreground absolute top-2 right-2 inline-flex size-11 items-center justify-center rounded-md">
          <XIcon className="size-5" aria-hidden="true" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('grid gap-1.5 pr-10', className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('font-display text-xl leading-tight', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogCancel = AlertDialogPrimitive.Cancel;
const AlertDialogAction = AlertDialogPrimitive.Action;

function AlertDialogContent({
  className,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  const focus = useReturnFocus(onOpenAutoFocus, onCloseAutoFocus);
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className={overlayClass} />
      <AlertDialogPrimitive.Content className={cn(contentClass, className)} {...props} {...focus} />
    </AlertDialogPrimitive.Portal>
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      className={cn('font-display text-xl leading-tight', className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
};
