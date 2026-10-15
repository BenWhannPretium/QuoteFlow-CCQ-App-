import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/** WCAG 2.1 A/AA rules. The B-05 bar: no serious or critical violations. */
export async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.map((n) => n.target.join(' ')) }));
}
