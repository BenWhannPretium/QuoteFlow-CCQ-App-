import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

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
