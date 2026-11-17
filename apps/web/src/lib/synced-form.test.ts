import { describe, expect, it } from 'vitest';

import { adoptServerValues, sameFormValues } from './synced-form';

describe('adoptServerValues (the saved values changed while the card was open)', () => {
  const opened = { concept: 'Shuttle', cavitation: '8', cycle: '14.5' };

  it('an untouched form takes the server’s new values: nothing of it is unsaved', () => {
    const server = { concept: 'Shuttle with in-mold label', cavitation: '8', cycle: '12' };
    const next = adoptServerValues(opened, opened, server);
    expect(next).toEqual(server);
    expect(sameFormValues(next, server)).toBe(true);
  });

  it('a field the user typed in keeps what they typed; the others follow the server', () => {
    const typed = { ...opened, cavitation: '12' };
    const server = { concept: 'Shuttle with in-mold label', cavitation: '8', cycle: '14.5' };
    const next = adoptServerValues(typed, opened, server);
    expect(next).toEqual({
      concept: 'Shuttle with in-mold label',
      cavitation: '12',
      cycle: '14.5',
    });
    // Only the typed field differs from the server now, so a save sends only that.
    expect(
      Object.keys(next).filter(
        (k) => next[k as keyof typeof next] !== server[k as keyof typeof server],
      ),
    ).toEqual(['cavitation']);
  });

  it('when the server now holds what the user typed, the field is no longer a change', () => {
    const typed = { ...opened, cavitation: '12' };
    const server = { ...opened, cavitation: '12' };
    expect(sameFormValues(adoptServerValues(typed, opened, server), server)).toBe(true);
  });

  it('returns the same object when the server did not move', () => {
    const typed = { ...opened, cavitation: '12' };
    expect(adoptServerValues(typed, opened, opened)).toBe(typed);
  });
});
