import { expect, test } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs, visibleNavKeys } from './personas';

test.describe('390 × 844', () => {
  test('landing: bottom tab bar, no horizontal scroll, snapshot', async ({ page }, testInfo) => {
    await signInAs(page, 'kam', 'light');
    await page.goto('/');
    await expect(page.getByTestId('landing')).toHaveAttribute('data-role', 'KAM');

    // Bottom tabs replace the rail.
    await expect.poll(() => visibleNavKeys(page)).toEqual(['home', 'intake', 'pipeline']);
    const tabs = page.getByRole('navigation', { name: 'Primary' });
    await expect(tabs).toHaveCSS('position', 'fixed');

    // No horizontal scroll.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // 16 px side gutters.
    const main = page.locator('main#main');
    await expect(main).toHaveCSS('padding-left', '16px');
    await expect(main).toHaveCSS('padding-right', '16px');

    // Structural snapshot of the landing (deterministic across machines and fonts).
    await expect(page.getByTestId('landing')).toMatchAriaSnapshot(`
      - paragraph: Home · Key account manager
      - heading "My quotes" [level=1]
      - paragraph: Your intakes and quotes, and anything waiting on you.
      - link "New intake"
      - region "Dashboard":
        - heading "Waiting on me" [level=2]
        - heading "My open quotes" [level=2]
        - heading "Recent outcomes" [level=2]
    `);

    // Visual snapshot, attached to the report for review (pixel baselines differ by OS fonts).
    await testInfo.attach('landing-390x844.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('tap targets are at least 44 px', async ({ page }) => {
    await signInAs(page, 'admin');
    await page.goto('/');
    await expect(page.getByTestId('landing')).toBeVisible();
    const targets = page.locator(
      'header a, header button, nav[aria-label="Primary"] a, nav[aria-label="Primary"] button, main a, main button',
    );
    const small = await targets.evaluateAll((els) =>
      els
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            label: el.getAttribute('aria-label') ?? el.textContent?.trim(),
            w: r.width,
            h: r.height,
          };
        })
        .filter((r) => r.w < 44 || r.h < 44),
    );
    expect(small).toEqual([]);
  });

  test('admin gets four tabs and More; every tab fits', async ({ page }) => {
    await signInAs(page, 'admin');
    await page.goto('/');
    // Six items (B-09 added Approvals for override.approve): the fifth slot becomes "More".
    await expect
      .poll(() => visibleNavKeys(page))
      .toEqual(['home', 'intake', 'pipeline', 'approvals']);
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'More' }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('dark mode on mobile has no serious axe violations', async ({ page }) => {
    await signInAs(page, 'eng-lead', 'dark');
    await page.goto('/');
    await expect(page.getByTestId('landing')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});

test('UI kit on mobile: tables become cards, no horizontal scroll, no serious axe violations', async ({
  page,
}) => {
  await signInAs(page, 'admin', 'dark');
  await page.goto('/admin/ui-kit');
  await expect(page.getByRole('list', { name: 'Sample quotes' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(await seriousViolations(page)).toEqual([]);
});
