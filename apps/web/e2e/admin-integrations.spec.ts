import { expect, test } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';

// B-06: the Salesforce sync (SF_MODE=fake in e2e) and its admin pages.

test('Admin runs the Salesforce sync and sees the run listed', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/admin/integrations');
  await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible();

  await page.getByRole('button', { name: 'Sync Salesforce now' }).click();
  await expect(page.getByText(/Salesforce sync (succeeded|is already running)/)).toBeVisible();
  await expect(page.getByText('salesforce', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/fetched \d+/).first()).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`integrations and ERF linkage pages have no serious axe violations (${theme})`, async ({
    page,
  }) => {
    await signInAs(page, 'admin', theme);
    await page.goto('/admin/integrations');
    await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sync Salesforce now' })).toBeEnabled();
    expect(await seriousViolations(page)).toEqual([]);

    await page.goto('/admin/reports/erf-linkage');
    await expect(page.getByRole('heading', { level: 1, name: 'ERF linkage' })).toBeVisible();
    await expect(page.getByText('SF linked to an ERF')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
}

test('the admin pages are Admin-only', async ({ page }) => {
  await signInAs(page, 'kam');
  await page.goto('/admin/integrations');
  await expect(page.getByTestId('forbidden')).toBeVisible();
});
