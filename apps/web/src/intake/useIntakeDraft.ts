import type { IntakeDraft, IntakeDraftData } from '@ccq/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, isApiError } from '@/lib/api';

/** Autosave cadence while the KAM types (plus a save on every step change and on leaving). */
export const AUTOSAVE_MS = 5_000;

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

/**
 * FB-15 (W13-01): `flush()` rejects with this when the latest change is not on the server (the save failed,
 * or the draft was changed in another tab). Submit then shows it instead of submitting an older copy.
 */
export class DraftNotSavedError extends Error {
  constructor(
    message: string,
    readonly conflict: boolean,
  ) {
    super(message);
    this.name = 'DraftNotSavedError';
  }
}

export const CONFLICT_MESSAGE =
  'This draft was changed in another tab or window. Reload to see the latest; your latest change here is not saved.';

/**
 * Local draft state with autosave. Edits mark the draft dirty; every 5 s a dirty draft is PATCHed,
 * and `flush()` saves immediately (step changes, submit). Edits made while a save is in flight stay
 * dirty and go out with the next save.
 */
export function useIntakeDraft(initial: IntakeDraft) {
  const [data, setData] = useState<IntakeDraftData>(initial.data);
  const [step, setStepState] = useState<number>(initial.step);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [activeQuote, setActiveQuote] = useState(initial.activeQuote);
  // FB-02 (T-009): the SF close date as of the latest sync; refreshed by every save (re-picks too).
  const [sfCloseDate, setSfCloseDate] = useState(initial.sfCloseDate);

  // What the next save sends; kept in step with every edit (never written during render).
  const latest = useRef({ data: initial.data, step: initial.step });
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  // DR-kam-sales-leader-05: the version this copy is based on; a save from an older copy is refused.
  const version = useRef(initial.updatedAt);
  const conflicted = useRef(false);
  // FB-15 (W13-01): why the last save failed (e.g. a 422 "Pick a resin from the list"), until one succeeds.
  const lastError = useRef<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = useCallback(async (): Promise<void> => {
    if (inFlight.current) await inFlight.current;
    if (revision.current === savedRevision.current || conflicted.current) return;
    const target = revision.current;
    setSaveState('saving');
    const run = api
      .patchDraft(initial.id, {
        data: latest.current.data,
        step: latest.current.step,
        expectedUpdatedAt: version.current,
      })
      .then((saved) => {
        version.current = saved.updatedAt;
        savedRevision.current = target;
        setActiveQuote(saved.activeQuote);
        setSfCloseDate(saved.sfCloseDate);
        setSavedAt(new Date());
        lastError.current = null;
        setSaveError(null);
        setSaveState(revision.current === target ? 'saved' : 'dirty');
      })
      .catch((err: unknown) => {
        // Saved in another tab since: stop autosaving here and say so (no silent overwrite).
        if (isApiError(err, 409)) {
          conflicted.current = true;
          setSaveState('conflict');
        } else {
          lastError.current = isApiError(err)
            ? err.message
            : 'the connection failed. Check your network and try again.';
          setSaveError(lastError.current);
          setSaveState('error');
        }
      })
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = run;
    await run;
  }, [initial.id]);

  const update = useCallback((patch: Partial<IntakeDraftData>) => {
    revision.current += 1;
    const next = { ...latest.current.data, ...patch };
    latest.current = { ...latest.current, data: next };
    setData(next);
    setSaveState('dirty');
  }, []);

  const setStep = useCallback(
    async (next: number) => {
      revision.current += 1;
      latest.current = { ...latest.current, step: next };
      setStepState(next);
      await save();
    },
    [save],
  );

  /**
   * Save now and resolve only when the server has every change (step changes, submit). FB-15 (W13-01):
   * rejects with `DraftNotSavedError` when the save failed or the draft is in conflict, so a submit never
   * runs against an older server copy.
   */
  const flush = useCallback(async (): Promise<void> => {
    await save();
    if (conflicted.current) throw new DraftNotSavedError(CONFLICT_MESSAGE, true);
    if (revision.current !== savedRevision.current) {
      throw new DraftNotSavedError(lastError.current ?? 'it could not be saved.', false);
    }
  }, [save]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (revision.current !== savedRevision.current) void save();
    }, AUTOSAVE_MS);
    return () => window.clearInterval(timer);
  }, [save]);

  // Leaving the page: one last best-effort save.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && revision.current !== savedRevision.current) {
        void save();
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      if (revision.current !== savedRevision.current) void save();
    };
  }, [save]);

  return {
    id: initial.id,
    data,
    step,
    update,
    setStep,
    flush,
    saveState,
    saveError,
    savedAt,
    activeQuote,
    sfCloseDate,
  };
}

export type IntakeDraftState = ReturnType<typeof useIntakeDraft>;
