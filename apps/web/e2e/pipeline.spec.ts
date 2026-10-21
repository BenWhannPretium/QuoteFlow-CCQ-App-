import { expect, test, type Locator, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// B-14 pipeline views (F-07). The e2e database is config-seeded only, so each test makes its quotes
// through the API: a KAM submits, the SalesLeader qualifies (G1 Advance) → Engineering Review.

async function quoteInEngReview(request: Parameters<typeof submitQuote>[0]): Promise<string> {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  const advance = await request.post(`/api/v1/quotes/${quoteNumber}/gates/G1/decisions`, {
    headers: { [DEV_USER_HEADER]: 'sales-leader' },
    data: { outcomeKey: 'advance', note: 'e2e: qualified' },
  });
  expect(advance.status(), await advance.text()).toBe(201);
  return quoteNumber;
}

/** A real mouse drag (dnd-kit's MouseSensor needs a few moves past its 6 px threshold). */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + 20);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + 30, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + 80, { steps: 12 });
  await page.mouse.up();
}

test('filter, then sort, then open a quote (URL holds the view)', async ({ page, request }) => {
  test.setTimeout(90_000);
  const quoteNumber = await quoteInEngReview(request);
  await signInAs(page, 'kam');
  await page.goto('/quotes');
  await expect(page.getByRole('heading', { level: 1, name: 'Pipeline' })).toBeVisible();

  // Filter: Stage = Engineering Review (Filters popover).
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('checkbox', { name: 'Engineering Review' }).check();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/stage=ENG_REVIEW/);
  await expect(page.getByRole('button', { name: 'Filters 1 active' })).toBeVisible();

  // Sort: score, then flip to ascending.
  await page.getByTestId('sort-select').selectOption('score');
  await expect(page).toHaveURL(/sort=score/);
  await page.getByTestId('sort-dir').click();
  await expect(page).toHaveURL(/dir=asc/);

  // The link is the view: reloading keeps filters and sort.
  await page.reload();
  await expect(page.getByTestId('sort-select')).toHaveValue('score');
  await expect(page.getByTestId(`quote-row-${quoteNumber}`)).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  // Open the quote from its row.
  await page
    .getByTestId(`quote-row-${quoteNumber}`)
    .getByRole('link', { name: quoteNumber })
    .click();
  await expect(page).toHaveURL(new RegExp(`/quotes/${quoteNumber}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText(quoteNumber);
});

test('EngLead drags ENG_REVIEW → QUOTING: the G2 dialog opens on Advance; cancel snaps back', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const quoteNumber = await quoteInEngReview(request);
  await signInAs(page, 'eng-lead');
  await page.goto(`/board?q=${quoteNumber}`);
  const card = page.locator(`[data-testid="board-card"][data-quote="${quoteNumber}"]`);
  await expect(card).toBeVisible();
  await expect(page.locator('[data-column="ENG_REVIEW"]')).toContainText(quoteNumber);
  await expect(card).toHaveAttribute('data-draggable', 'true');
  expect(await seriousViolations(page)).toEqual([]);

  // A column no G2 outcome leads to: refused, with the reason.
  await drag(page, card, page.locator('[data-column="FINAL_REVIEW"]'));
  await expect(page.getByTestId('drop-denied')).toContainText(
    'No “Feasible solution?” outcome moves a quote from Engineering Review to Final Review',
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The allowed column: the gate dialog opens with the matching outcome preselected.
  await drag(page, card, page.locator('[data-column="QUOTING"]'));
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Feasible solution?' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Advance', exact: true })).toBeChecked();
  await expect(page.locator('[data-column="QUOTING"]')).toContainText(quoteNumber);

  // Cancel: nothing was decided, the card is back in Engineering Review.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-column="ENG_REVIEW"]')).toContainText(quoteNumber);
  await expect(page.locator('[data-column="QUOTING"]')).not.toContainText(quoteNumber);
});

test('a KAM cannot drag an Engineering Review card; the board works at 390 px', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const quoteNumber = await quoteInEngReview(request);
  await signInAs(page, 'kam');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/board?q=${quoteNumber}`);
  const card = page.locator(`[data-testid="board-card"][data-quote="${quoteNumber}"]`);
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-draggable', 'false');
  await expect(card.getByTestId('card-move')).toHaveCount(0);
  // Stage tabs, and no horizontal page scroll (the columns scroll inside the board).
  await expect(page.getByRole('navigation', { name: 'Stages' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
