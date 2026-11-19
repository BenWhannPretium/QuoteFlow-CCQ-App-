import { expect, test, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { isoDaysFromNow, pickOpportunity } from './quotes';

// FB-24 (Nov 17 and 18 feedback): the intake. A KAM fills item 1 and duplicates it below (N18-01); the
// dropdowns read A to Z (N17-08); the tooling commitment and the stocking agreement (N18-02, D4); the
// returnable-dunnage box toggles only on the box or its words (N17-10); a concept / innovation request
// with a render and its assumptions is submitted end to end (N17-03), with red / yellow and the flag key
// (N17-09). Checked at 1366 × 768 and 390 px, light and dark. Synthetic data only (SF_MODE=fake).

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function selectIfEmpty(page: Page, id: string, label: string) {
  const select = page.locator(`select#${id}`);
  if ((await select.count()) > 0 && !(await select.inputValue()))
    await select.selectOption({ label });
}

/** Step 2: the destination's city and state when Salesforce left them blank, then on to step 3. */
async function toStep3(page: Page) {
  // N17-01: where the pre-filled ship-to came from is said, when there is one.
  const source = page.getByTestId('ship-to-source');
  if ((await source.count()) > 0) {
    await expect(source).toHaveText(/^From the (account|opportunity's product) in Salesforce\.$/);
  }
  for (const part of ['city', 'state']) {
    const input = page.locator(`#intake-ship-to-${part}`);
    if ((await input.isVisible()) && !(await input.inputValue())) {
      await input.fill(part === 'city' ? 'St. Louis' : 'MO');
    }
  }
  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '3');
  await page.locator('#intake-market').selectOption({ label: 'Food' });
  await page.locator('#intake-sub-market').selectOption({ label: 'Snacks & Confections' });
  await page.locator('#intake-quote-needed-by').fill(isoDaysFromNow(30));
}

/** The open item: its name, the product, volume and need-by; the minimum spec only when `spec`. */
async function fillItem(page: Page, name: string, size: string, spec = true) {
  await page.getByTestId('item-fields').locator('#intake-label').fill(name);
  await page.locator('#intake-product-family').selectOption({ label: 'Jar' });
  await page.locator('#intake-container-size').fill(size);
  await selectIfEmpty(page, 'intake-resin', 'HDPE');
  if (spec) {
    await page.locator('#intake-color-type').selectOption({ label: 'Natural' });
    await selectIfEmpty(page, 'intake-neck-diameter', '38 mm');
    await selectIfEmpty(page, 'intake-neck-finish-type', '400');
    for (const [id, v] of [
      ['intake-height-mm', '120'],
      ['intake-width-or-diameter-mm', '80'],
      ['intake-depth-mm', '80'],
      ['intake-gram-weight-g', '30'],
    ] as const) {
      await page.locator(`#${id}`).fill(v);
    }
  }
  const volume = page.locator('input#intake-est-annual-volume');
  if (!(await volume.inputValue())) await volume.fill('640000');
  await page.locator('#intake-product-needed-by').fill(isoDaysFromNow(120));
}

/** The review's value for a row label. */
const reviewValue = (page: Page, label: string) =>
  page
    .locator('dt', { hasText: new RegExp(`^${label}$`) })
    .first()
    .locator('xpath=following-sibling::dd[1]');

/** Both widths and both themes: nothing scrolls sideways; axe clean at 1366 in each theme. */
async function checkLayouts(page: Page, where: string) {
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const size of [
      { width: 390, height: 844 },
      { width: 1366, height: 768 },
    ]) {
      await page.setViewportSize(size);
      expect(await noSideScroll(page), `${where} ${theme} ${size.width}`).toBe(true);
    }
    expect(await seriousViolations(page), `${where} ${theme}`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: null });
}

test('a KAM fills item 1, duplicates it below and edits item 2; lists A to Z; tooling and stocking answers', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await signInAs(page, 'kam');
  await page.goto('/intake/new');
  await pickOpportunity(page, request, 'Jar');
  await toStep3(page);

  // N17-08: the dropdowns read A to Z, numbers as numbers, Other last.
  await expect(page.locator('#intake-requested-payment-terms option')).toHaveText([
    'Choose…',
    'Net 15',
    'Net 30',
    'Net 45',
    'Net 60',
    'Net 90',
    'Net 120',
    'Other',
  ]);
  // N17-04: Soldier pack is offered, before Other.
  await expect(page.locator('#intake-packaging-type option')).toHaveText([
    'Choose…',
    'Bagged',
    'Bulk',
    'Palletized-custom',
    'Soldier pack',
    'Trayed',
    'Other',
  ]);

  // N17-10: a click beside the returnable-dunnage box and its words does not toggle it.
  const dunnage = page.getByTestId('returnable-dunnage');
  const label = page.locator('label', { has: dunnage });
  const row = label.locator('xpath=..');
  const labelBox = (await label.boundingBox())!;
  const rowBox = (await row.boundingBox())!;
  expect(rowBox.x + rowBox.width).toBeGreaterThan(labelBox.x + labelBox.width + 20);
  await page.mouse.click(rowBox.x + rowBox.width - 5, labelBox.y + labelBox.height / 2);
  await expect(dunnage).not.toBeChecked();
  await dunnage.check();
  await expect(dunnage).toBeChecked();

  // N18-02 and D4: the tooling commitment and the stocking agreement.
  await page.getByTestId('answer-tooling_commitment').getByLabel('Yes').check();
  await page.getByTestId('answer-stock_hold_requested').getByLabel('Yes').check();
  await page.locator('#intake-stock-hold-weeks').fill('12');
  await page.locator('#intake-stock-hold-note').fill('Hold two months of safety stock');

  // N18-01: the open item's fields come first, the Items box after them.
  await expect(page.getByTestId('item-heading')).toContainText('Item 1');
  const fieldsBox = (await page.getByTestId('item-fields').boundingBox())!;
  const listBox = (await page.getByTestId('items-list').boundingBox())!;
  expect(listBox.y).toBeGreaterThan(fieldsBox.y + fieldsBox.height - 1);
  await fillItem(page, '8 oz jar', '8 oz');
  await page.locator('#intake-packaging-type').selectOption({ label: 'Soldier pack' });
  await page.getByTestId('duplicate-item').click();

  // The copy opens above the box, its name focused.
  await expect(page.getByTestId('item-heading')).toContainText('Item 2 of 2: 8 oz jar (copy)');
  await expect(page.locator('#intake-label')).toBeFocused();
  await page.locator('#intake-label').fill('12 oz jar');
  await page.locator('#intake-container-size').fill('12 oz');
  const list = page.getByTestId('items-list');
  await expect(list.getByTestId('item-row')).toHaveCount(2);
  await expect(list.getByTestId('item-row').nth(0)).toContainText('8 oz jar');
  await expect(list.getByTestId('item-row').nth(1)).toContainText('12 oz jar');
  await expect(list.getByTestId('item-status')).toHaveText(['Complete', 'Complete']);
  await checkLayouts(page, 'step 3');

  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '4');
  // drawing_status keeps its own order (meta keepOrder: best to worst).
  await expect(page.locator('#intake-drawing-status option')).toHaveText([
    'Choose…',
    'Have drawing',
    'Coming',
    'Sample only',
    'None (quote will take longer)',
  ]);
  await expect(page.getByRole('heading', { name: '8 oz jar' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '12 oz jar' })).toBeVisible();
  await expect(reviewValue(page, 'Returnable dunnage')).toHaveText('Yes');
  await expect(reviewValue(page, 'Customer commits to the tooling')).toHaveText('Yes');
  await expect(reviewValue(page, 'Hold stock for the customer')).toHaveText(
    'Yes, for 12 weeks · Hold two months of safety stock',
  );
  await expect(page.getByTestId('blocking-list')).toHaveCount(0);
});

test('a KAM submits a concept request with a render and its assumptions', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await signInAs(page, 'kam');
  await page.goto('/intake/new');
  await pickOpportunity(page, request, 'Jar');
  await toStep3(page);

  // N17-03: the concept class shows its badge and asks for its assumptions; no dimensions are required.
  await expect(page.getByTestId('concept-fields')).toHaveCount(0);
  await page.locator('#intake-request-class').selectOption({ label: 'Concept / innovation' });
  await expect(page.getByTestId('concept-badge')).toBeVisible();
  await expect(page.getByTestId('concept-fields')).toBeVisible();
  await expect(page.getByTestId('request-class-redirect')).toHaveCount(0);
  await fillItem(page, 'Concept jar', '10 oz', false);
  await expect(page.locator('#intake-height-mm')).toHaveValue('');
  await checkLayouts(page, 'step 3 concept');

  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '4');
  // N17-09: what stops you is red, with the key that says so.
  const rule = page.getByTestId('drawing-or-spec');
  await expect(rule).toHaveAttribute('data-state', 'render-missing');
  await expect(rule).toContainText("Add the customer's render or photo, or a drawing");
  await expect(page.getByTestId('blocking-list')).toContainText('Assumptions for this concept');
  await expect(page.getByTestId('blocking-list')).toHaveAttribute('data-tone', 'blocking');
  await expect(page.getByTestId('flag-key')).toBeVisible();
  await expect(page.getByTestId('flag-key-red')).toHaveText('Red: fix before you can go on.');
  await checkLayouts(page, 'step 4 concept');

  // The render goes in as "Sample photo / render" through the one "Add file" control.
  await page.getByLabel('File type').selectOption({ label: 'Sample photo / render' });
  await page
    .getByTestId('attachment-input')
    .setInputFiles({ name: 'concept-render.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('attachment-row')).toContainText('concept-render.png');
  await expect(rule).toHaveAttribute('data-state', 'render');

  // The assumptions, from the review's Fix link.
  await page.getByTestId('blocking-list').getByRole('button', { name: 'Fix' }).first().click();
  await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '3');
  const assumptions = '10 oz round jar, about 25 g, HDPE natural; pack-out and cycle estimated.';
  await page.locator('#intake-concept-assumptions').fill(assumptions);
  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '4');
  await expect(page.getByTestId('blocking-list')).toHaveCount(0);
  await expect(reviewValue(page, 'Concept assumptions')).toHaveText(assumptions);

  await page.getByRole('button', { name: 'Submit to CCQ' }).click();
  await expect(page.getByTestId('submitted')).toBeVisible();
  await page.getByRole('link', { name: 'Open the quote' }).click();
  await expect(page.getByTestId('concept-badge').first()).toBeVisible();
  await expect(page.getByTestId('fact-concept-assumptions')).toContainText(assumptions);
});
