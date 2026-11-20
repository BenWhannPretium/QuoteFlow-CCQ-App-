import { expect, test, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { freeOpportunities, pickOpportunity, submitQuote } from './quotes';

// FB-33 (Nov 19 feedback: words on screen). N19-20: Commercial Capital Quote is spelled out where a KAM is
// told what it is. N19-21: Stock and stock-plus are handled in Salesforce. N19-13 (the example only): the
// variants example no longer suggests a site choice. Checked at 1366 × 768, 390 and 320 px wide, light and
// dark, axe clean, no sideways scroll. Synthetic data only (SF_MODE=fake).

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function checkLayouts(page: Page, where: string) {
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const size of [
      { width: 320, height: 800 },
      { width: 390, height: 844 },
      { width: 1366, height: 768 },
    ]) {
      await page.setViewportSize(size);
      expect(await noSideScroll(page), `${where} ${theme} ${size.width}`).toBe(true);
    }
    expect(await seriousViolations(page), `${where} ${theme}`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: null });
  await page.setViewportSize({ width: 1366, height: 768 });
}

const LONG_NAME = 'Commercial Capital Quote (CCQ)';

test.describe('FB-33 words on screen', () => {
  test('the opportunity search says Commercial Capital Quote when nothing is found', async ({
    page,
  }) => {
    await signInAs(page, 'kam');
    await page.goto('/intake/new');
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByLabel('Find the Salesforce opportunity').fill('zzzz no such opportunity');
    const empty = page.getByText('Create the opportunity in Salesforce first');
    await expect(empty).toBeVisible();
    await expect(
      page.getByText(`Every ${LONG_NAME} starts from a Salesforce opportunity`),
    ).toBeVisible();
    await checkLayouts(page, 'opportunity search');
  });

  test('the request class is spelled out, Stock says Salesforce, the variants example is about the product', async ({
    page,
    request,
  }) => {
    await signInAs(page, 'kam');
    await page.goto('/intake/new');
    await pickOpportunity(page, request, 'Closure');
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '3');

    // N19-20: the label spells the name out; the button keeps the short name (the label beside it says it).
    const requestClass = page.locator('#intake-request-class');
    await expect(
      requestClass.locator('option', {
        hasText: `${LONG_NAME}: new business that needs engineering or capital`,
      }),
    ).toHaveCount(1);
    await expect(requestClass.locator('option', { hasText: 'CCQ (new business' })).toHaveCount(0);
    await expect(page.locator('#intake-request-class-help')).toContainText(
      `${LONG_NAME} is new business that needs engineering or capital.`,
    );
    await expect(page.locator('#intake-request-class-help')).toContainText(
      'Stock and stock-plus are handled in Salesforce.',
    );

    // N19-13 (the example only): nothing about choosing a site.
    const placeholder = await page
      .locator('#intake-quote-variants-note')
      .getAttribute('placeholder');
    expect(placeholder).toBe('e.g. price at 0, 25 and 50% PCR');
    expect(placeholder).not.toMatch(/site/i);
    await expect(page.locator('#intake-quote-variants-note-help')).not.toContainText(/site/i);
    await checkLayouts(page, 'request class');

    // N19-21: a Stock request names Salesforce; the price-inquiry half still names the pricing application.
    await requestClass.selectOption({ label: 'Stock / stock-plus' });
    const redirect = page.getByTestId('request-class-redirect');
    await expect(redirect).toContainText(
      'Stock and stock-plus requests are handled in Salesforce.',
    );
    await expect(redirect).toContainText(
      'Price inquiries and pack-out evaluations stay in the pricing application for now.',
    );
    await expect(redirect).not.toContainText('Submit them there');
    await checkLayouts(page, 'stock redirect');

    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByRole('button', { name: 'Submit to CCQ' })).toBeDisabled();
    await page.getByRole('button', { name: 'Discard draft' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard draft' }).click();
  });
  test('the longer request class label fits the quote page and the To qualify card', async ({
    page,
    request,
  }) => {
    const quote = await submitQuote(request, await freeOpportunities(request, 1));

    await signInAs(page, 'sales-leader');
    await page.goto('/approvals?gate=G1');
    const card = page.locator(`[data-testid="queue-item"][data-quote="${quote}"]`);
    await expect(card.getByTestId('request-class')).toContainText(LONG_NAME);
    await checkLayouts(page, 'To qualify card');

    await page.goto(`/quotes/${quote}`);
    await page.getByRole('tab', { name: 'Overview' }).click();
    await expect(
      page.getByText(`${LONG_NAME}: new business that needs engineering or capital`).first(),
    ).toBeVisible();
    await checkLayouts(page, 'quote page');
  });
});
