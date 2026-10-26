import { expect, test } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';

// B-23: a KAM reports an issue from the page footer; an Admin finds it on Admin → Feedback.
test('report an issue, then triage it', async ({ page }) => {
  const text = `E2E report ${Date.now()}: the board filter forgets my region.`;
  await signInAs(page, 'kam');
  await page.goto('/board');
  await page.getByTestId('report-issue-footer').click();
  const dialog = page.getByTestId('report-issue-dialog');
  await expect(dialog).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await dialog.getByTestId('feedback-type').selectOption('confusing');
  await dialog.getByTestId('feedback-severity').selectOption('3');
  await dialog.getByTestId('feedback-description').fill(text);
  await dialog.getByTestId('feedback-submit').click();
  await expect(page.getByText('Thanks, your report was sent')).toBeVisible();
  await expect(dialog).toBeHidden();

  // The KAM can't open the triage page.
  await page.goto('/admin/feedback');
  await expect(page.getByTestId('forbidden')).toBeVisible();

  await signInAs(page, 'admin');
  await page.goto('/admin/feedback');
  const row = page.getByRole('button', { name: new RegExp(text.slice(0, 20)) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('/board');
  await row.click();
  const triage = page.getByTestId('triage-dialog');
  await triage.getByLabel('Status').selectOption('triaged');
  await triage.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Report updated')).toBeVisible();
});

test('the user menu opens the same dialog', async ({ page }) => {
  await signInAs(page, 'eng-lead');
  await page.goto('/');
  await page.getByTestId('user-menu').click();
  await page.getByTestId('report-issue-menu').click();
  const dialog = page.getByTestId('report-issue-dialog');
  await expect(dialog).toBeVisible();
  // Focus moved into the dialog (not left on the closed menu).
  await expect(dialog.locator(':focus')).toHaveCount(1);
});
