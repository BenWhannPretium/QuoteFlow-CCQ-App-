import { expect, test, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';

// B-07: a KAM goes from a Salesforce opportunity (SF_MODE=fake) to a submitted CCQ quote.
// Each test picks an opportunity that has no active quote yet (one active quote per opportunity).

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function pickOpportunity(page: Page, search: string) {
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByLabel('Find the Salesforce opportunity').fill(search);
  const free = page
    .getByTestId('opportunity-card')
    .filter({ has: page.getByRole('button', { name: /^Use / }) })
    .first();
  await expect(free).toBeVisible({ timeout: 15_000 });
  await free.getByRole('button', { name: /^Use / }).click();
  await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '2');
}

/** Steps 2 and 3 with Sales-knowable answers; leaves the drawing for the caller. */
async function fillCustomerAndProduct(page: Page) {
  // Step 2: customer pre-filled from the SF Account (or a not-yet-established customer).
  const newName = page.locator('#intake-customer-name');
  if ((await newName.isVisible()) && !(await newName.inputValue())) {
    await newName.fill('E2E New Customer (synthetic)');
  }
  const city = page.locator('#intake-ship-to-city');
  if ((await city.isVisible()) && !(await city.inputValue())) {
    await city.fill('St. Louis');
    await page.locator('#intake-ship-to-line1').fill('1 Test Way');
  }
  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '3');

  // Step 3: product and volume. Nothing about plant, process, machine, capital or priority.
  await page.locator('#intake-product-family').selectOption({ label: 'Jar' });
  await page.locator('#intake-resin').selectOption({ label: 'PET' });
  await page.locator('#intake-neck-finish').selectOption({ label: '89-400' });
  await page.locator('#intake-packaging-type').selectOption({ label: 'Bulk' });
  await page.locator('#intake-container-size').fill('16 oz');
  const volume = page.locator('#intake-est-annual-volume');
  await volume.fill('1000000');
  // The placeholder guard asks, softly.
  await expect(page.getByTestId('volume-confirm')).toContainText('real annual volume');
  await volume.fill('640000');
  await expect(page.getByTestId('volume-confirm')).toHaveCount(0);
  await expect(page.locator('#intake-standard-description')).toHaveValue(/16 oz Jar, PET/);
}

test.describe('KAM intake', () => {
  test('desktop: opportunity → submitted CCQ quote, without a drawing, resuming a draft', async ({
    page,
  }) => {
    const started = Date.now();
    await signInAs(page, 'kam');
    await page.goto('/intake/new');
    await expect(page.getByRole('heading', { level: 1, name: 'New intake' })).toBeVisible();

    // No Sales-unknowable inputs anywhere in intake.
    await pickOpportunity(page, 'Jar');
    await fillCustomerAndProduct(page);
    for (const forbidden of [
      /plant/i,
      /process type/i,
      /machine/i,
      /capital/i,
      /engineer$/i,
      /priority/i,
    ]) {
      await expect(page.getByLabel(forbidden)).toHaveCount(0);
    }

    // Moving on saves the draft; a reload resumes it on the same step with the same answers.
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '4');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    await expect(page).toHaveURL(/draft=/);
    await page.reload();
    await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '4');
    await expect(page.getByText('640,000 units')).toBeVisible();

    // No drawing: the prompt shows but never blocks.
    await page
      .locator('#intake-drawing-status')
      .selectOption({ label: 'None (quote will take longer)' });
    await expect(
      page.getByText('Quotes without a drawing usually take longer.').first(),
    ).toBeVisible();
    await expect(page.getByTestId('blocking-list')).toHaveCount(0);
    await expect(page.getByTestId('warning-list')).toContainText('Engineering may ask about this');
    expect(await seriousViolations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Submit to CCQ' }).click();
    await expect(page.getByTestId('submitted')).toBeVisible();
    await expect(page.getByTestId('quote-number')).toHaveText(/^CCQ-\d{4}-\d{5}$/);
    expect(Date.now() - started).toBeLessThan(3 * 60_000);
  });

  test('a changed ship-to needs a reason and keeps the original', async ({ page }) => {
    await signInAs(page, 'kam');
    await page.goto('/intake/new');
    await pickOpportunity(page, 'Bottle');
    const change = page.getByRole('button', { name: 'Change ship-to' });
    test.skip(!(await change.isVisible()), 'this opportunity has no default ship-to');
    await change.click();
    await expect(page.getByTestId('ship-to-original')).toContainText('Original:');
    await page.locator('#intake-ship-to-line1').fill('99 Co-packer Way');
    await page.getByRole('button', { name: /^Next/ }).click();
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByTestId('blocking-list')).toContainText(
      'Say why the ship-to differs from the customer default',
    );
    await expect(page.getByRole('button', { name: 'Submit to CCQ' })).toBeDisabled();
    // Clean up: this draft is not needed.
    await page.getByRole('button', { name: 'Discard draft' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard draft' }).click();
    await expect(page).not.toHaveURL(/draft=/);
  });
});

test.describe('KAM intake at 390 × 844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('completes intake on a phone with no horizontal scroll', async ({ page }) => {
    await signInAs(page, 'kam');
    await page.goto('/intake/new');
    await expect(page.getByText('Step 1 of 4')).toBeVisible();
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);

    await pickOpportunity(page, 'Preform');
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    await fillCustomerAndProduct(page);
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByText('Step 4 of 4')).toBeVisible();
    await page.locator('#intake-drawing-status').selectOption({ label: 'Coming' });
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: 'Submit to CCQ' }).click();
    await expect(page.getByTestId('quote-number')).toHaveText(/^CCQ-\d{4}-\d{5}$/);
  });
});
