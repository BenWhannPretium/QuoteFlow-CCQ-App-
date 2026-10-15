import { CheckCircle2Icon, InfoIcon, XCircleIcon, XIcon } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import { dismissToast, toastStore, type Toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

const ICON = { info: InfoIcon, success: CheckCircle2Icon, error: XCircleIcon } as const;

/** Renders the toast queue (lib/toast). Mounted once, outside the auth gate. */
export function Toaster() {
  const toasts = useSyncExternalStore(
    toastStore.subscribe,
    toastStore.getSnapshot,
    toastStore.getSnapshot,
  );
  return (
    <section
      aria-label="Messages"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:items-end"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </section>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const Icon = ICON[toast.variant];
  return (
    <div
      role={toast.variant === 'error' ? 'alert' : 'status'}
      data-variant={toast.variant}
      className="bg-card text-card-foreground shadow-card rounded-card animate-in fade-in-0 slide-in-from-bottom-2 pointer-events-auto flex w-full max-w-sm items-start gap-3 border p-3 pl-4"
    >
      <Icon
        aria-hidden="true"
        className={cn(
          'mt-0.5 size-5 shrink-0',
          toast.variant === 'error' && 'text-destructive',
          toast.variant === 'success' && 'text-success',
          toast.variant === 'info' && 'text-primary',
        )}
      />
      <div className="grid min-w-0 flex-1 gap-0.5 py-0.5">
        <p className="text-sm font-semibold">{toast.title}</p>
        {toast.description && <p className="text-muted-foreground text-sm">{toast.description}</p>}
      </div>
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        className="text-muted-foreground hover:text-foreground -my-1 inline-flex size-11 shrink-0 items-center justify-center rounded-md sm:size-9"
      >
        <XIcon className="size-4" aria-hidden="true" />
        <span className="sr-only">Dismiss</span>
      </button>
    </div>
  );
}
