import { expect, test, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, isoDaysFromNow, submitQuote } from './quotes';

// FB-15 (Nov 13 walkthrough): the intake submits, required fields stand out, "Other" asks, a failed
// autosave stops the submit, a refused submit names its fields, and a send-back lands on the field.
// Synthetic data only (SF_MODE=fake).

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

async function selectIfEmpty(page: Page, id: string, label: string) {
  const select = page.locator(`select#${id}`);
  if (!(await select.inputValue())) await select.selectOption({ label });
}

/** The red asterisk (hidden from screen readers) before the field's label. */
const asterisk = (page: Page, id: string) =>
  page.locator(`label[for="${id}"] [aria-hidden="true"]`, { hasText: '*' });

/** Steps 2 and 3 with the required answers, the minimum spec, and "Other" product family. */
async function fillRequired(page: Page) {
  await expect(page.getByTestId('required-key').first()).toContainText('Required to submit');
  for (const part of ['city', 'state']) {
    const input = page.locator(`#intake-ship-to-${part}`);
    if ((await input.isVisible()) && !(await input.inputValue())) {
      await expect(asterisk(page, `intake-ship-to-${part}`)).toBeVisible();
      await input.fill(part === 'city' ? 'St. Louis' : 'MO');
    }
  }
  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '3');

  // W13-02: Market and Sub-market are required; the minimum spec is marked while no drawing is attached.
  for (const id of [
    'intake-market',
    'intake-sub-market',
    'intake-product-family',
    'intake-height-mm',
  ]) {
    await expect(asterisk(page, id)).toBeVisible();
  }
  // W13-03: "Other" asks what it is.
  await page.locator('#intake-product-family').selectOption({ label: 'Other' });
  const describe = page.locator('#intake-product-family-other');
  await expect(describe).toBeVisible();
  await expect(page.getByLabel(/Describe the product family/)).toBeVisible();
  await describe.fill('Squeeze tube');
  await page.locator('#intake-market').selectOption({ label: 'Food' });
  await page.locator('#intake-sub-market').selectOption({ label: 'Snacks & Confections' });
  await selectIfEmpty(page, 'intake-resin', 'HDPE');
  // W13-07: the stock colors are offered for HDPE.
  const resin = await page.locator('#intake-resin').inputValue();
  if (resin === 'HDPE' || resin === 'PP') {
    await page.locator('#intake-color-type').selectOption({ label: 'Stock white' });
  } else {
    await page.locator('#intake-color-type').selectOption({ label: 'Natural' });
  }
  await selectIfEmpty(page, 'intake-neck-diameter', '38 mm');
  await selectIfEmpty(page, 'intake-neck-finish-type', '400');
  await page.locator('#intake-height-mm').fill('180');
  await page.locator('#intake-width-or-diameter-mm').fill('65');
  await page.locator('#intake-depth-mm').fill('65');
  await page.locator('#intake-gram-weight-g').fill('24');
  const volume = page.locator('input#intake-est-annual-volume');
  if (!(await volume.inputValue())) await volume.fill('640000');
  await page.locator('#intake-quote-needed-by').fill(isoDaysFromNow(30));
  await page.locator('#intake-product-needed-by').fill(isoDaysFromNow(120));
}

test.describe('FB-15 intake fixes', () => {
  test('KAM fills everything; a failed autosave stops the submit; then it submits and lands on the quote', async ({
    page,
  }) => {
    await signInAs(page, 'kam');
    await page.goto('/intake/new');
    await pickOpportunity(page, 'Handleware');
    await fillRequired(page);
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '4');
    await page.locator('#intake-drawing-status').selectOption({ label: 'Coming' });
    await expect(page.getByTestId('blocking-list')).toHaveCount(0);
    expect(await seriousViolations(page)).toEqual([]);

    // W13-01 (a): the last change can't be saved, so nothing is submitted and the KAM is told why.
    await page.route('**/api/v1/quotes/drafts/*', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 503,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              type: 'about:blank',
              title: 'Service Unavailable',
              status: 503,
              detail: 'Try again.',
            }),
          })
        : route.continue(),
    );
    let submitted = false;
    page.on('request', (r) => {
      if (r.url().endsWith('/submit')) submitted = true;
    });
    await page.locator('#intake-comments-for-engineering').fill('Customer prefers a matte finish');
    await page.getByRole('button', { name: 'Submit to CCQ' }).click();
    await expect(page.getByTestId('submit-error')).toContainText('Your last change was not saved');
    expect(submitted).toBe(false);

    // The connection is back: Submit again clears the old message and goes through.
    await page.unroute('**/api/v1/quotes/drafts/*');
    await page.getByRole('button', { name: 'Submit to CCQ' }).click();
    await expect(page.getByTestId('submitted')).toBeVisible();
    await expect(page.getByTestId('submit-error')).toHaveCount(0);
    await page.getByRole('link', { name: 'Open the quote' }).click();
    await expect(page.getByTestId('fact-product-family-other')).toHaveText('Squeeze tube');
  });

  test('a refused submit lists each field by its label with a Fix link that lands on it', async ({
    page,
  }) => {
    await signInAs(page, 'kam');
    await page.goto('/intake/new');
    await pickOpportunity(page, 'Jug');
    await fillRequired(page);
    await page.getByRole('button', { name: /^Next/ }).click();
    await page.locator('#intake-drawing-status').selectOption({ label: 'Coming' });
    // The server is the authority: here it refuses (e.g. a list value retired a moment ago).
    await page.route('**/api/v1/quotes/drafts/*/submit', (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Unprocessable Entity',
          status: 422,
          detail: 'The intake is missing required information',
          code: 'intake_incomplete',
          errors: [{ path: 'subMarket', message: 'Pick a sub-market from the list' }],
          blocking: [
            {
              code: 'INVALID_VALUE',
              field: 'sub_market',
              message: 'Pick a sub-market from the list',
            },
          ],
        }),
      }),
    );
    await page.getByRole('button', { name: 'Submit to CCQ' }).click();
    const list = page.getByTestId('submit-error-list');
    await expect(list).toContainText('Sub-market: Pick a sub-market from the list');
    await list.getByRole('button', { name: 'Fix' }).click();
    await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '3');
    await expect(page.locator('#intake-sub-market')).toBeFocused();
    // Clean up: this draft is not needed.
    await page.getByRole('button', { name: 'Discard draft' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard draft' }).click();
    await expect(page).not.toHaveURL(/draft=/);
  });

  test('a send-back notification opens the rework at the field to fix; after the resubmit no stale warning remains', async ({
    page,
    request,
  }) => {
    const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
    const decided = await request.post(`/api/v1/quotes/${quoteNumber}/gates/G1/decisions`, {
      headers: { [DEV_USER_HEADER]: 'sales-leader' },
      data: {
        outcomeKey: 'rework',
        reasonCode: 'missing_information',
        note: 'Please confirm the Quote needed by date',
      },
    });
    expect(decided.status(), await decided.text()).toBe(201);

    // The KAM's notification links to the rework.
    await signInAs(page, 'kam');
    await page.goto('/notifications');
    const row = page.getByRole('link', { name: new RegExp(quoteNumber) }).first();
    await expect(row).toHaveAttribute('href', `/intake/new?rework=${quoteNumber}`);
    await row.click();

    // Pinned at the top: who sent it back, why, and the note. Nothing blocks, so the note's field is focused.
    await expect(page.getByTestId('rework-notice')).toContainText('Sent back by');
    await expect(page.getByTestId('rework-notice')).toContainText('Missing information');
    await expect(page.getByTestId('rework-notice')).toContainText(
      'Please confirm the Quote needed by date',
    );
    await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '3');
    await expect(page.locator('#intake-quote-needed-by')).toBeFocused();
    await page.locator('#intake-quote-needed-by').fill(isoDaysFromNow(21));
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '4');
    await page.getByRole('button', { name: 'Submit to CCQ' }).click();
    await expect(page.getByTestId('submitted')).toContainText('resubmitted');

    await page.getByRole('link', { name: 'Open the quote' }).click();
    await expect(page.getByTestId('quote-detail')).toBeVisible();
    await expect(page.getByTestId('rework-banner')).toHaveCount(0);
  });
});
