import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, isoDaysFromNow, submitQuote } from './quotes';

// The Command Center and queue proposals approved on 2026-11-17 (docs/audit/03-ux-proposals.md). The e2e
// database is config-seeded only: each test makes the quotes it needs through the API.

/**
 * Saves the proposal's screenshot (the part of the page that changed) to docs/audit/screens when
 * AUDIT_SCREENS=1. Off in normal runs.
 */
async function auditScreen(target: Page | Locator, id: string) {
  if (process.env.AUDIT_SCREENS !== '1') return;
  await target.screenshot({
    path: fileURLToPath(new URL(`../../../docs/audit/screens/${id}.png`, import.meta.url)),
    animations: 'disabled',
  });
}

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });

/** One API call as a persona; fails the test with the response body unless the status is `expected`. */
async function call<T = unknown>(
  request: APIRequestContext,
  persona: string,
  method: 'get' | 'post' | 'put' | 'patch',
  path: string,
  data?: object,
  expected: number[] = [200, 201],
): Promise<T> {
  const res = await request[method](`/api/v1/${path}`, {
    headers: as(persona),
    ...(data ? { data } : {}),
  });
  expect(expected, `${method} ${path}: ${await res.text()}`).toContain(res.status());
  return (await res.json()) as T;
}

const userId = async (request: APIRequestContext, persona: string) =>
  (await call<{ user: { id: string } }>(request, persona, 'get', 'me')).user.id;

test.describe('UX-005: the stage lists say who a quote is for', () => {
  test('a KAM sees the customer beside each quote number, and the opportunity on a wide screen', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const [opportunityId] = await freeOpportunities(request, 1);
    const detail = await request.get(`/api/v1/salesforce/opportunities/${opportunityId}`, {
      headers: as('kam'),
    });
    const sf = (await detail.json()) as {
      opportunity: { name: string; accountName: string };
      account: { name: string } | null;
    };
    const customer = sf.account?.name ?? sf.opportunity.accountName;
    const quoteNumber = await submitQuote(request, [opportunityId!]);
    // Put it on hold: a quote on hold heads its stage, so it is among the few the board lists however
    // many quotes the KAM already has.
    const leader = (await (
      await request.get('/api/v1/me', { headers: as('sales-leader') })
    ).json()) as {
      user: { id: string };
    };
    const hold = await request.post(`/api/v1/quotes/${quoteNumber}/gates/G1/decisions`, {
      headers: as('sales-leader'),
      data: {
        outcomeKey: 'hold',
        reasonCode: 'awaiting_customer_info',
        note: 'e2e: UX-005',
        holdUntil: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
        holdOwnerId: leader.user.id,
      },
    });
    expect(hold.status(), await hold.text()).toBe(201);

    await signInAs(page, 'kam');
    await page.goto('/');
    const board = page.getByTestId('dash-my-pipeline').getByTestId('mini-board');
    const row = board.locator(`li[data-quote="${quoteNumber}"]`);
    await expect(row.getByRole('link', { name: quoteNumber })).toBeVisible();
    await expect(row.getByTestId('stage-quote-customer')).toHaveText(customer);
    await expect(row.getByTestId('stage-quote-opportunity')).toHaveText(sf.opportunity.name);
    // Every listed quote names its customer, not only this one.
    const rows = board.locator('li[data-quote]');
    await expect(rows.getByTestId('stage-quote-customer')).toHaveCount(await rows.count());
    await auditScreen(page.getByTestId('dash-my-pipeline'), 'UX-005');

    // On a phone the customer stays, cut to one line with the full name on hover (title) and on focus;
    // the opportunity is left out, and nothing scrolls sideways.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(row.getByTestId('stage-quote-customer')).toBeVisible();
    await expect(row.getByTestId('stage-quote-customer')).toHaveAttribute('title', customer);
    await expect(row.getByTestId('stage-quote-opportunity')).toBeHidden();
    await row.getByRole('link', { name: quoteNumber }).focus();
    await expect(row.getByTestId('stage-quote-customer')).toHaveCSS('white-space', 'normal');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});

/** A complete intake item (FB-19), as the wizard would save it. */
const intakeItem = (label: string, containerSize: string) => ({
  key: randomUUID(),
  label,
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
  productNeededBy: isoDaysFromNow(120),
  containerSize,
  drawingStatus: 'HAVE_DRAWING',
});

test.describe('UX-007: the timeline names the item a rework removed', () => {
  test('"Item 2 (24 oz bottle) removed", and that its engineering work was discarded', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1), {
      items: [intakeItem('16 oz bottle', '16 oz'), intakeItem('24 oz bottle', '24 oz')],
    });
    const quote = (path = '') => `quotes/${quoteNumber}${path}`;
    await call(request, 'sales-leader', 'post', quote('/gates/G1/decisions'), {
      outcomeKey: 'advance',
    });
    await call(request, 'eng-lead', 'post', quote('/assignment'), {
      engineerId: await userId(request, 'engineer'),
    });
    await call(request, 'engineer', 'post', quote('/eng-review/accept'));
    // Engineering works item 2, then sends the quote back to the KAM.
    const { items } = await call<{ items: { id: string; itemNo: number }[] }>(
      request,
      'engineer',
      'get',
      quote(),
    );
    await call(request, 'engineer', 'put', quote('/eng-review'), {
      itemId: items.find((i) => i.itemNo === 2)!.id,
      processType: 'EBM',
      cavitation: 4,
    });
    await call(request, 'eng-lead', 'post', quote('/gates/G2/decisions'), {
      outcomeKey: 'rework',
      reasonCode: 'missing_information',
      note: 'e2e: drop the 24 oz',
    });
    // The KAM removes item 2 in the rework and resubmits.
    const draft = await call<{ id: string; data: { items: object[] } }>(
      request,
      'kam',
      'post',
      quote('/rework'),
    );
    await call(request, 'kam', 'patch', `quotes/drafts/${draft.id}`, {
      data: { items: [draft.data.items[0]] },
    });
    await call(request, 'kam', 'post', `quotes/drafts/${draft.id}/submit`);

    await signInAs(page, 'kam');
    await page.goto(`/quotes/${quoteNumber}`);
    const timeline = page.getByTestId('quote-timeline');
    const entry = timeline
      .getByTestId('timeline-item')
      .filter({ hasText: 'Item 2 (24 oz bottle) removed' });
    await expect(entry).toBeVisible();
    await expect(entry).toContainText('Its engineering work was discarded.');
    await expect(timeline.getByText('Quote item removed')).toHaveCount(0);
    await entry.scrollIntoViewIfNeeded();
    await auditScreen(entry, 'UX-007');
  });
});

/** A quote the sales leader has qualified: it sits in the engineering queue. */
async function quoteInEngineering(request: APIRequestContext): Promise<string> {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  await call(request, 'sales-leader', 'post', `quotes/${quoteNumber}/gates/G1/decisions`, {
    outcomeKey: 'advance',
  });
  return quoteNumber;
}

test.describe('UX-008: "Start review" has one name', () => {
  test('the queue toast and the timeline both say the review started', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const quoteNumber = await quoteInEngineering(request);
    await call(request, 'eng-lead', 'post', `quotes/${quoteNumber}/assignment`, {
      engineerId: await userId(request, 'engineer'),
    });

    await signInAs(page, 'eng-lead');
    await page.goto('/queue/engineering');
    await page.getByRole('button', { name: `Actions for ${quoteNumber}` }).click();
    await page.getByRole('menuitem', { name: 'Start review' }).click();
    const toast = page.getByRole('status').filter({ hasText: `${quoteNumber}: review started` });
    await expect(toast).toBeVisible();
    await expect(page.getByText(`${quoteNumber} accepted`)).toHaveCount(0);
    await auditScreen(toast, 'UX-008');

    await page.goto(`/quotes/${quoteNumber}`);
    const timeline = page.getByTestId('quote-timeline');
    await expect(timeline.getByText('Engineering review started')).toBeVisible();
    await expect(timeline.getByText('Engineering review accepted')).toHaveCount(0);
  });
});

test.describe('UX-009: the pricing queue says who approves the price', () => {
  for (const persona of ['pricing', 'pricing-lead']) {
    test(`${persona}: pricers submit to the pricing lead, not to Final Review`, async ({
      page,
    }) => {
      await signInAs(page, persona);
      await page.goto('/queue/pricing');
      const queue = page.getByTestId('pricing-queue');
      await expect(queue.getByRole('heading', { level: 1, name: 'Pricing queue' })).toBeVisible();
      await expect(queue).toContainText(
        'Record the price approval and capital readiness, then submit to the pricing lead, who approves the price.',
      );
      await expect(queue).not.toContainText('submit to Final Review');
      if (persona === 'pricing') await auditScreen(queue.locator('header').first(), 'UX-009');
    });
  }
});

test.describe('UX-011: the intake draft list uses the one clock', () => {
  // A browser outside US Central: the time used to follow the browser's zone and format.
  test.use({ timezoneId: 'Europe/Berlin', locale: 'de-DE' });

  test('"saved" is shown in US Central with the zone named', async ({ page, request }) => {
    const draft = await call<{ id: string }>(request, 'kam', 'post', 'quotes/drafts', {
      data: { description: 'e2e: UX-011' },
    });
    try {
      await signInAs(page, 'kam');
      await page.goto('/intake/new');
      const drafts = page.getByRole('list', { name: 'Your drafts' });
      await expect(drafts.getByRole('listitem').first()).toContainText(
        /Step \d · saved [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M C[SD]T/,
      );
      // No draft in the list shows a time without the zone (the browser-local format).
      for (const text of await drafts.getByRole('listitem').allInnerTexts()) {
        expect(text).toMatch(/saved .+ C[SD]T/);
      }
      await auditScreen(drafts, 'UX-011-intake');
    } finally {
      await request.delete(`/api/v1/quotes/drafts/${draft.id}`, { headers: as('kam') });
    }
  });
});

/**
 * Serves the role's real dashboard with a few numbers replaced, for wording that depends on data the
 * config-seeded e2e database does not have (a stage total, proposals past their validity date).
 */
async function withDashboardNumbers(
  page: Page,
  role: string,
  edit: (body: {
    pipeline: { stages: { sfAmount: number }[] };
    capture?: { rates: Record<string, unknown> };
  }) => void,
) {
  await page.route(`**/api/v1/dashboards/${role}`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Parameters<typeof edit>[0];
    edit(body);
    await route.fulfill({ response, json: body });
  });
}

test.describe('UX-013: plain words on the Command Center and the intake', () => {
  test('a KAM reads Salesforce spelled out, "past validity with no outcome recorded" and the gate by its name', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    // A quote the sales leader sent back for rework.
    const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
    await call(request, 'sales-leader', 'post', `quotes/${quoteNumber}/gates/G1/decisions`, {
      outcomeKey: 'rework',
      reasonCode: 'missing_information',
      note: 'e2e: UX-013',
    });
    const config = await call<{ gates: { key: string; label: string }[] }>(
      request,
      'kam',
      'get',
      'config/public',
    );
    const gate = config.gates.find((g) => g.key === 'G1')!.label;
    expect(gate).not.toMatch(/^G\d$/);

    await withDashboardNumbers(page, 'KAM', (body) => {
      body.pipeline.stages[0]!.sfAmount = 459_100;
      Object.assign(body.capture!.rates, { recorded: 13, goneDark: 5, awaiting: 0 });
    });
    await signInAs(page, 'kam');
    await page.goto('/');

    const board = page.getByTestId('dash-my-pipeline');
    await expect(board.getByTestId('stage-amount').first()).toHaveText(
      '$459.1K Salesforce opportunity amount',
    );
    await expect(board).not.toContainText('SF amount');

    const capture = page.getByTestId('dash-capture');
    await expect(capture).toContainText(
      '13 recorded, 5 past validity with no outcome recorded, 0 still waiting.',
    );
    await expect(capture).not.toContainText('gone dark');

    const returned = page
      .getByTestId('dash-returned')
      .getByRole('listitem')
      .filter({ hasText: quoteNumber });
    await expect(returned.getByTestId('returned-why')).toHaveText(
      `Missing information · returned at ${gate}`,
    );
    await expect(returned).not.toContainText('G1');
    await auditScreen(page.getByRole('region', { name: 'Dashboard' }), 'UX-013-command-center');

    // The intake start screen lists the same quote, with the gate by its name there too.
    await page.goto('/intake/new');
    const listed = page
      .getByTestId('returned')
      .getByRole('listitem')
      .filter({ hasText: quoteNumber });
    await expect(listed).toContainText(`Returned at ${gate}: Missing information · e2e: UX-013`);
    await expect(listed).not.toContainText('G1');
  });

  test('a sales leader reads Salesforce spelled out on the team pipeline', async ({ page }) => {
    await withDashboardNumbers(page, 'SalesLeader', (body) => {
      body.pipeline.stages[0]!.sfAmount = 1_250_000;
    });
    await signInAs(page, 'sales-leader');
    await page.goto('/');
    const board = page.getByTestId('dash-team-pipeline');
    await expect(board.getByTestId('stage-amount').first()).toContainText(
      'Salesforce opportunity amount',
    );
    await expect(board).not.toContainText('SF amount');
  });
});

test.describe('UX-016: a way back in from "No QuoteFlow access yet"', () => {
  test('Check again asks again, says so when nothing changed, and lets the person in once they have a role', async ({
    page,
  }) => {
    // Every dev persona has a role, so the page cannot be reached with one. The first two answers from
    // /me are the API's own no-role problem, served here; the third goes to the real API.
    let asked = 0;
    await page.route('**/api/v1/me', async (route) => {
      asked += 1;
      if (asked > 2) return route.continue();
      await route.fulfill({
        status: 403,
        contentType: 'application/problem+json',
        json: {
          type: 'about:blank',
          title: 'Forbidden',
          status: 403,
          detail: 'No QuoteFlow role assigned; ask IT to add you to an SG-CCQ group',
          code: 'no_role',
        },
      });
    });
    await signInAs(page, 'kam');
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'No QuoteFlow access yet' }),
    ).toBeVisible();
    await expect(
      page.getByText('If IT has just added you to a group, press Check again.'),
    ).toBeVisible();
    await expect(page.getByTestId('recheck')).toBeEmpty();

    // Still no role: the page stays and says it looked.
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByTestId('recheck')).toHaveText(
      'Still no access. If you were added a moment ago, wait a few minutes and check again.',
    );
    expect(asked).toBe(2);
    await auditScreen(page.locator('main'), 'UX-016');

    // IT has added the group: the next check lets the person in.
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByTestId('landing')).toHaveAttribute('data-role', 'KAM');
    expect(asked).toBe(3);
  });
});
