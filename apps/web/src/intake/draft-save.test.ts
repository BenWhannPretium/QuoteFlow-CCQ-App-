import { describe, expect, it } from 'vitest';

import { oneAtATime } from './draft-save';

/** A save loop shaped like useIntakeDraft's: send only when there is an unsaved edit. */
function saver() {
  const run = oneAtATime();
  let active = 0;
  let most = 0;
  const sent: number[] = [];
  let revision = 0;
  let saved = 0;
  const save = () =>
    run(() => {
      if (revision === saved) return null;
      const target = revision;
      active += 1;
      most = Math.max(most, active);
      sent.push(target);
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          saved = target;
          active -= 1;
          resolve();
        }, 5),
      );
    });
  const edit = () => {
    revision += 1;
  };
  return { save, edit, stats: () => ({ most, sent }) };
}

describe('oneAtATime (intake draft autosave)', () => {
  it('never runs two saves at once, however many callers were waiting', async () => {
    const s = saver();
    s.edit();
    const first = s.save();
    s.edit();
    // Two more callers wait on the first save (e.g. Next clicked twice while it is sending).
    await Promise.all([first, s.save(), s.save()]);
    expect(s.stats().most).toBe(1);
    // The waiting edit is saved once, after the first save; the other waiter finds nothing to send.
    expect(s.stats().sent).toEqual([1, 2]);
  });

  it('two saves started in the same tick run one after the other', async () => {
    const s = saver();
    s.edit();
    const a = s.save();
    s.edit();
    const b = s.save();
    await Promise.all([a, b]);
    expect(s.stats().most).toBe(1);
    expect(s.stats().sent).toEqual([1, 2]);
  });

  it('a save that failed does not stop the next one', async () => {
    const run = oneAtATime();
    const failed = run(() => Promise.reject(new Error('network')));
    let ran = false;
    const next = run(() => {
      ran = true;
      return Promise.resolve();
    });
    await expect(failed).rejects.toThrow('network');
    await next;
    expect(ran).toBe(true);
  });
});
