/**
 * A small toast store (no dependency, so nothing injects <style> tags the CSP would block).
 * Call `toast.error(...)` anywhere; <Toaster> renders the queue.
 */
export type ToastVariant = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  variant: ToastVariant;
  title: string;
  description?: string;
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. */
  duration: number;
}

export interface ToastInput {
  title: string;
  description?: string;
  duration?: number;
  /** Identical toasts with the same key replace each other instead of stacking. */
  key?: string;
}

const MAX_VISIBLE = 4;
const DEFAULT_DURATION: Record<ToastVariant, number> = { info: 5000, success: 5000, error: 10000 };

let nextId = 1;
let toasts: readonly Toast[] = [];
const keys = new Map<number, string>();
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) listener();
}

export function dismissToast(id: number) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  keys.delete(id);
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function push(variant: ToastVariant, input: ToastInput): number {
  if (input.key) {
    for (const [id, key] of keys) if (key === input.key) dismissToast(id);
  }
  const id = nextId++;
  const duration = input.duration ?? DEFAULT_DURATION[variant];
  const item: Toast = { id, variant, title: input.title, duration };
  if (input.description) item.description = input.description;
  if (input.key) keys.set(id, input.key);
  toasts = [...toasts, item].slice(-MAX_VISIBLE);
  if (duration > 0)
    timers.set(
      id,
      setTimeout(() => dismissToast(id), duration),
    );
  emit();
  return id;
}

export const toast = {
  info: (input: ToastInput) => push('info', input),
  success: (input: ToastInput) => push('success', input),
  error: (input: ToastInput) => push('error', input),
};

export const toastStore = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => toasts,
  /** Tests only. */
  reset: () => {
    for (const id of [...timers.keys()]) dismissToast(id);
    toasts = [];
    keys.clear();
    emit();
  },
};
