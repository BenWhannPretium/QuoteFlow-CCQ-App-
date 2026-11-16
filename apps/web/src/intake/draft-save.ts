/**
 * One draft save at a time. `start` is called only when no save is in flight, and may return null when
 * there is nothing to send. Waiting is a `while`, not an `if`: callers waiting on the same save resume
 * one after another, and the first starts the next save before the second looks again. With an `if`,
 * both sent in parallel from the same version; the server refused the second as "changed in another
 * tab" (409), and a third save landing while it recovered made it a real conflict that stopped the
 * KAM's Submit (seen when Next was clicked twice quickly). When nothing is in flight, `start` runs
 * synchronously, so two saves started in the same tick are still one after the other.
 */
export function oneAtATime() {
  let inFlight: Promise<void> | null = null;
  return async function run(start: () => Promise<unknown> | null): Promise<void> {
    while (inFlight) await inFlight;
    const started = start();
    if (!started) return;
    inFlight = started.then(
      () => {
        inFlight = null;
      },
      () => {
        inFlight = null;
      },
    );
    await started;
  };
}
