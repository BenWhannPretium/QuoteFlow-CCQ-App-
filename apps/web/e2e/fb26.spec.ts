import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { as, quoteInCustomerDecision } from './customer-decision';
import { signInAs } from './personas';
import { isoDaysFromNow } from './quotes';

// FB-26 (Nov 17 feedback): after the offer. A KAM re-quotes an expired quote as a new, linked quote,
// changes a value and submits it (N17-30); a sales leader sees the quote they qualified under "Expiring
// soon" on the Command Center (N17-31). Checked at 1366 × 768 and 390 px, light and dark, axe clean.
// Synthetic data only (SF_MODE=fake). The validity is put in the past through the approval's actual send
// date (Final Review approves with a proposal date `issuedDaysAgo` days back).

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

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

async function people(request: APIRequestContext) {
  for (const p of ['kam', 'sales-leader', 'eng-lead', 'pricing', 'approver', 'pricing-lead']) {
    await request.get('/api/v1/me', { headers: as(p) });
  }
  const id = async (persona: string) =>
    (
      (await (await request.get('/api/v1/me', { headers: as(persona) })).json()) as {
        user: { id: string };
      }
    ).user.id;
  return { engineerId: await id('engineer'), pricingId: await id('pricing') };
}

test('a KAM re-quotes an expired quote as a new linked quote, changes a value and submits it', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const { engineerId, pricingId } = await people(request);
  // Released 40 days ago: the 30-day validity (seed) ended 10 days ago; still open at Customer Decision.
  const old = await quoteInCustomerDecision(request, engineerId, pricingId, { issuedDaysAgo: 40 });

  await signInAs(page, 'kam');
  await page.goto(`/quotes/${old}`);
  await expect(page.getByTestId('validity-chip')).toHaveAttribute('data-state', 'expired');
  const start = page.getByTestId('start-requote');
  await expect(start).toBeVisible();
  await checkLayouts(page, 'expired quote');

  await start.getByRole('button', { name: 'Start a linked re-quote' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText(`${old} is closed as "No response / Expired" first`);
  await dialog.getByTestId('requote-reason').selectOption({ label: 'Proposal validity lapsed' });
  await dialog.getByTestId('requote-note').fill('The customer said yes after the validity date.');
  await dialog.getByRole('button', { name: 'Start the re-quote' }).click();

  // The new draft: the banner, on the same opportunity, pre-filled; no need-by date copied.
  await expect(page).toHaveURL(/\/intake\/new\?draft=/);
  const notice = page.getByTestId('requote-notice');
  await expect(notice).toContainText(`Re-quote of ${old} (expired`);
  await expect(notice).toContainText(
    'Check every value; Engineering and Pricing will review it again.',
  );
  await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '2');
  await checkLayouts(page, 're-quote draft');

  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '3');
  await expect(page.locator('#intake-quote-needed-by')).toHaveValue('');
  await page.locator('#intake-quote-needed-by').fill(isoDaysFromNow(21));
  // The KAM changes a value: the volume went up.
  const volume = page.locator('input#intake-est-annual-volume');
  await expect(volume).not.toHaveValue('');
  await volume.fill('900000');
  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '4');
  await page.getByRole('button', { name: 'Submit to CCQ' }).click();
  await expect(page.getByTestId('submitted')).toBeVisible();
  await page.getByRole('link', { name: 'Open the quote' }).click();

  // The new quote names the old one; the old one names the new one and is closed Expired.
  await expect(page.getByTestId('requote-of')).toContainText(`Re-quote of ${old}`);
  const newNumber = (await page.locator('h1').first().textContent())?.match(/CCQ-\d{4}-\d{5}/)?.[0];
  expect(newNumber).toBeTruthy();
  expect(newNumber).not.toBe(old);
  await checkLayouts(page, 'new linked quote');

  await page.getByTestId('requote-of').getByRole('link', { name: old }).click();
  await expect(page.getByTestId('requoted-as')).toContainText(`Re-quoted as ${newNumber!}`);
  await expect(page.getByTestId('closure-card')).toContainText('Expired');
  await expect(page.getByTestId('start-requote')).toHaveCount(0);
});

test('a sales leader sees a quote they qualified under "Expiring soon" first, and can open it', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const { engineerId, pricingId } = await people(request);
  // Qualified by the sales leader (G1), released long ago: the soonest validity end of all.
  const qn = await quoteInCustomerDecision(request, engineerId, pricingId, { issuedDaysAgo: 3000 });

  await signInAs(page, 'sales-leader');
  await page.goto('/');
  const block = page.getByTestId('dash-sl-expiring');
  await expect(block).toBeVisible();
  // Soonest first: lapsed proposals lead the list. (A re-run leaves earlier runs' quotes behind, so the
  // check is that this one is listed with its expired chip, and that the list starts with an expired one.)
  await expect(block.getByRole('listitem').first().getByTestId('validity-chip')).toHaveAttribute(
    'data-state',
    'expired',
  );
  const first = block.getByRole('listitem').filter({ hasText: qn });
  await expect(first).toBeVisible();
  await expect(first.getByTestId('validity-chip')).toHaveAttribute('data-state', 'expired');
  await checkLayouts(page, 'command center');

  await first.getByRole('link', { name: qn }).click();
  await expect(page).toHaveURL(new RegExp(`/quotes/${qn}`));
  await expect(page.getByTestId('start-requote')).toBeVisible();
});
