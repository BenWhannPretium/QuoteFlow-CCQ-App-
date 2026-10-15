import { expect, test } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';

for (const theme of ['light', 'dark'] as const) {
  test(`landing page has no serious axe violations (${theme})`, async ({ page }) => {
    await signInAs(page, 'multi-role', theme);
    await page.goto('/');
    await expect(page.getByTestId('landing')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test(`open user menu has no serious axe violations (${theme})`, async ({ page }) => {
    await signInAs(page, 'admin', theme);
    await page.goto('/');
    await expect(page.getByTestId('health-status')).toBeVisible();
    await page.getByTestId('user-menu').click();
    await expect(page.getByRole('menu')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
}

test('404 and 403 pages have no serious axe violations', async ({ page }) => {
  await signInAs(page, 'kam');
  await page.goto('/nope');
  await expect(page.getByTestId('not-found')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.goto('/admin');
  await expect(page.getByTestId('forbidden')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

for (const theme of ['light', 'dark'] as const) {
  test(`UI kit (every shared component) has no serious axe violations (${theme})`, async ({
    page,
  }) => {
    await signInAs(page, 'admin', theme);
    await page.goto('/admin/ui-kit');
    await expect(page.getByTestId('ui-kit')).toBeVisible();
    // Wait for config-driven labels (stages) so the scan covers them.
    await expect(page.locator('[data-stage]').first()).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Gate decision' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
}

test('gate decision dialog asks for what config requires', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/admin/ui-kit');
  await page.getByRole('button', { name: 'Gate decision' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Record decision' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Choose a decision.');
  await expect(dialog.getByRole('radio').first()).toBeVisible();
});

test('table sorts from the header (numbers start highest first)', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/admin/ui-kit');
  const table = page.getByRole('table', { name: 'Sample quotes' });
  const header = table.getByRole('columnheader', { name: 'Score' });
  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  await expect(table.getByRole('row').nth(1)).toContainText('CCQ-2026-01001');
  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  await expect(table.getByRole('row').nth(1)).toContainText('CCQ-2026-01004');
});
