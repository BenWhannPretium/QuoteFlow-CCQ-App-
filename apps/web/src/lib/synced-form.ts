import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

/** Two flat sets of form values are the same. */
export const sameFormValues = <T extends object>(a: T, b: T): boolean =>
  (Object.keys(a) as (keyof T)[]).every((k) => a[k] === b[k]);

/**
 * The form after the server's values moved under it (`base` is what they were, `server` what they are
 * now). A field the user has not touched follows the server; a field they have typed in keeps what they
 * typed. Returns `form` itself when nothing changes.
 */
export function adoptServerValues<T extends object>(form: T, base: T, server: T): T {
  let next = form;
  for (const k of Object.keys(server) as (keyof T)[]) {
    if (form[k] === base[k] && form[k] !== server[k]) {
      if (next === form) next = { ...form };
      next[k] = server[k];
    }
  }
  return next;
}

/**
 * Form state for a card whose saved values can change while it is open: the same person saving in
 * another browser tab, or a lead who may also edit. `server` is the form as the latest read of the
 * quote gives it.
 *
 * A card that kept its own copy and compared it with the live values read every such change as the
 * user's own unsaved edit (UX-001 then held "Submit to lead" back for someone who had typed nothing),
 * and its Save sent the old values back over the other person's. Here an untouched field follows the
 * server and only what was typed differs from it, so "differs from `server`" means "typed and not
 * saved", and a save sends only that.
 */
export function useSyncedForm<T extends object>(server: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState({ form: server, base: server });
  let current = state;
  if (!sameFormValues(state.base, server)) {
    current = { form: adoptServerValues(state.form, state.base, server), base: server };
    setState(current);
  }
  const setForm = useCallback<Dispatch<SetStateAction<T>>>(
    (action) =>
      setState((s) => ({
        ...s,
        form: typeof action === 'function' ? action(s.form) : action,
      })),
    [],
  );
  return [current.form, setForm];
}
