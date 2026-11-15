import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/** WCAG 2.1 A/AA rules. The B-05 bar: no serious or critical violations. */
export async function seriousViolations(page: Page) {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.map((n) => n.target.join(' ')) }));
}

/**
 * Waits for finite CSS animations (a toast fading in, a dialog opening) to finish, so axe measures
 * the colours a user sees rather than a frame part-way through a fade, which it reports as a
 * colour-contrast failure. Endless animations (spinners, skeletons) are not waited for.
 */
async function settleAnimations(page: Page) {
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .every(
            (a) =>
              a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity,
          ),
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => undefined);
}
