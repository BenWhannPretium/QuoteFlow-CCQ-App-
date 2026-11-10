import { expect, test, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';

// B-07 / FB-02: a KAM goes from a Salesforce opportunity (SF_MODE=fake) to a submitted CCQ quote.
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

const isoDaysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Selects by label when the field is editable (what came from Salesforce is read-only, F-008). */
async function selectIfEditable(page: Page, id: string, label: string) {
  const select = page.locator(`select#${id}`);
  if ((await select.count()) > 0) await select.selectOption({ label });
}

async function fillIfEditable(page: Page, id: string, value: string) {
  const input = page.locator(`input#${id}`);
  if ((await input.count()) > 0) await input.fill(value);
}

/**
 * Steps 2 and 3 with Sales-knowable answers and the FB-02 product facts, including the full minimum
 * spec (F-016) so no drawing is needed. `gramWeight: null` leaves the gram weight empty.
 */
async function fillCustomerAndProduct(
  page: Page,
  opts: { gramWeight?: string | null; commercial?: boolean } = {},
) {
  // Step 2: the customer is the opportunity's SF Account (F-007); only "not yet a customer" is asked.
  await expect(page.getByTestId('customer-name')).toBeVisible();
  await expect(page.getByLabel('Not yet a Pretium customer (no ERP account)')).not.toBeChecked();
  await expect(page.locator('#intake-customer-location')).toHaveCount(0);
  // Ship / fill destination: city and state required (F-017).
  const city = page.locator('#intake-ship-to-city');
  if ((await city.isVisible()) && !(await city.inputValue())) {
    await city.fill('St. Louis');
  }
  const state = page.locator('#intake-ship-to-state');
  if ((await state.isVisible()) && !(await state.inputValue())) {
    await state.fill('MO');
  }
  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '3');

  // Step 3. Nothing about plant, process, machine, capital or priority.
  await page.locator('#intake-product-family').selectOption({ label: 'Jar' });
  await selectIfEditable(page, 'intake-resin', 'PET');
  // F-011: a customer-specified resin reveals the required supplier / grade.
  await expect(page.locator('#intake-resin-grade')).toHaveCount(0);
  await page.getByLabel('Customer-specified resin').check();
  await page.locator('#intake-resin-grade').fill('LyondellBasell Pro-fax 6331');
  await page.locator('#intake-pcr-level').selectOption({ label: '25%' });
  // F-010: the neck as three lists (read-only when Salesforce supplied it).
  await selectIfEditable(page, 'intake-neck-diameter', '38 mm');
  await selectIfEditable(page, 'intake-neck-finish-type', '400');
  await page.locator('#intake-neck-special-feature').selectOption({ label: 'Tamper Evident' });
  // F-023: Custom color reveals its description.
  await page.locator('#intake-color-type').selectOption({ label: 'Custom color' });
  await page.locator('#intake-color-description').fill('Pantone 286 C blue');
  await page.locator('#intake-additives').fill('UV inhibitor');
  // F-013: Decoration reveals its type and print colors.
  await page.getByLabel('Decoration', { exact: true }).check();
  await page.locator('#intake-decoration-type').selectOption({ label: 'Silk screen' });
  await page.locator('#intake-decoration-print-colors').fill('2');
  // F-016: dimensions and gram weight (the minimum spec without a drawing).
  await page.locator('#intake-height-mm').fill('180');
  await page.locator('#intake-width-or-diameter-mm').fill('65');
  await page.locator('#intake-depth-mm').fill('65');
  if (opts.gramWeight !== null) {
    await page.locator('#intake-gram-weight-g').fill(opts.gramWeight ?? '24.5');
  }
  await page.locator('#intake-packaging-type').selectOption({ label: 'Bulk' });
  await fillIfEditable(page, 'intake-container-size', '16 oz');
  const volume = page.locator('input#intake-est-annual-volume');
  if ((await volume.count()) > 0) {
    await volume.fill('1000000');
    // The placeholder guard asks, softly.
    await expect(page.getByTestId('volume-confirm')).toContainText('real annual volume');
    await volume.fill('640000');
    await expect(page.getByTestId('volume-confirm')).toHaveCount(0);
  }
  // F-009: the SF close date is read-only; the two need-by dates are the KAM's.
  await expect(page.getByTestId('sf-close-date')).toBeVisible();
  await page.locator('#intake-quote-needed-by').fill(isoDaysFromNow(30));
  await page.locator('#intake-product-needed-by').fill(isoDaysFromNow(120));
  await page.locator('#intake-quote-variants-note').fill('Price at 0/25/50% PCR');
  if (opts.commercial !== false) await fillCommercialInputs(page);
}

/**
 * FB-11 (D-032): the commercial inputs on step 3: payment terms (non-standard flag), customer funding
 * (defaults to "Not discussed", sales-tax hint), returnable dunnage, delivered or FOB with the freight
 * (cleared when the price goes back to FOB) and the bid / program reference. All optional.
 */
async function fillCommercialInputs(page: Page) {
  await page.locator('#intake-bid-reference').fill('RFP-2026-114');
  await page.getByTestId('returnable-dunnage').check();

  // Payment terms: a standard term shows no flag; Net 60 is non-standard and Pricing will review.
  await page.locator('#intake-requested-payment-terms').selectOption({ label: 'Net 30' });
  await expect(page.getByTestId('payment-terms-nonstandard')).toHaveCount(0);
  await page.locator('#intake-requested-payment-terms').selectOption({ label: 'Net 60' });
  await expect(page.getByTestId('payment-terms-nonstandard')).toHaveText(
    'Non-standard: Pricing will review',
  );

  // Customer funding starts at "Not discussed"; a customer-funded answer shows the sales-tax hint.
  const funding = page.locator('#intake-tooling-funding-model');
  await expect(funding.locator('option:checked')).toHaveText('Not discussed');
  await expect(page.getByTestId('funding-tax-hint')).toHaveCount(0);
  await funding.selectOption({ label: 'Customer-funded' });
  await expect(page.getByTestId('funding-tax-hint')).toContainText('sales tax');

  // Delivered reveals the freight fields; going back to FOB hides and clears them.
  await expect(page.locator('#intake-freight-type')).toHaveCount(0);
  await page.locator('#intake-price-basis').selectOption({ label: 'Delivered' });
  await page.locator('#intake-freight-type').selectOption({ label: 'T-bar' });
  await page.locator('#intake-freight-special-arrangements').fill('stale note');
  await page.locator('#intake-price-basis').selectOption({ label: 'FOB Pretium plant' });
  await expect(page.locator('#intake-freight-type')).toHaveCount(0);
  await page.locator('#intake-price-basis').selectOption({ label: 'Delivered' });
  await expect(page.locator('#intake-freight-type')).toHaveValue('');
  await expect(page.locator('#intake-freight-special-arrangements')).toHaveValue('');
  await page.locator('#intake-freight-type').selectOption({ label: 'Drop trailer' });
  await page
    .locator('#intake-freight-special-arrangements')
    .fill('Drop trailer at the dock for two weeks');
}

test.describe('KAM intake', () => {
  test('desktop: opportunity → product facts with the full spec and no drawing → submitted, resuming a draft', async ({
    page,
    browser,
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
    await expect(page.getByText('Pantone 286 C blue')).toBeVisible();

    // No drawing, but the full minimum spec: the quote can advance (F-016); amber only.
    await page
      .locator('#intake-drawing-status')
      .selectOption({ label: 'None (quote will take longer)' });
    await expect(page.getByTestId('drawing-or-spec')).toHaveAttribute('data-state', 'spec');
    await expect(page.getByTestId('drawing-or-spec')).toContainText('Minimum spec complete');
    await page.locator('#intake-rfp-link').fill('https://portal.example.com/rfp/42');
    await expect(page.getByTestId('blocking-list')).toHaveCount(0);
    expect(await seriousViolations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Submit to CCQ' }).click();
    await expect(page.getByTestId('submitted')).toBeVisible();
    await expect(page.getByTestId('quote-number')).toHaveText(/^CCQ-\d{4}-\d{5}$/);
    const quoteNumber = (await page.getByTestId('quote-number').textContent())!.trim();
    expect(Date.now() - started).toBeLessThan(3 * 60_000);

    // Engineering and Pricing see what was entered (T-013).
    await page.getByRole('link', { name: 'Open the quote' }).click();
    await expect(page.getByTestId('fact-resin-grade')).toHaveText('LyondellBasell Pro-fax 6331');
    await expect(page.getByTestId('fact-rfp-link')).toHaveAttribute(
      'href',
      'https://portal.example.com/rfp/42',
    );
    // FB-11: the commercial inputs are on the quote's Intake card for the KAM...
    await expect(page.getByTestId('fact-bid-reference')).toHaveText('RFP-2026-114');
    await expect(page.getByTestId('fact-payment-terms')).toContainText('Net 60');
    await expect(page.getByTestId('fact-payment-terms')).toContainText(
      'Non-standard: Pricing will review',
    );
    await expect(page.getByTestId('fact-funding')).toHaveText('Customer-funded');
    await expect(page.getByTestId('fact-dunnage')).toHaveText('Returnable (multi-trip)');
    await expect(page.getByTestId('fact-price-basis')).toHaveText('Delivered');
    await expect(page.getByTestId('fact-freight-type')).toHaveText('Drop trailer');
    await expect(page.getByTestId('fact-freight-special')).toContainText('two weeks');

    // ...and for Pricing on the Quoting tab under "From intake".
    const pricing = await (await browser.newContext()).newPage();
    await signInAs(pricing, 'pricing');
    await pricing.goto(`/quotes/${quoteNumber}?tab=quoting`);
    const fromIntake = pricing.getByTestId('quoting-from-intake');
    await expect(fromIntake).toBeVisible();
    await expect(fromIntake.getByTestId('fact-bid-reference')).toHaveText('RFP-2026-114');
    await expect(fromIntake.getByTestId('payment-terms-nonstandard')).toBeVisible();
    await expect(fromIntake.getByTestId('fact-freight-type')).toHaveText('Drop trailer');
    expect(await seriousViolations(pricing)).toEqual([]);
    await pricing.context().close();
  });

  test('no drawing and a missing gram weight: blocked, with the field named (T-022)', async ({
    page,
  }) => {
    await signInAs(page, 'kam');
    await page.goto('/intake/new');
    await pickOpportunity(page, 'Bottle');
    await fillCustomerAndProduct(page, { gramWeight: null });
    // F-015: modify an existing mold reveals what Engineering needs.
    await page.getByTestId('modify-existing-mold').check();
    await page.locator('#intake-existing-mold-ref').fill('M-10421');
    await page.locator('#intake-mold-change-description').fill('finish change 28-410 → 28-400');
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '4');
    await page.locator('#intake-drawing-status').selectOption({ label: 'Coming' });

    const status = page.getByTestId('drawing-or-spec');
    await expect(status).toHaveAttribute('data-state', 'missing');
    await expect(status.getByTestId('min-spec-missing')).toHaveText(['Gram weight (g)']);
    await expect(page.getByTestId('blocking-list')).toContainText('Missing: gram weight.');
    await expect(page.getByRole('button', { name: 'Submit to CCQ' })).toBeDisabled();
    expect(await seriousViolations(page)).toEqual([]);

    // Fix jumps back to the field; filling it unblocks the submit.
    await status.getByRole('button', { name: 'Fix' }).click();
    await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '3');
    await page.locator('#intake-gram-weight-g').fill('24');
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByTestId('drawing-or-spec')).toHaveAttribute('data-state', 'spec');
    await expect(page.getByRole('button', { name: 'Submit to CCQ' })).toBeEnabled();
    // Clean up: this draft is not needed.
    await page.getByRole('button', { name: 'Discard draft' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard draft' }).click();
    await expect(page).not.toHaveURL(/draft=/);
  });

  test('the commercial inputs are optional: a blank one is a warning and Submit stays enabled (FB-11)', async ({
    page,
  }) => {
    await signInAs(page, 'kam');
    await page.goto('/intake/new');
    await pickOpportunity(page, 'Canister');
    await fillCustomerAndProduct(page, { commercial: false });
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '4');
    await page.locator('#intake-drawing-status').selectOption({ label: 'Coming' });
    await expect(page.getByTestId('blocking-list')).toHaveCount(0);
    const warnings = page.getByTestId('warning-list');
    await expect(warnings).toContainText('Payment terms the customer requests is blank.');
    await expect(warnings).toContainText('Delivered or FOB is blank.');
    await expect(page.getByRole('button', { name: 'Submit to CCQ' })).toBeEnabled();
    // Clean up: this draft is not needed.
    await page.getByRole('button', { name: 'Discard draft' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard draft' }).click();
    await expect(page).not.toHaveURL(/draft=/);
  });

  test('"Other" PCR, resin or additive asks for the customer-specified value, which blocks submit until given (FB-09)', async ({
    page,
  }) => {
    await signInAs(page, 'kam');
    await page.goto('/intake/new');
    await pickOpportunity(page, 'Bottle');
    await fillCustomerAndProduct(page, { commercial: false });

    // PCR = Other reveals a required detail; picking a listed level hides and clears it.
    await expect(page.locator('#intake-pcr-level-other')).toHaveCount(0);
    await page.locator('#intake-pcr-level').selectOption({ label: 'Other' });
    await expect(page.locator('#intake-pcr-level-other')).toBeVisible();
    await page.locator('#intake-pcr-level-other').fill('35% PCR');
    await page.locator('#intake-pcr-level').selectOption({ label: '30%' });
    await expect(page.locator('#intake-pcr-level-other')).toHaveCount(0);
    await page.locator('#intake-pcr-level').selectOption({ label: 'Other' });
    await expect(page.locator('#intake-pcr-level-other')).toHaveValue('');

    // Additive = Other: the additives note becomes the required "Customer-specified additive".
    await page.locator('#intake-additive').selectOption({ label: 'UV' });
    await expect(page.locator('#intake-additives')).toBeVisible(); // optional note for a listed choice
    await page.locator('#intake-additive').selectOption({ label: 'Other' });
    await expect(page.getByText('Customer-specified additive')).toBeVisible();
    await page.locator('#intake-additives').fill('');

    // Resin = Other (when Salesforce did not supply the resin): the grade is required too.
    const resin = page.locator('select#intake-resin');
    const resinEditable = (await resin.count()) > 0;
    if (resinEditable) {
      await resin.selectOption({ label: 'Other' });
      await expect(page.getByText('Customer-specified resin and grade')).toBeVisible();
      await page.locator('#intake-resin-grade').fill('');
    }

    // The values are asked for at submit, not before: Next works, step 4 names the missing fields.
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '4');
    await page.locator('#intake-drawing-status').selectOption({ label: 'Coming' });
    const blocking = page.getByTestId('blocking-list');
    await expect(blocking).toBeVisible();
    await expect(blocking).toContainText('Customer-specified PCR level');
    await expect(blocking).toContainText('Customer-specified additive');
    if (resinEditable) await expect(blocking).toContainText('Customer-specified resin and grade');
    await expect(page.getByRole('button', { name: 'Submit to CCQ' })).toBeDisabled();

    // Give them on step 3; the quote submits and every reader sees them.
    await page.getByRole('button', { name: /Back/ }).click();
    await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '3');
    await page.locator('#intake-pcr-level-other').fill('35% PCR');
    await page.locator('#intake-additives').fill('Customer nucleating agent');
    if (resinEditable) await page.locator('#intake-resin-grade').fill('Eastman Tritan TX1001');
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByTestId('blocking-list')).toHaveCount(0);
    await page.getByRole('button', { name: 'Submit to CCQ' }).click();
    await expect(page.getByTestId('submitted')).toBeVisible();
    await page.getByRole('link', { name: 'Open the quote' }).click();
    await expect(page.getByText('35% PCR')).toBeVisible();
    await expect(page.getByText('Customer nucleating agent')).toBeVisible();
    if (resinEditable)
      await expect(page.getByTestId('fact-resin-grade')).toHaveText('Eastman Tritan TX1001');
  });

  test('a request class other than CCQ points to the pricing application (F-067)', async ({
    page,
  }) => {
    await signInAs(page, 'kam');
    await page.goto('/intake/new');
    await pickOpportunity(page, 'Closure');
    await page.getByRole('button', { name: /^Next/ }).click();
    await page.locator('#intake-request-class').selectOption({ label: 'Stock / stock-plus' });
    await expect(page.getByTestId('request-class-redirect')).toContainText(
      'stay in the pricing application',
    );
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByRole('button', { name: 'Submit to CCQ' })).toBeDisabled();
    await page.getByRole('button', { name: 'Discard draft' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard draft' }).click();
  });

  test('a changed ship-to needs a reason and keeps the original', async ({ page }) => {
    await signInAs(page, 'kam');
    await page.goto('/intake/new');
    await pickOpportunity(page, 'Bottle');
    const change = page.getByRole('button', { name: 'Change destination' });
    test.skip(!(await change.isVisible()), 'this opportunity has no default ship-to');
    await change.click();
    await expect(page.getByTestId('ship-to-original')).toContainText('From Salesforce:');
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
