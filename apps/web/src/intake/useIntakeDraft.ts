import type { IntakeDraft, IntakeDraftData } from '@ccq/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';

/** Autosave cadence while the KAM types (plus a save on every step change and on leaving). */
export const AUTOSAVE_MS = 5_000;

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

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

  // What the next save sends; kept in step with every edit (never written during render).
  const latest = useRef({ data: initial.data, step: initial.step });
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);

  const save = useCallback(async (): Promise<void> => {
    if (inFlight.current) await inFlight.current;
    if (revision.current === savedRevision.current) return;
    const target = revision.current;
    setSaveState('saving');
    const run = api
      .patchDraft(initial.id, { data: latest.current.data, step: latest.current.step })
      .then((saved) => {
        savedRevision.current = target;
        setActiveQuote(saved.activeQuote);
        setSavedAt(new Date());
        setSaveState(revision.current === target ? 'saved' : 'dirty');
      })
      .catch(() => {
        setSaveState('error');
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
    flush: save,
    saveState,
    savedAt,
    activeQuote,
  };
}

export type IntakeDraftState = ReturnType<typeof useIntakeDraft>;
