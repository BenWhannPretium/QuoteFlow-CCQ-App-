import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { as, ok } from './customer-decision';
import { signInAs } from './personas';
import { asKam, freeOpportunities, isoDaysFromNow, pickFirstFree } from './quotes';

// FB-32 (N19-04, Sarah Brennan): less double entry. Item 1's name comes from the opportunity's first
// product specification and says so; the "Salesforce says X, Use this" hint under Color exists only while
// the setting `intake_sf_suggestions_enabled` is on (seeded off) and only for an exact list entry. Checked at
// 1366 × 768 and 390 px, light and dark, axe. Synthetic data only (SF_MODE=fake). Nothing is written to Salesforce.

const KEY = 'intake_sf_suggestions_enabled';
const WHY = 'FB-32 e2e';

interface Spec {
  name: string | null;
  color: string | null;
  capacity: string | null;
}

/** A free opportunity whose first product specification satisfies `want`, with that specification. */
async function opportunityWith(
  request: APIRequestContext,
  want: (spec: Spec) => boolean,
): Promise<{ id: string; name: string; spec: Spec }> {
  for (const id of await freeOpportunities(request, 40)) {
    const res = await request.get(`/api/v1/salesforce/opportunities/${id}`, { headers: asKam });
    expect(res.ok(), await res.text()).toBe(true);
    const body = (await res.json()) as {
      opportunity: { name: string };
      productSpecs: Spec[];
    };
    const spec = body.productSpecs[0];
    if (spec && want(spec)) return { id, name: body.opportunity.name, spec };
  }
  throw new Error('no free synthetic opportunity has a matching product specification');
}

async function setSuggestions(request: APIRequestContext, on: boolean) {
  const list = await request.get('/api/v1/admin/config/settings', { headers: as('admin') });
  const row = (
    (await list.json()) as { items: { key: string; version: number; value: unknown }[] }
  ).items.find((s) => s.key === KEY)!;
  expect(row, `${KEY} is seeded`).toBeTruthy();
  if (row.value === on) return;
  await ok(
    request.patch(`/api/v1/admin/config/settings/${KEY}`, {
      headers: as('admin'),
      data: { version: row.version, changeReason: WHY, value: on },
    }),
  );
}

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/** Step 2 to step 3: the destination's city and state when Salesforce left them blank. */
async function toStep3(page: Page) {
  for (const part of ['city', 'state']) {
    const input = page.locator(`#intake-ship-to-${part}`);
    if ((await input.isVisible()) && !(await input.inputValue())) {
      await input.fill(part === 'city' ? 'St. Louis' : 'MO');
    }
  }
  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '3');
  await page.locator('#intake-quote-needed-by').fill(isoDaysFromNow(30));
}

async function discard(page: Page) {
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard draft' }).click();
  await expect(page).not.toHaveURL(/draft=/);
}

/** Both widths and both themes: nothing scrolls sideways; axe clean in each theme. */
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

test.describe.configure({ mode: 'serial' });

test.afterAll(async ({ request }) => {
  await setSuggestions(request, false);
});

test("item 1's name comes from the product specification, says so, and can be changed or restored", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await setSuggestions(request, false);
  const picked = await opportunityWith(request, (s) => Boolean(s.name?.trim()));
  await signInAs(page, 'kam');
  await page.goto('/intake/new');
  expect(await pickFirstFree(page, [picked]), 'the opportunity was free').toBe(picked.id);
  await toStep3(page);

  const label = page.getByTestId('item-fields').locator('#intake-label');
  await expect(label).toHaveValue(picked.spec.name!.trim());
  const note = page.getByTestId('sf-label');
  await expect(note).toContainText('from Salesforce');
  await expect(note).toContainText('Change it here if it is wrong');
  await expect(page.getByTestId('item-heading')).toContainText(picked.spec.name!.trim());

  // The hints are off by default: nothing under Color says what Salesforce holds.
  await expect(page.getByTestId('sf-color-suggestion')).toHaveCount(0);

  // The KAM's own name wins, and the way back is offered.
  await label.fill('My 16 oz bottle');
  await expect(note).toContainText(`Salesforce has “${picked.spec.name!.trim()}”.`);
  await page.getByRole('button', { name: 'Use the Salesforce value' }).first().click();
  await expect(label).toHaveValue(picked.spec.name!.trim());

  await checkLayouts(page, "item 1's name");
  await discard(page);
});

test('with the setting on, "Salesforce says Natural" is a hint, "Use this" fills it and tags it; off shows nothing', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const picked = await opportunityWith(request, (s) => s.color === 'Natural');
  await setSuggestions(request, true);
  await signInAs(page, 'kam');
  await page.goto('/intake/new');
  expect(await pickFirstFree(page, [picked]), 'the opportunity was free').toBe(picked.id);
  await toStep3(page);

  const color = page.locator('#intake-color-type');
  // Nothing is filled by itself: the hint only says what Salesforce holds.
  await expect(color).toHaveValue('');
  const hint = page.getByTestId('sf-color-suggestion');
  await expect(hint).toContainText('Color in Salesforce says “Natural”.');
  await checkLayouts(page, 'color hint');

  await hint.getByRole('button', { name: 'Use this' }).click();
  await expect(color).toHaveValue('NATURAL');
  await expect(hint).toHaveCount(0);
  const note = page.getByTestId('sf-color');
  await expect(note).toContainText('from Salesforce');

  // It is an ordinary field after that: change it and the way back is offered.
  await color.selectOption({ label: 'Custom color' });
  await expect(note).toContainText('Salesforce has Natural.');
  await page.getByRole('button', { name: 'Use the Salesforce value' }).last().click();
  await expect(color).toHaveValue('NATURAL');
  await checkLayouts(page, 'color from Salesforce');

  // Switched off again: no hint on a new intake.
  await discard(page);
  await setSuggestions(request, false);
  const other = await opportunityWith(request, (s) => s.color === 'Natural');
  await page.goto('/intake/new');
  expect(await pickFirstFree(page, [other])).toBe(other.id);
  await toStep3(page);
  await expect(page.getByTestId('item-fields')).toBeVisible();
  await expect(page.getByTestId('sf-color-suggestion')).toHaveCount(0);
  await discard(page);
});

test('a color Salesforce holds that is not on the list is not offered', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const picked = await opportunityWith(request, (s) => s.color === 'Amber');
  await setSuggestions(request, true);
  await signInAs(page, 'kam');
  await page.goto('/intake/new');
  expect(await pickFirstFree(page, [picked])).toBe(picked.id);
  await toStep3(page);
  await expect(page.getByTestId('item-fields')).toBeVisible();
  await expect(page.getByTestId('sf-color-suggestion')).toHaveCount(0);
  await expect(page.locator('#intake-color-type')).toHaveValue('');
  await discard(page);
});
