import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';

/**
 * Collapsible sections (Ben, 2026-11-20): every section a user fills in can be collapsed on its own, and
 * "Collapse all" / "Expand all" sets every section at once. Sections start expanded. The all-at-once
 * choice is remembered in this browser (a per-viewer convenience, so it may come back empty), and a
 * section that mounts later (another tab, another quote) starts the way it says.
 */
export type SectionsMode = 'expanded' | 'collapsed';

const KEY = 'ccq.sections';
const REVEAL = 'ccq:reveal';

function stored(): SectionsMode {
  try {
    return globalThis.localStorage?.getItem(KEY) === 'collapsed' ? 'collapsed' : 'expanded';
  } catch {
    return 'expanded';
  }
}

let mode: SectionsMode = stored();
/** Bumped by every "all" switch, so sections follow it even when the mode does not change. */
let version = 0;
const listeners = new Set<() => void>();

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const sectionsStore = {
  get: (): SectionsMode => mode,
  setAll(next: SectionsMode) {
    mode = next;
    version += 1;
    try {
      globalThis.localStorage?.setItem(KEY, next);
    } catch {
      // Storage blocked: the switch still applies to this page.
    }
    listeners.forEach((l) => l());
  },
};

/** The current all-at-once choice. */
export function useSectionsMode(): SectionsMode {
  return useSyncExternalStore(
    subscribe,
    () => mode,
    () => 'expanded',
  );
}

/**
 * One section's collapsed state. It starts from the all-at-once choice, follows each later switch, and
 * opens itself when `revealCollapsed` is called for something inside it (a "Fix" link going to a field).
 * Put `ref` and `data-collapsed` on the section's root element.
 */
export function useCollapsible(ref: RefObject<HTMLElement | null>) {
  const all = useSyncExternalStore(
    subscribe,
    () => `${mode}:${version}`,
    () => 'expanded:0',
  );
  const [collapsed, setCollapsed] = useState(() => mode === 'collapsed');
  const seen = useRef(all);
  useEffect(() => {
    if (seen.current === all) return;
    seen.current = all;
    setCollapsed(all.startsWith('collapsed'));
  }, [all]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const open = () => setCollapsed(false);
    el.addEventListener(REVEAL, open);
    return () => el.removeEventListener(REVEAL, open);
  }, [ref]);
  return { collapsed, toggle: () => setCollapsed((c) => !c) };
}

/**
 * Opens every collapsed section around `el`, so it can be focused or scrolled to. Returns true when one
 * was opened: the caller then focuses on the next frame, once the section is shown.
 */
export function revealCollapsed(el: Element | null | undefined): boolean {
  let opened = false;
  let node = el?.closest('[data-collapsed="true"]');
  while (node) {
    node.dispatchEvent(new Event(REVEAL));
    opened = true;
    node = node.parentElement?.closest('[data-collapsed="true"]');
  }
  return opened;
}
