import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import {
  DEV_USER_HEADER,
  freeOpportunities,
  isoDaysFromNow,
  pickFirstFree,
  pickOpportunity,
} from './quotes';

// FB-19 (W13-32 to W13-34): multi-item quotes. A KAM builds a three-item quote from the opportunity's
// Salesforce products and a duplicate, and submits it; Engineering works each item; G2 is refused while
// one item is incomplete, then advances; the Final Review screen lists the three items. Synthetic data
// only (SF_MODE=fake).

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });

/** Free opportunities whose Salesforce record has at least two product specifications (a few). */
async function opportunitiesWithTwoProducts(request: APIRequestContext) {
  const found: { id: string; name: string }[] = [];
  for (const id of await freeOpportunities(request, 40)) {
    const res = await request.get(`/api/v1/salesforce/opportunities/${id}`, { headers: as('kam') });
    const body = (await res.json()) as {
      opportunity: { name: string; accountId: string | null };
      productSpecs: unknown[];
    };
    if (body.productSpecs.length >= 2 && body.opportunity.accountId) {
      found.push({ id, name: body.opportunity.name });
      if (found.length === 5) break;
    }
  }
  expect(found.length, 'a free opportunity with two Salesforce products').toBeGreaterThan(0);
  return found;
}

async function selectIfEmpty(page: Page, id: string, label: string) {
  const select = page.locator(`select#${id}`);
  if (!(await select.inputValue())) await select.selectOption({ label });
}

/** The open item's fields: its name, the product, the minimum spec, volume and need-by. */
async function fillItem(page: Page, name: string, size: string) {
  const fields = page.getByTestId('item-fields');
  await fields.locator('#intake-label').fill(name);
  await page.locator('#intake-product-family').selectOption({ label: 'Bottle' });
  await page.locator('#intake-container-size').fill(size);
  await selectIfEmpty(page, 'intake-resin', 'HDPE');
  await page.locator('#intake-color-type').selectOption({ label: 'Natural' });
  await selectIfEmpty(page, 'intake-neck-diameter', '38 mm');
  await selectIfEmpty(page, 'intake-neck-finish-type', '400');
  for (const [id, v] of [
    ['intake-height-mm', '180'],
    ['intake-width-or-diameter-mm', '65'],
    ['intake-depth-mm', '65'],
    ['intake-gram-weight-g', '24'],
  ] as const) {
    await page.locator(`#${id}`).fill(v);
  }
  const volume = page.locator('input#intake-est-annual-volume');
  if (!(await volume.inputValue())) await volume.fill('640000');
  await page.locator('#intake-product-needed-by').fill(isoDaysFromNow(120));
}

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test('a KAM builds a three-item quote; Engineering works each item; G2 waits for all three', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const candidates = await opportunitiesWithTwoProducts(request);
  await signInAs(page, 'kam');
  await page.goto('/intake/new');
  // The first one still free (a parallel spec may have quoted one since the list was read).
  expect(
    await pickFirstFree(page, candidates),
    'a free opportunity with two products',
  ).not.toBeNull();
  for (const part of ['city', 'state']) {
    const input = page.locator(`#intake-ship-to-${part}`);
    if ((await input.isVisible()) && !(await input.inputValue())) {
      await input.fill(part === 'city' ? 'St. Louis' : 'MO');
    }
  }
  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '3');

  // The request, once.
  await page.locator('#intake-market').selectOption({ label: 'Food' });
  await page.locator('#intake-sub-market').selectOption({ label: 'Snacks & Confections' });
  await page.locator('#intake-quote-needed-by').fill(isoDaysFromNow(30));

  // Item 1 came from the first Salesforce product; the second is added from Salesforce.
  const list = page.getByTestId('items-list');
  await expect(list.getByTestId('item-row')).toHaveCount(1);
  await fillItem(page, '16 oz bottle', '16 oz');
  await page.getByTestId('add-from-salesforce').click();
  await expect(list.getByTestId('item-row')).toHaveCount(2);
  await expect(page.getByTestId('item-fields')).toHaveAttribute('data-item', '2');
  await fillItem(page, '24 oz bottle', '24 oz');
  // Duplicate item 2 and change only what differs (F-084).
  await page.getByRole('button', { name: 'Duplicate item 2' }).click();
  await expect(list.getByTestId('item-row')).toHaveCount(3);
  await expect(page.getByTestId('item-fields')).toHaveAttribute('data-item', '3');
  await expect(page.locator('#intake-label')).toHaveValue('24 oz bottle (copy)');
  await page.locator('#intake-label').fill('24 oz bottle 25% PCR');
  await page.locator('#intake-pcr-level').selectOption({ index: 2 });
  await expect(list.getByTestId('item-status')).toHaveText(['Complete', 'Complete', 'Complete']);

  // The phone width and both themes: the Items list fits.
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const size of [
      { width: 1366, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      expect(await noSideScroll(page), `${theme} ${size.width}`).toBe(true);
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '4');
  await expect(page.getByTestId('blocking-list')).toHaveCount(0);
  for (const name of [
    'Item 1 (16 oz bottle)',
    'Item 2 (24 oz bottle)',
    'Item 3 (24 oz bottle 25% PCR)',
  ]) {
    await expect(page.getByRole('heading', { name })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Submit to CCQ' }).click();
  const qn = (await page.getByTestId('quote-number').textContent())!.trim();
  expect(qn).toMatch(/^CCQ-\d{4}-\d{5}$/);

  // Engineering: G1, assignment, acceptance; items 1 and 2 worked through the API.
  const ok = async (res: Awaited<ReturnType<APIRequestContext['post']>>) =>
    expect(res.ok(), await res.text()).toBe(true);
  await ok(
    await request.post(`/api/v1/quotes/${qn}/gates/G1/decisions`, {
      headers: as('sales-leader'),
      data: { outcomeKey: 'advance' },
    }),
  );
  const me = async (persona: string) =>
    (
      (await (await request.get('/api/v1/me', { headers: as(persona) })).json()) as {
        user: { id: string };
      }
    ).user.id;
  const engineer = await me('engineer');
  await ok(
    await request.post(`/api/v1/quotes/${qn}/assignment`, {
      headers: as('eng-lead'),
      data: { engineerId: engineer },
    }),
  );
  await ok(
    await request.post(`/api/v1/quotes/${qn}/eng-review/accept`, { headers: as('engineer') }),
  );
  const detail = (await (
    await request.get(`/api/v1/quotes/${qn}`, { headers: as('eng-lead') })
  ).json()) as { engineering: { items: { id: string }[] } };
  const itemIds = detail.engineering.items.map((i) => i.id);
  expect(itemIds).toHaveLength(3);
  const solution = {
    plantCode: 'AURORA',
    machineType: 'EBM',
    cavitation: 8,
    cycleTimeS: 14.5,
    prelimCapitalUsd: 0,
  };
  const row = {
    site: 'AURORA',
    lineAsset: 'Line 4',
    assumedEffectivenessPct: 70,
    cycleTimeS: 14.5,
    utilizationBeforePct: 62,
    analysisDate: isoDaysFromNow(0),
    analystId: engineer,
  };
  for (const id of itemIds) {
    await ok(
      await request.put(`/api/v1/quotes/${qn}/capacity-evidence`, {
        headers: as('engineer'),
        data: { itemId: id, rows: [row] },
      }),
    );
  }
  for (const id of itemIds.slice(0, 2)) {
    await ok(
      await request.put(`/api/v1/quotes/${qn}/eng-review`, {
        headers: as('engineer'),
        data: { ...solution, itemId: id },
      }),
    );
  }
  await ok(
    await request.put(`/api/v1/quotes/${qn}/capacity-signoff`, {
      headers: as('eng-lead'),
      data: { status: 'approved' },
    }),
  );

  // G2 is refused while item 3 has no solution, and the refusal names it.
  const refused = await request.post(`/api/v1/quotes/${qn}/gates/G2/decisions`, {
    headers: as('eng-lead'),
    data: { outcomeKey: 'proceed' },
  });
  expect(refused.status()).toBe(422);
  expect(await refused.text()).toContain('Item 3 (24 oz bottle 25% PCR)');

  // The engineer opens item 3 in the switcher and saves its solution there.
  const eng = await page.context().newPage();
  await signInAs(eng, 'engineer');
  await eng.goto(`/quotes/${qn}?tab=engineering`);
  const switcher = eng.getByTestId('item-switcher');
  await expect(switcher.getByTestId('item-tab')).toHaveCount(3);
  await expect(switcher.getByTestId('item-tab').nth(2)).toContainText('to do');
  await switcher.getByTestId('item-tab').nth(2).click();
  const form = eng.getByTestId('solution-form');
  await form.getByLabel('Plant / site').selectOption({ label: 'Aurora' });
  await form.getByLabel('Process & machine type').selectOption({ label: 'EBM' });
  await form.getByLabel('Cavitation').fill('8');
  await form.getByLabel('Cycle time (s)').fill('14.5');
  await form.getByLabel('Budgetary capital estimate (USD)').fill('0');
  await form.getByRole('button', { name: 'Save solution' }).click();
  await expect(switcher.getByTestId('item-tab').nth(2)).not.toContainText('to do');
  // The other items kept their own solutions.
  await switcher.getByTestId('item-tab').nth(0).click();
  await expect(eng.getByTestId('solution-form').getByLabel('Cavitation')).toHaveValue('8');
  for (const theme of ['light', 'dark'] as const) {
    await eng.emulateMedia({ colorScheme: theme });
    for (const size of [
      { width: 1366, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await eng.setViewportSize(size);
      expect(await noSideScroll(eng), `engineering ${theme} ${size.width}`).toBe(true);
    }
  }
  await eng.setViewportSize({ width: 1366, height: 768 });
  expect(await seriousViolations(eng)).toEqual([]);

  await ok(
    await request.post(`/api/v1/quotes/${qn}/eng-review/submit`, { headers: as('engineer') }),
  );
  await ok(
    await request.post(`/api/v1/quotes/${qn}/gates/G2/decisions`, {
      headers: as('eng-lead'),
      data: { outcomeKey: 'proceed' },
    }),
  );

  // The Final Review screen lists the three items with their plant and machine.
  const approver = await page.context().newPage();
  await signInAs(approver, 'approver');
  await approver.goto(`/quotes/${qn}/review`);
  const reviewItems = approver.getByTestId('review-items');
  await expect(reviewItems.getByTestId('quote-item')).toHaveCount(3);
  await expect(reviewItems).toContainText('Item 3 (24 oz bottle 25% PCR)');
  await expect(reviewItems).toContainText('Aurora');

  // The quotes list: "One row per item" exports the three items, the quote's columns on each.
  await page.goto(`/quotes?q=${qn}`);
  await page.getByTestId('export-per-item').check();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-csv').click(),
  ]);
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  const lines = Buffer.concat(chunks).toString('utf8').trim().split(/\r?\n/);
  expect(lines[0]).toContain('Item label');
  expect(lines.filter((l) => l.includes(qn))).toHaveLength(3);
  expect(lines.some((l) => l.includes('24 oz bottle 25% PCR'))).toBe(true);
});

test('a single-item intake still reads as before: no switcher, no item names', async ({
  page,
  request,
}) => {
  await signInAs(page, 'kam');
  await page.goto('/intake/new');
  await pickOpportunity(page, request, 'Oval');
  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByTestId('items-list').getByTestId('item-row')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Remove item 1' })).toBeDisabled();
  await expect(page.getByTestId('item-fields')).toHaveAttribute('data-item', '1');
});
