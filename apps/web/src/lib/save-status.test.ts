import { afterEach, describe, expect, it } from 'vitest';

import {
  SAVED_TEXT,
  SAVING_TEXT,
  saveFailureReason,
  saveStatusView,
  savedStore,
} from './save-status';

/** FB-18 (W13-30): "Progress saved" beside every explicit Save button. */
describe('what the line beside a Save button says', () => {
  it('says nothing until something happens', () => {
    expect(saveStatusView({})).toBeNull();
    expect(saveStatusView({ saving: false, saved: false, error: null })).toBeNull();
    expect(saveStatusView({ error: '' })).toBeNull();
  });

  it('says "Saving…" while the save is on its way', () => {
    expect(saveStatusView({ saving: true })).toEqual({
      kind: 'saving',
      role: 'status',
      text: 'Saving…',
    });
    // Saving wins over an earlier result: the button was pressed again.
    expect(saveStatusView({ saving: true, saved: true, error: 'x' })?.kind).toBe('saving');
  });

  it('says "Progress saved" (the words Ben and Bailey asked for) as a status', () => {
    expect(saveStatusView({ saved: true })).toEqual({
      kind: 'saved',
      role: 'status',
      text: 'Progress saved',
    });
    expect(SAVED_TEXT).toBe('Progress saved');
    expect(SAVING_TEXT).toBe('Saving…');
  });

  it('says why a save failed, as an alert, and never "saved" at the same time', () => {
    expect(saveStatusView({ saved: true, error: 'Pick a resin from the list' })).toEqual({
      kind: 'failed',
      role: 'alert',
      text: 'Not saved: Pick a resin from the list',
    });
  });
});

describe('the reason after "Not saved:"', () => {
  it('is the message the save came back with', () => {
    expect(saveFailureReason(['Enter a whole number from 1 to 99'])).toBe(
      'Enter a whole number from 1 to 99',
    );
  });

  it('is the first message and how many more there are; the same message counts once', () => {
    expect(saveFailureReason(['Choose a plant.', 'Enter the cavitation.', 'Choose a plant.'])).toBe(
      'Choose a plant. (and 1 more)',
    );
    expect(saveFailureReason(['a', 'b', 'c'])).toBe('a (and 2 more)');
  });

  it('still gives a reason when the failure had no message', () => {
    expect(saveFailureReason([])).toBe('something went wrong. Try again.');
    expect(saveFailureReason(['', '  '])).toBe('something went wrong. Try again.');
  });
});

describe('which forms were just saved (savedStore)', () => {
  afterEach(() => savedStore.reset());
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  it('marks a scope and tells whoever listens, once', () => {
    let calls = 0;
    const stop = savedStore.subscribe(() => {
      calls += 1;
    });
    expect(savedStore.isSaved('terms:CCQ-1')).toBe(false);
    savedStore.mark('terms:CCQ-1');
    savedStore.mark('terms:CCQ-1');
    expect(savedStore.isSaved('terms:CCQ-1')).toBe(true);
    expect(savedStore.isSaved('terms:CCQ-2')).toBe(false);
    expect(calls).toBe(1);
    savedStore.clear('terms:CCQ-1');
    expect(savedStore.isSaved('terms:CCQ-1')).toBe(false);
    expect(calls).toBe(2);
    stop();
    savedStore.mark('terms:CCQ-1');
    expect(calls).toBe(2);
  });

  it('keeps the flag when a card is re-keyed by its own save (leaves and comes back at once)', async () => {
    const leaveOld = savedStore.mount('capital:CCQ-1');
    savedStore.mark('capital:CCQ-1');
    // The save lands: the old card unmounts and the new one mounts in the same render.
    leaveOld();
    const leaveNew = savedStore.mount('capital:CCQ-1');
    await tick();
    expect(savedStore.isSaved('capital:CCQ-1')).toBe(true);
    leaveNew();
  });

  it('keeps the flag when it is set just after the re-keyed card came back', async () => {
    const leaveOld = savedStore.mount('capital:CCQ-1');
    leaveOld();
    const leaveNew = savedStore.mount('capital:CCQ-1');
    await tick();
    savedStore.mark('capital:CCQ-1');
    expect(savedStore.isSaved('capital:CCQ-1')).toBe(true);
    leaveNew();
  });

  it('forgets the flag once the form is off the screen (the user left the page)', async () => {
    const leave = savedStore.mount('capital:CCQ-1');
    savedStore.mark('capital:CCQ-1');
    leave();
    expect(savedStore.isSaved('capital:CCQ-1')).toBe(true);
    await tick();
    expect(savedStore.isSaved('capital:CCQ-1')).toBe(false);
  });

  it('counts two forms with one scope: the flag stays while either is on screen', async () => {
    const leaveA = savedStore.mount('capital-terms:CCQ-1');
    const leaveB = savedStore.mount('capital-terms:CCQ-1');
    savedStore.mark('capital-terms:CCQ-1');
    leaveA();
    await tick();
    expect(savedStore.isSaved('capital-terms:CCQ-1')).toBe(true);
    leaveB();
    await tick();
    expect(savedStore.isSaved('capital-terms:CCQ-1')).toBe(false);
  });
});
