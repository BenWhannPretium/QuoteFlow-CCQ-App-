import { fileURLToPath } from 'node:url';

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

// B-15 (revised): the legacy pricing app's export is imported here (no live connection).
test('Admin checks, then imports, the pricing-history export', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/admin/integrations');
  const card = page.getByTestId('pricing-history-import');
  await expect(card.getByRole('button', { name: 'Import' })).toBeDisabled();
  await card
    .getByLabel('Export file')
    .setInputFiles(
      fileURLToPath(new URL('./fixtures/pricing-history.synthetic.xlsx', import.meta.url)),
    );
  await card.getByRole('button', { name: 'Check file' }).click();
  const summary = card.getByTestId('pricing-import-summary');
  await expect(summary).toContainText('Nothing was written');
  await expect(summary.getByTestId('pricing-import-erf')).toContainText('2009–2026');
  await card.getByRole('button', { name: 'Import' }).click();
  await expect(summary).toContainText(/Imported pricing-history\.synthetic\.xlsx/);
  await expect(card.getByTestId('pricing-history-loaded')).toContainText('Loaded:');
  expect(await seriousViolations(page)).toEqual([]);
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
