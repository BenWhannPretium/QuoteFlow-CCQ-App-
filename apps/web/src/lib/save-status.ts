/**
 * FB-18 (W13-30; Ben Whann and Bailey Schmitt, 2026-11-13): say "Progress saved" beside the Save
 * button, where the eye already is. The toast in the corner is easy to miss; it stays as well.
 * This file is the logic (no React); the component is `SaveStatus` in `components/forms.tsx`.
 */
export type SaveStatusKind = 'saving' | 'saved' | 'failed';

export interface SaveStatusView {
  kind: SaveStatusKind;
  /** `status` is announced politely; a failure is an `alert`. */
  role: 'status' | 'alert';
  text: string;
}

export interface SaveStatusState {
  saving?: boolean | undefined;
  /** The last save succeeded and the form has not changed since. */
  saved?: boolean | undefined;
  /** Why the last save failed (`saveFailureReason`); null or empty when it did not. */
  error?: string | null | undefined;
}

export const SAVING_TEXT = 'Saving…';
/** The words Ben and Bailey asked for. */
export const SAVED_TEXT = 'Progress saved';

/** What the line beside a Save button says, or null for nothing: saving, else why it failed, else saved. */
export function saveStatusView(state: SaveStatusState): SaveStatusView | null {
  if (state.saving) return { kind: 'saving', role: 'status', text: SAVING_TEXT };
  if (state.error) return { kind: 'failed', role: 'alert', text: `Not saved: ${state.error}` };
  if (state.saved) return { kind: 'saved', role: 'status', text: SAVED_TEXT };
  return null;
}

const NO_REASON = 'something went wrong. Try again.';

/**
 * The reason after "Not saved:", from the messages a failed save came back with: the first one, and how
 * many more there are (each is also shown in the form, under its field or in the list of errors).
 */
export function saveFailureReason(messages: readonly string[]): string {
  const distinct = [...new Set(messages.map((m) => m.trim()).filter(Boolean))];
  const [first, ...rest] = distinct;
  if (first === undefined) return NO_REASON;
  return rest.length === 0 ? first : `${first} (and ${rest.length} more)`;
}

// ── Which forms were just saved ────────────────────────────────────────────────────────────────
//
// "Saved" cannot live in a form's own state: several cards are re-keyed by the server's answer (a new
// `updatedAt`, new row ids), which remounts them the moment the save lands, and some Save buttons sit
// in a dialog that closes. So it is kept here, per scope (a string naming the form and its record).
// A scope is forgotten once no form with that scope is on screen, so "Progress saved" never greets a
// user who left the page and came back.

const savedScopes = new Set<string>();
const mountedScopes = new Map<string, number>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

// Arrow properties, not methods: `subscribe` is handed to `useSyncExternalStore` on its own.
export const savedStore = {
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  isSaved: (scope: string): boolean => savedScopes.has(scope),
  mark: (scope: string): void => {
    if (savedScopes.has(scope)) return;
    savedScopes.add(scope);
    emit();
  },
  clear: (scope: string): void => {
    if (savedScopes.delete(scope)) emit();
  },
  /**
   * A form with this scope is on screen; call the returned function when it leaves. A re-keyed card
   * leaves and comes back in one render, so the scope is forgotten a tick later, and only if nothing
   * with that scope is on screen by then.
   */
  mount: (scope: string): (() => void) => {
    mountedScopes.set(scope, (mountedScopes.get(scope) ?? 0) + 1);
    return () => {
      const left = (mountedScopes.get(scope) ?? 1) - 1;
      if (left > 0) mountedScopes.set(scope, left);
      else mountedScopes.delete(scope);
      setTimeout(() => {
        if (!mountedScopes.has(scope)) savedStore.clear(scope);
      }, 0);
    };
  },
  /** Tests only. */
  reset: (): void => {
    savedScopes.clear();
    mountedScopes.clear();
    emit();
  },
};
