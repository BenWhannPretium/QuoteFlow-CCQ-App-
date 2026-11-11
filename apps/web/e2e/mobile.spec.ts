import { expect, test, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs, visibleNavKeys } from './personas';
import { freeOpportunities, submitQuote } from './quotes';

test.describe('390 × 844', () => {
  test('landing: bottom tab bar, no horizontal scroll, snapshot', async ({ page }, testInfo) => {
    await signInAs(page, 'kam', 'light');
    await page.goto('/');
    await expect(page.getByTestId('landing')).toHaveAttribute('data-role', 'KAM');

    // Bottom tabs replace the rail.
    await expect
      .poll(() => visibleNavKeys(page))
      .toEqual(['home', 'intake', 'proposals', 'pipeline']);
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
        - heading "Returned to me" [level=2]
        - heading "My drafts" [level=2]
        - heading "My open quotes by stage" [level=2]
        - heading "Proposals expiring soon" [level=2]
        - heading "My outcome capture rate" [level=2]
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
        // 43.5: a 44 px control can measure 43.99998 after sub-pixel rounding.
        .filter((r) => r.w < 43.5 || r.h < 43.5),
    );
    expect(small).toEqual([]);
  });

  test('admin gets four tabs and More; every tab fits', async ({ page }) => {
    await signInAs(page, 'admin');
    await page.goto('/');
    // Eight items (B-09 added Approvals, B-10 the engineering queue, B-11 the pricing queue): the
    // fifth slot becomes "More".
    await expect
      .poll(() => visibleNavKeys(page))
      .toEqual(['home', 'intake', 'queue-engineering', 'queue-pricing']);
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

/**
 * DR-engineering-08, DR-kam-sales-leader-08, DR-pricing-finance-12, DR-approver-leadership-admin-08,
 * -11, -12, DR-cross-cutting-10, -11: on a phone every link, button and tab in the page is at least
 * 44 px, nothing scrolls sideways, and the screens pass axe.
 */
test.describe('390 × 844: tap targets and overflow on the working screens', () => {
  const smallTargets = (page: Page) =>
    page.locator('main a, main button, main [role="tab"]').evaluateAll((els) =>
      els
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        })
        .filter((r) => r.w > 0 && (r.w < 43.5 || r.h < 43.5)),
    );
  const sideways = (page: Page) =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

  test('quote page, queues, analytics and preferences', async ({ page, request }) => {
    test.setTimeout(120_000);
    const qn = await submitQuote(request, await freeOpportunities(request, 1));
    for (const [persona, path] of [
      ['kam', `/quotes/${qn}`],
      ['kam', '/quotes'],
      ['eng-lead', '/queue/engineering'],
      ['pricing-lead', '/queue/pricing'],
      ['leadership', '/analytics'],
      ['kam', '/me/preferences'],
    ] as const) {
      await signInAs(page, persona);
      await page.goto(path);
      await page.locator('main').waitFor();
      await page.waitForLoadState('networkidle');
      expect(await smallTargets(page), `${persona} ${path}`).toEqual([]);
      expect(await sideways(page), `${persona} ${path}`).toBeLessThanOrEqual(0);
    }
  });

  test('App settings and the usage report fit; the usage table scrolls by keyboard', async ({
    page,
  }) => {
    await signInAs(page, 'admin');
    await page.goto('/admin/settings');
    await expect(page.getByTestId('setting-value').first()).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    expect(await seriousViolations(page)).toEqual([]);

    await page.goto('/admin/reports/usage');
    await page.waitForLoadState('networkidle');
    const box = page.getByRole('region', {
      name: 'Daily active users by role (scrolls sideways)',
    });
    if ((await box.count()) > 0) await expect(box).toHaveAttribute('tabindex', '0');
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    expect(await seriousViolations(page)).toEqual([]);
  });
});
