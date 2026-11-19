import { expect, test, type Browser, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// FB-23 (N18-03 to N18-10, N18-14; Jim Zweifel, 2026-11-18; Ben's D4, D5, D6): the engineer enters the
// cost estimate per item (tooling lines with a noted markup, labor, a bagged pack-out on item 1 and a carton
// pack-out on item 2), sees the calculated figures, and the pricer reads them on the Quoting tab.
// Synthetic figures only.

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });

const ITEM = {
  productFamily: 'BOTTLE',
  components: ['CONTAINER'],
  resin: 'HDPE',
  neckDiameter: '28',
  neckFinishType: '410',
  pcrLevel: '0',
  colorType: 'NATURAL',
  heightMm: 180,
  widthOrDiameterMm: 65,
  depthMm: 65,
  gramWeightG: 24,
  packagingType: 'BULK',
  estAnnualVolume: 750_000,
  productNeededBy: new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10),
  drawingStatus: 'HAVE_DRAWING',
};

async function open(
  browser: Browser,
  persona: string,
  viewport?: { width: number; height: number },
) {
  const page: Page = await (await browser.newContext(viewport ? { viewport } : {})).newPage();
  await signInAs(page, persona);
  return page;
}

test('an engineer enters tooling, labor and pack-out per item; the pricer sees them on Quoting', async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1), {
    returnableDunnage: true,
    items: [
      {
        ...ITEM,
        key: '0193f2a0-0000-4000-8000-000000002301',
        label: '16 oz bottle',
        containerSize: '16 oz',
      },
      {
        ...ITEM,
        key: '0193f2a0-0000-4000-8000-000000002302',
        label: '24 oz bottle',
        containerSize: '24 oz',
      },
    ],
  });
  const call = async (method: 'post' | 'put', path: string, persona: string, data?: unknown) => {
    const res = await request[method](`/api/v1/quotes/${quoteNumber}/${path}`, {
      headers: as(persona),
      ...(data === undefined ? {} : { data }),
    });
    expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  };
  const me = await request.get('/api/v1/me', { headers: as('engineer') });
  const engineerId = ((await me.json()) as { user: { id: string } }).user.id;
  await call('post', 'gates/G1/decisions', 'sales-leader', { outcomeKey: 'advance' });
  await call('post', 'assignment', 'eng-lead', { engineerId });
  await call('post', 'eng-review/accept', 'engineer');
  await call('put', 'eng-review', 'engineer', { plantCode: 'AURORA', machineType: 'EBM' });

  const eng = await open(browser, 'engineer', { width: 1366, height: 768 });
  await eng.goto(`/quotes/${quoteNumber}?tab=engineering`);
  const tab = eng.getByTestId('engineering-tab');

  // ── Item 1: tooling lines (head tooling shows for EBM), freight pre-filled, start-up ticked, 15 % noted ──
  const tooling = tab.getByTestId('tooling-form');
  await tooling.getByLabel('Estimated mold lead time').fill('16-18 weeks');
  await expect(tooling.getByTestId('cost-line-head_tooling')).toBeVisible();
  await expect(tooling.getByTestId('cost-line-perso_parts')).toHaveCount(0);
  await expect(tooling).toContainText('Leave a line blank if it is not used.');
  await tooling.getByTestId('cost-amount-molds').fill('252000');
  await tooling.getByRole('button', { name: /Complete mold/ }).click();
  await expect(tooling.getByTestId('cost-amount-freight')).toHaveValue('1500');
  await tooling.getByTestId('start-up-tick').check();
  await expect(tooling.getByTestId('cost-amount-start_up')).toHaveValue('5500');
  await tooling.getByTestId('cost-amount-head_tooling').fill('12000');
  // No markup noted: the customer tooling price equals customer funded (D5).
  const totals = tooling.getByTestId('cost-totals');
  await expect(totals).toContainText('$259,000.00');
  await expect(totals).not.toContainText('markup');
  await tooling.getByTestId('tooling-markup').fill('15');
  await expect(totals).toContainText('$297,850.00 (+ 15 % markup)');
  await expect(totals).toContainText('$271,000.00'); // project total
  await expect(totals).toContainText('$12,000.00'); // net cost to Pretium
  await tooling.getByRole('button', { name: 'Save tooling and start-up' }).click();
  await expect(tooling.getByTestId('save-progress')).toHaveText('Progress saved');

  // The new-line card is collapsed until opened.
  const newLine = tab.getByTestId('new-line-card');
  await expect(newLine).toContainText(
    'Only when the quote needs a new line. Operations fills these in.',
  );
  await expect(newLine.getByTestId('new-line-form')).toHaveCount(0);

  // The budgetary capital estimate is untouched; "Use the project total" fills it.
  const capitalLine = tab.getByTestId('cost-lines-capital');
  await expect(capitalLine).toContainText('project total $271,000.00');
  await capitalLine.getByRole('button', { name: 'Use the project total' }).click();
  await expect(
    tab.getByTestId('solution-form').getByLabel(/Budgetary capital estimate/),
  ).toHaveValue('271000');
  // Saving the solution is the normal, audited edit.
  await tab.getByTestId('solution-form').getByRole('button', { name: 'Save solution' }).click();
  await expect(tab.getByTestId('solution-form').getByTestId('save-progress')).toHaveText(
    'Progress saved',
  );

  // ── Labor ──
  const labor = tab.getByTestId('labor-form');
  await labor.getByLabel('Packers per line').fill('0.68');
  await labor.getByLabel('Operators per line').fill('1');
  await expect(labor.getByTestId('labor-total')).toContainText('1.68');
  await labor.getByRole('button', { name: 'Save direct labor' }).click();
  await expect(labor.getByTestId('save-progress')).toHaveText('Progress saved');

  // ── A bagged pack-out: 84 per bag × 2 per layer × 22 layers; 28 pallets ──
  const pack = tab.getByTestId('pack-out-form');
  await pack.getByTestId('pack-out-packMethod').selectOption({ label: 'Bagged' });
  await pack.getByLabel('Item number').fill('BAG-0001');
  await pack.getByTestId('pack-out-unitsPerBag').fill('84');
  await pack.getByTestId('pack-out-containersPerLayer').fill('2');
  await pack.getByTestId('pack-out-layersPerPallet').fill('22');
  await pack.getByTestId('pack-out-palletsPerTrailer').fill('28');
  const figures = pack.getByTestId('pack-out-figures');
  await expect(figures).toContainText('44');
  await expect(figures).toContainText('3,696');
  await expect(figures).toContainText('103,488');
  // Returnable dunnage was ticked at intake (D4).
  await expect(pack.getByTestId('dunnage')).toBeVisible();
  await pack.getByLabel('Dunnage description').fill('Plastic totes');
  await pack.getByRole('button', { name: 'Save pack-out' }).click();
  await expect(pack.getByTestId('save-progress')).toHaveText('Progress saved');
  expect(await seriousViolations(eng)).toEqual([]);

  // ── Item 2: a carton pack-out: 256 per carton × 4 per layer × 5 layers; 28 pallets ──
  await tab.getByTestId('item-tab').nth(1).click();
  const pack2 = tab.getByTestId('pack-out-form');
  await pack2.getByTestId('pack-out-packMethod').selectOption({ label: 'Carton' });
  await expect(pack2.getByLabel('Pieces per carton')).toBeVisible();
  await pack2.getByTestId('pack-out-unitsPerCase').fill('256');
  await pack2.getByTestId('pack-out-containersPerLayer').fill('4');
  await pack2.getByTestId('pack-out-layersPerPallet').fill('5');
  await pack2.getByTestId('pack-out-palletsPerTrailer').fill('28');
  await expect(pack2.getByTestId('pack-out-figures')).toContainText('5,120');
  await expect(pack2.getByTestId('pack-out-figures')).toContainText('143,360');
  await pack2.getByRole('button', { name: 'Save pack-out' }).click();
  await expect(pack2.getByTestId('save-progress')).toHaveText('Progress saved');

  // At 390 px the cards fit (no sideways scroll), dark theme included.
  const narrow = await open(browser, 'engineer', { width: 390, height: 844 });
  await narrow.emulateMedia({ colorScheme: 'dark' });
  await narrow.goto(`/quotes/${quoteNumber}?tab=engineering`);
  await expect(narrow.getByTestId('tooling-form')).toBeVisible();
  expect(
    await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  expect(await seriousViolations(narrow)).toEqual([]);

  // ── The pricer reads it all on the Quoting tab, per item ──
  const pricer = await open(browser, 'pricing', { width: 1366, height: 768 });
  await pricer.goto(`/quotes/${quoteNumber}?tab=quoting`);
  const fromEng = pricer.getByTestId('quoting-from-engineering');
  const items = fromEng.getByTestId('quoting-engineering-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('16-18 weeks');
  await expect(items.nth(0)).toContainText('Head tooling');
  await expect(items.nth(0)).toContainText('$297,850.00 (+ 15 % markup)');
  await expect(items.nth(0)).toContainText('103,488');
  await expect(items.nth(0)).toContainText('Plastic totes');
  await expect(items.nth(0)).toContainText('1.68');
  await expect(items.nth(1)).toContainText('Pieces per carton');
  await expect(items.nth(1)).toContainText('143,360');
  expect(await seriousViolations(pricer)).toEqual([]);
});
