import { describe, expect, it, vi } from 'vitest';

import {
  FILE_LINK_GRACE_MS,
  createUnsavedRegistry,
  fileLinkJustOpened,
  withinFileLinkGrace,
} from './unsaved-changes';

describe('a file link opened from the page', () => {
  it('is let through only for the moment after it was opened', () => {
    expect(withinFileLinkGrace(1_000, 1_000)).toBe(true);
    expect(withinFileLinkGrace(1_000, 1_000 + FILE_LINK_GRACE_MS - 1)).toBe(true);
    expect(withinFileLinkGrace(1_000, 1_000 + FILE_LINK_GRACE_MS)).toBe(false);
    // A clock that moved back is not a download.
    expect(withinFileLinkGrace(1_000, 999)).toBe(false);
  });

  it('is not assumed when no file link was opened', () => {
    expect(fileLinkJustOpened()).toBe(false);
  });
});

/** UX-001: which cards on a quote hold typed values that are not saved yet. */
describe('the unsaved-changes registry', () => {
  it('starts with nothing unsaved', () => {
    const registry = createUnsavedRegistry();
    expect(registry.has('CCQ-2026-00001')).toBe(false);
    expect(registry.cards('CCQ-2026-00001')).toEqual([]);
  });

  it('a quote has unsaved changes while any of its cards does', () => {
    const registry = createUnsavedRegistry();
    registry.report('CCQ-2026-00001', 'solution', true);
    registry.report('CCQ-2026-00001', 'capacity', true);
    expect(registry.has('CCQ-2026-00001')).toBe(true);
    expect(registry.cards('CCQ-2026-00001')).toEqual(['solution', 'capacity']);

    // One card is saved: the other still holds typed values.
    registry.report('CCQ-2026-00001', 'solution', false);
    expect(registry.has('CCQ-2026-00001')).toBe(true);

    registry.report('CCQ-2026-00001', 'capacity', false);
    expect(registry.has('CCQ-2026-00001')).toBe(false);
  });

  it('keeps quotes apart', () => {
    const registry = createUnsavedRegistry();
    registry.report('CCQ-2026-00001', 'solution', true);
    expect(registry.has('CCQ-2026-00002')).toBe(false);
    // The same card name on another quote is another card.
    registry.report('CCQ-2026-00002', 'solution', false);
    expect(registry.has('CCQ-2026-00001')).toBe(true);
  });

  it('tells its listeners only when something changed', () => {
    const registry = createUnsavedRegistry();
    const listener = vi.fn();
    const stop = registry.subscribe(listener);

    registry.report('CCQ-2026-00001', 'solution', false); // was not unsaved: nothing to say
    expect(listener).not.toHaveBeenCalled();
    registry.report('CCQ-2026-00001', 'solution', true);
    registry.report('CCQ-2026-00001', 'solution', true); // the same again
    expect(listener).toHaveBeenCalledTimes(1);
    registry.report('CCQ-2026-00001', 'solution', false);
    expect(listener).toHaveBeenCalledTimes(2);

    stop();
    registry.report('CCQ-2026-00001', 'solution', true);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
