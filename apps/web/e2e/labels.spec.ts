import { expect, test } from '@playwright/test';

import { signInAs } from './personas';
import { freeOpportunities, submitQuote } from './quotes';

// B-21 / B-23 follow-ups: dashboard figures say they are operational, and the quote page shows the
// Salesforce opportunity id testers tie out against (U5).
test('the home dashboard says its figures are operational, not D&A-certified', async ({ page }) => {
  await signInAs(page, 'kam');
  await page.goto('/');
  await expect(page.getByTestId('dashboard-disclaimer')).toHaveText(
    'Operational metrics from QuoteFlow; not yet D&A-certified.',
  );
});

test('the quote page shows the Salesforce opportunity id', async ({ page, request }) => {
  const candidates = await freeOpportunities(request, 1);
  const quoteNumber = await submitQuote(request, candidates);
  await signInAs(page, 'kam');
  await page.goto(`/quotes/${quoteNumber}`);
  await expect(page.getByTestId('sf-opportunity-id')).toHaveText(/^006\w{12,15}$/);
});
