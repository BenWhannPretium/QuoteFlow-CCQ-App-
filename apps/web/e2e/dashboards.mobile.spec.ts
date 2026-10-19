import { expect, test, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';

// B-17 at 390 × 844: dashboards and analytics stack vertically with no horizontal page scroll.

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('role dashboards fit a phone: no horizontal scroll, blocks stacked', async ({ page }) => {
  for (const persona of ['kam', 'eng-lead', 'leadership', 'approver']) {
    await signInAs(page, persona);
    await page.goto('/');
    await expect(page.getByTestId('landing')).toBeVisible();
    await expect(page.locator('[data-testid^="dash-"]').first()).toBeVisible();
    expect(await overflow(page), persona).toBeLessThanOrEqual(0);
    const boxes = await page
      .locator('section[aria-label="Dashboard"] > [data-testid^="dash-"]')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
    for (const b of boxes) expect(b.right, persona).toBeLessThanOrEqual(390);
    // Stacked: each block starts at the same left edge.
    expect(new Set(boxes.map((b) => Math.round(b.left))).size, persona).toBe(1);
  }
});

test('analytics fits a phone: charts stack, nothing scrolls sideways', async ({
  page,
}, testInfo) => {
  await signInAs(page, 'leadership');
  await page.goto('/analytics');
  await expect(page.getByTestId('chart-pipeline-count')).toBeVisible();
  await expect(page.getByTestId('chart-pipeline-amount')).toBeVisible();
  await expect.poll(() => page.locator('[data-chart-card]').count()).toBeGreaterThanOrEqual(14);
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  const a = (await page.getByTestId('chart-pipeline-count').boundingBox())!;
  const b = (await page.getByTestId('chart-pipeline-amount').boundingBox())!;
  expect(Math.round(a.x)).toBe(Math.round(b.x)); // small multiples stack in one column
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
  const widths = await page
    .locator('[data-chart-card]')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right));
  for (const right of widths) expect(right).toBeLessThanOrEqual(390);

  // The filter bar is usable with a thumb: 44 px tap targets.
  const small = await page
    .getByTestId('analytics-filters')
    .locator('select, input, button')
    .evaluateAll((els) =>
      els
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => ({ h: el.getBoundingClientRect().height, tag: el.tagName }))
        .filter((e) => e.h < 40),
    );
  expect(small).toEqual([]);

  expect(await seriousViolations(page)).toEqual([]);
  await testInfo.attach('analytics-390x844.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('the table toggle works on a phone', async ({ page }) => {
  await signInAs(page, 'leadership');
  await page.goto('/analytics');
  const card = page.getByTestId('chart-flow');
  await card
    .getByRole('button', { name: /Table view of Quotes created and closed per week/ })
    .click();
  await expect(card.getByRole('table')).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});
