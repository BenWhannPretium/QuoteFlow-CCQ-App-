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
