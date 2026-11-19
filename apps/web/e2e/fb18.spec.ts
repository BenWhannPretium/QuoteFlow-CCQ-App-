import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// FB-18 (W13-29, W13-30 and the Command Center half of W13-26): Home is the Command Center with a
// "My work" and an "Analytics" view, a quote on hold says so on the Command Center lists, and a Save
// says "Progress saved" beside its button. Each is checked at 1366 × 768 and at 390 px, light and
// dark. (The Salesforce link and the Admin's hint, W13-31, are in fb04.spec.ts: it owns the
// Salesforce URL setting, which every spec shares. The filters of the Analytics view are in
// dashboards.spec.ts.)

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });

async function ok(res: Promise<APIResponse>, status = 200) {
  const r = await res;
  expect(r.status(), await r.text()).toBe(status);
  return r;
}

/** Provisions the persona (the e2e database is config-seeded only) and returns who it is. */
const me = async (request: APIRequestContext, persona: string) =>
  (
    (await (await request.get('/api/v1/me', { headers: as(persona) })).json()) as {
      user: { id: string; displayName: string };
    }
  ).user;

const LAPTOP = { width: 1366, height: 768 };
const PHONE = { width: 390, height: 844 };

/** How far the page runs off the side of the screen (0: it fits). */
const sideways = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });

const decideG1 = (request: APIRequestContext, qn: string, data: Record<string, unknown>) =>
  ok(
    request.post(`/api/v1/quotes/${qn}/gates/G1/decisions`, { headers: as('sales-leader'), data }),
    201,
  );

test('a sales leader opens Analytics from the Command Center, and the view is remembered', async ({
  page,
}) => {
  await page.setViewportSize(LAPTOP);
  await signInAs(page, 'sales-leader', 'light');
  await page.goto('/');
  const landing = page.getByTestId('landing');
  await expect(landing).toHaveAttribute('data-role', 'SalesLeader');
  await expect(landing).toHaveAttribute('data-view', 'work');
  await expect(page.getByText('Command Center · Sales leader', { exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Sales pipeline · Command Center · QuoteFlow');

  // The nav says "Command Center" where it said "Home", and Analytics is no longer an item in it.
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.locator('[data-nav="home"]')).toHaveAccessibleName('Command Center');
  await expect(nav.locator('[data-nav="analytics"]')).toHaveCount(0);

  // Analytics is the second view, one click away.
  const views = page.getByRole('navigation', { name: 'Command Center view' });
  const work = views.getByRole('link', { name: 'My work', exact: true });
  const analytics = views.getByRole('link', { name: 'Analytics', exact: true });
  await expect(work).toHaveAttribute('aria-current', 'page');
  await analytics.click();
  await expect(landing).toHaveAttribute('data-view', 'analytics');
  await expect(page).toHaveURL(/[?&]view=analytics/);
  await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
  await expect(page.getByTestId('analytics-page')).toBeVisible();
  await expect(page.getByText('Command Center · Sales leader', { exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Analytics · Command Center · QuoteFlow');
  await expect(analytics).toHaveAttribute('aria-current', 'page');
  await expect(work).not.toHaveAttribute('aria-current', 'page');

  // The keyboard works the switch like any link.
  await work.focus();
  await page.keyboard.press('Enter');
  await expect(landing).toHaveAttribute('data-view', 'work');
  await expect(page).toHaveURL(/[?&]view=work/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sales pipeline' })).toBeVisible();
  await expect(work).toHaveAttribute('aria-current', 'page');
  await expect(analytics).not.toHaveAttribute('aria-current', 'page');

  // The Command Center opens on the view the user chose last: from the menu, and on a new visit.
  await analytics.click();
  await expect(landing).toHaveAttribute('data-view', 'analytics');
  await nav.locator('[data-nav="home"]').click();
  await expect(landing).toHaveAttribute('data-view', 'analytics');
  await page.goto('/');
  await expect(landing).toHaveAttribute('data-view', 'analytics');
  await expect(page.getByTestId('analytics-page')).toBeVisible();
  await expect(page).not.toHaveURL(/view=/);
  // One view is marked as the open one, whether or not the address names it.
  await expect(analytics).toHaveAttribute('aria-current', 'page');
  await expect(work).not.toHaveAttribute('aria-current', 'page');
  // And back to My work, which is remembered in turn.
  await work.click();
  await expect(landing).toHaveAttribute('data-view', 'work');
  await page.goto('/');
  await expect(landing).toHaveAttribute('data-view', 'work');
  await expect(work).toHaveAttribute('aria-current', 'page');
  await expect(analytics).not.toHaveAttribute('aria-current', 'page');
});

test('the old /analytics address opens the Analytics view with its filters', async ({ page }) => {
  await signInAs(page, 'leadership');
  await page.goto('/analytics?market=FOOD&from=2026-01-01&to=2026-06-30');
  await expect(page.getByTestId('landing')).toHaveAttribute('data-view', 'analytics');
  await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
  await expect(page).not.toHaveURL(/\/analytics/);
  await expect(page).toHaveURL(/[?&]view=analytics/);
  await expect(page).toHaveURL(/[?&]market=FOOD/);
  await expect(page).toHaveURL(/[?&]from=2026-01-01/);
  await expect(page).toHaveURL(/[?&]to=2026-06-30/);
  await expect(page.getByTestId('analytics-filters').getByLabel('Market')).toHaveValue('FOOD');
});

test('a KAM has one view, no switch, and is refused the Analytics view', async ({ page }) => {
  await signInAs(page, 'kam');
  await page.goto('/');
  const landing = page.getByTestId('landing');
  await expect(landing).toHaveAttribute('data-role', 'KAM');
  await expect(landing).toHaveAttribute('data-view', 'work');
  await expect(
    page.getByText('Command Center · Key account manager', { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('command-center-views')).toHaveCount(0);

  // Who may read analytics has not changed: asking for the view by its address shows the 403 page.
  await page.goto('/?view=analytics');
  await expect(page.getByTestId('forbidden')).toBeVisible();
  await expect(page.getByTestId('analytics-page')).toHaveCount(0);
  await page.goto('/analytics');
  await expect(page.getByTestId('forbidden')).toBeVisible();
});

test('both views of the Command Center fit a laptop and a phone, light and dark', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const views = page.getByRole('navigation', { name: 'Command Center view' });
  for (const theme of ['light', 'dark'] as const) {
    await signInAs(page, 'sales-leader', theme);
    for (const size of [LAPTOP, PHONE]) {
      const where = `${theme} ${size.width}`;
      await page.setViewportSize(size);

      await page.goto('/');
      await expect(page.getByTestId('landing')).toHaveAttribute('data-view', 'work');
      await expect(page.locator('[data-testid^="dash-"]').first()).toBeVisible();
      await expect(views).toBeVisible();
      expect(await sideways(page), `My work ${where}`).toBeLessThanOrEqual(0);
      expect(await seriousViolations(page), `My work ${where}`).toEqual([]);

      await page.goto('/?view=analytics');
      await expect(page.getByTestId('landing')).toHaveAttribute('data-view', 'analytics');
      await expect(page.getByTestId('analytics-footer')).toBeVisible();
      await expect(views).toBeVisible();
      expect(await sideways(page), `Analytics ${where}`).toBeLessThanOrEqual(0);
      expect(await seriousViolations(page), `Analytics ${where}`).toEqual([]);

      if (size === PHONE) {
        // A thumb can hit either view (43.5: a 44 px control can measure 43.99998 after rounding).
        for (const name of ['My work', 'Analytics']) {
          const box = (await views.getByRole('link', { name, exact: true }).boundingBox())!;
          expect(box.height, `${name} ${where}`).toBeGreaterThanOrEqual(43.5);
          expect(box.width, `${name} ${where}`).toBeGreaterThanOrEqual(43.5);
        }
      }
    }
  }
});

test('a KAM sees which quote is on hold on the Command Center: why, who owns it and the review date', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  await me(request, 'kam');
  const leader = await me(request, 'sales-leader');
  const qn = await submitQuote(request, await freeOpportunities(request, 1));
  const reviewDate = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  await decideG1(request, qn, {
    outcomeKey: 'hold',
    reasonCode: 'awaiting_customer_info',
    note: 'Customer is confirming the volume',
    holdUntil: reviewDate,
    holdOwnerId: leader.id,
  });

  // The sentence the quote header and the timeline use (FB-17), ending with the review date.
  const owner = `Owner: ${leader.displayName}.`;
  const sentence = `On hold: Awaiting customer information. ${owner} Review by`;
  // On hold comes first in its stage, so the quote is on the board however many the KAM has.
  const board = page.getByTestId('dash-my-pipeline').getByTestId('mini-board');
  const row = board.locator('li[data-status="on_hold"]').filter({ hasText: qn });
  const chip = row.getByTestId('hold-chip');
  const detail = page.getByTestId('hold-chip-detail');

  for (const theme of ['light', 'dark'] as const) {
    await signInAs(page, 'kam', theme);
    for (const size of [LAPTOP, PHONE]) {
      const where = `${theme} ${size.width}`;
      await page.setViewportSize(size);
      await page.goto('/');
      await expect(page.getByTestId('landing')).toHaveAttribute('data-role', 'KAM');
      await expect(chip).toBeVisible();
      await expect(chip).toHaveText('On hold');
      // The sentence is the chip's name too: a screen reader hears it without opening anything.
      expect(await chip.getAttribute('aria-label'), where).toContain(sentence);
      expect(await sideways(page), where).toBeLessThanOrEqual(0);

      if (size === LAPTOP) {
        // The mouse: resting on the chip opens it.
        await chip.hover();
        await expect(detail).toBeVisible();
        await expect(detail).toContainText(sentence);
        await page.keyboard.press('Escape');
        await expect(detail).toBeHidden();
        // The keyboard: focus alone opens it.
        await chip.focus();
      } else {
        // A phone has no hover: a tap opens it. Scroll first: a tooltip closes when the page scrolls,
        // and the click's own scroll-into-view can land just after the tap.
        await chip.scrollIntoViewIfNeeded();
        await expect(async () => {
          await chip.click();
          await expect(detail).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
      }
      await expect(detail).toBeVisible();
      await expect(detail).toContainText(sentence);
      expect(await seriousViolations(page), where).toEqual([]);
      // All of it is on the screen (the tooltip keeps 16 px from every edge, so this has room).
      const box = (await detail.boundingBox())!;
      expect(box.x, where).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, where).toBeLessThanOrEqual(size.width);
    }
  }

  // The next decision ends the hold, and the chip goes with it.
  await decideG1(request, qn, { outcomeKey: 'advance' });
  await page.reload();
  await expect(board).toBeVisible();
  await expect(row).toHaveCount(0);
});

test('a Save says "Progress saved" beside its button until the form changes, and why when it fails', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  for (const p of ['kam', 'sales-leader', 'eng-lead']) await me(request, p);
  const qn = await submitQuote(request, await freeOpportunities(request, 1));
  await decideG1(request, qn, { outcomeKey: 'advance' });
  await ok(
    request.put(`/api/v1/quotes/${qn}/eng-review`, {
      headers: as('eng-lead'),
      data: {
        processType: 'EBM',
        machineType: 'EBM',
        plantCode: 'AURORA',
        cavitation: 8,
        cycleTimeS: 14.5,
        prelimCapitalUsd: 0,
      },
    }),
  );

  const solution = page.getByTestId('engineering-tab').getByTestId('solution-form');
  const save = solution.getByRole('button', { name: 'Save solution' });
  const status = solution.getByTestId('save-progress');
  const notes = solution.getByLabel('Tooling notes');

  for (const theme of ['light', 'dark'] as const) {
    await signInAs(page, 'eng-lead', theme);
    for (const size of [LAPTOP, PHONE]) {
      const where = `${theme} ${size.width}`;
      await page.setViewportSize(size);
      await page.goto(`/quotes/${qn}?tab=engineering`);
      // Nothing has changed yet: nothing to save and nothing to say.
      await expect(save).toBeDisabled();
      await expect(status).toHaveCount(0);

      await notes.fill(`Resin from the Midwest hub; freight OK (${where})`);
      await save.click();
      await expect(status).toHaveAttribute('data-state', 'saved');
      await expect(status).toHaveText('Progress saved');
      await expect(status).toHaveAttribute('role', 'status');
      await expect(status).toBeVisible();
      // The toast is kept.
      await expect(page.getByText('Solution saved', { exact: true })).toBeVisible();
      expect(await sideways(page), where).toBeLessThanOrEqual(0);
      expect(await seriousViolations(page), where).toEqual([]);

      if (size === LAPTOP) {
        // Beside the button: to its right, on the same line.
        const button = (await save.boundingBox())!;
        const line = (await status.boundingBox())!;
        expect(line.x, where).toBeGreaterThanOrEqual(button.x + button.width);
        const offLine = Math.abs(line.y + line.height / 2 - (button.y + button.height / 2));
        expect(offLine, where).toBeLessThan(button.height / 2);
      }

      // It stays only until the form changes.
      await notes.fill(`Resin from the Gulf Coast instead (${where})`);
      await expect(status).toHaveCount(0);
      await expect(save).toBeEnabled();
    }
  }

  // A save that fails says so in the same place, with the reason.
  await page.route(`**/api/v1/quotes/${qn}/eng-review`, (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Service Unavailable',
            status: 503,
            detail: 'The service is busy. Try again in a minute.',
          }),
        })
      : route.continue(),
  );
  await save.click();
  await expect(status).toHaveAttribute('data-state', 'failed');
  await expect(status).toHaveText('Not saved: The service is busy. Try again in a minute.');
  await expect(status).toHaveAttribute('role', 'alert');
  expect(await seriousViolations(page)).toEqual([]);

  // Saved again once the service answers.
  await page.unroute(`**/api/v1/quotes/${qn}/eng-review`);
  await save.click();
  await expect(status).toHaveText('Progress saved');
});
