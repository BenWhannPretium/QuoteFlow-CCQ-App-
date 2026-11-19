import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test';

import { seriousViolations } from './axe';
import { prepareModels } from './models';
import { signInAs } from './personas';
import {
  DEV_USER_HEADER,
  freeOpportunities,
  isoDaysFromNow,
  pickOpportunity,
  submitQuote,
} from './quotes';

// FB-31 (Nov 19 feedback): commercial terms governance.
// - N19-07: a KAM picks Net 60 and is told Leadership must approve it and a document is needed (the
//   provisional terms_exception_routes); Leadership opens the notice, sees the document and approves.
// - N19-08: "Customer funded (amortized)" says it needs a finance review; Final Review lists the sign-off.
// - N19-10: the stock question in the contract's words (inventory and safety stock requirements).
// Checked at 1366 × 768 and 390 px, light and dark, axe clean. Synthetic data only (SF_MODE=fake).

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]);

async function ok(res: Promise<APIResponse>, status = 200) {
  const r = await res;
  expect(r.status(), await r.text()).toBe(status);
  return r;
}

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

/** A quote past G1 (in Engineering Review), set up through the API. */
async function inEngineering(request: APIRequestContext, over: Record<string, unknown> = {}) {
  const qn = await submitQuote(request, await freeOpportunities(request, 1), over);
  await ok(
    request.post(`/api/v1/quotes/${qn}/gates/G1/decisions`, {
      headers: as('sales-leader'),
      data: { outcomeKey: 'advance' },
    }),
    201,
  );
  return qn;
}

/** A quote in Final Review, set up through the API (as fb08.spec.ts). */
async function inFinalReview(request: APIRequestContext, over: Record<string, unknown> = {}) {
  const id = async (persona: string) =>
    (
      (await (await request.get('/api/v1/me', { headers: as(persona) })).json()) as {
        user: { id: string };
      }
    ).user.id;
  const engineerId = await id('engineer');
  const pricingId = await id('pricing');
  await id('approver');
  await id('pricing-lead');
  const qn = await inEngineering(request, over);
  const post = (path: string, persona: string, data: unknown) =>
    ok(request.post(`/api/v1/quotes/${qn}/${path}`, { headers: as(persona), data }), 201);
  const put = (path: string, persona: string, data: unknown) =>
    ok(request.put(`/api/v1/quotes/${qn}/${path}`, { headers: as(persona), data }));
  await put('eng-review', 'eng-lead', {
    processType: 'EBM',
    machineType: 'EBM',
    plantCode: 'AURORA',
    cavitation: 8,
    cycleTimeS: 14.5,
    prelimCapitalUsd: 0,
  });
  await put('capacity-evidence', 'eng-lead', {
    rows: [
      {
        site: 'AURORA',
        assumedEffectivenessPct: 70,
        cycleTimeS: 14.5,
        utilizationBeforePct: 62,
        analysisDate: '2026-10-26',
        analystId: engineerId,
      },
    ],
  });
  await put('capacity-signoff', 'eng-lead', { status: 'approved' });
  await post('gates/G2/decisions', 'eng-lead', { outcomeKey: 'proceed' });
  await prepareModels(request, qn);
  await put('pricing-record', 'pricing', {
    approvedBy: pricingId,
    pricingBasisNote: 'March CDI',
    costingCompleted: true,
  });
  await put('capital-readiness', 'pricing', { capitalReadiness: 'pre_approved' });
  await post('gates/G3/decisions', 'pricing-lead', { outcomeKey: 'submit' });
  return qn;
}

test('intake: Net 60 says who approves and that a document is needed; amortized needs a finance review; the stock question in the contract’s words', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await signInAs(page, 'kam');
  await page.goto('/intake/new');
  await pickOpportunity(page, request, 'Jar');
  for (const part of ['city', 'state']) {
    const input = page.locator(`#intake-ship-to-${part}`);
    if ((await input.isVisible()) && !(await input.inputValue())) {
      await input.fill(part === 'city' ? 'St. Louis' : 'MO');
    }
  }
  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '3');
  await page.locator('#intake-quote-needed-by').fill(isoDaysFromNow(30));

  await page.locator('#intake-requested-payment-terms').selectOption({ label: 'Net 45' });
  await expect(page.getByTestId('payment-terms-nonstandard')).toHaveText(
    'Non-standard: needs approval by the pricing lead',
  );
  await page.locator('#intake-requested-payment-terms').selectOption({ label: 'Net 60' });
  const notice = page.getByTestId('payment-terms-nonstandard');
  await expect(notice).toContainText('Non-standard: needs approval by Leadership');
  await expect(notice.getByTestId('payment-terms-document-required')).toHaveText(
    'A written rationale and a supporting document (Payment-terms approval) are needed.',
  );

  // N19-08: four plain choices; amortized says it needs a finance review.
  const funding = page.locator('#intake-tooling-funding-model');
  await expect(funding.locator('option:checked')).toHaveText('To be determined');
  await expect(funding.locator('option', { hasText: '$0 CER' })).toHaveCount(0);
  await expect(funding.locator('option', { hasText: 'Shared' })).toHaveCount(0);
  await funding.selectOption({ label: 'Customer funded (amortized)' });
  await expect(page.getByTestId('funding-finance-review')).toHaveText(
    'Needs a finance review: an extra sign-off at Final Review before the offer goes out.',
  );
  await funding.selectOption({ label: 'Customer funded (lump sum)' });
  await expect(page.getByTestId('funding-finance-review')).toHaveCount(0);

  // N19-10: the stock question in the contract's words.
  const stock = page.getByTestId('answer-stock_hold_requested');
  await expect(stock).toContainText(
    'Does the customer have inventory or safety stock requirements?',
  );
  await stock.getByLabel('Yes').check();
  await expect(page.locator('#intake-stock-hold-note')).toHaveAttribute(
    'placeholder',
    'e.g. a minimum inventory, or two months of safety stock at the plant',
  );
  await checkLayouts(page, 'intake step 3');
});

test('Net 60: the KAM attaches the document; Leadership opens the notice and approves', async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const qn = await inEngineering(request);

  // 1. The KAM agrees Net 60 on the Commercial terms tab.
  const kamContext = await browser.newContext();
  const kam = await kamContext.newPage();
  await signInAs(kam, 'kam');
  await kam.goto(`/quotes/${qn}?tab=commercial`);
  const panel = kam.getByTestId('commercial-panel');
  await panel.getByLabel('Payment terms', { exact: true }).selectOption({ label: 'Net 60' });
  await expect(panel.getByTestId('payment-terms-nonstandard').first()).toHaveText(
    'Non-standard: needs approval by Leadership',
  );
  await expect(panel.getByTestId('payment-terms-document-required')).toBeVisible();
  await panel.getByRole('button', { name: 'Save terms' }).click();
  const exception = panel.getByTestId('terms-exception');
  await expect(exception.getByTestId('terms-exception-status')).toHaveText(
    'Waiting for Leadership',
  );
  await expect(exception.getByTestId('terms-exception-document')).toContainText(
    'No document attached yet.',
  );
  // The KAM attaches the formal documentation.
  await exception.getByTestId('upload-payment_terms_approval').setInputFiles({
    name: 'cfo-approval.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await expect(exception.getByTestId('terms-exception-document-file')).toContainText(
    'cfo-approval.pdf',
  );
  await checkLayouts(kam, 'KAM Commercial terms');
  await kamContext.close();

  // 2. Leadership opens the notice: it goes to the quote's Commercial terms tab.
  const leadContext = await browser.newContext();
  const lead = await leadContext.newPage();
  await signInAs(lead, 'leadership');
  await lead.goto('/');
  await lead.getByTestId('notification-bell').click();
  await lead
    .getByTestId('notification-list')
    .getByRole('link', { name: new RegExp(`${qn}.*non-standard payment terms`) })
    .first()
    .click();
  await expect(lead).toHaveURL(new RegExp(`/quotes/${qn}\\?tab=commercial`));
  const card = lead.getByTestId('terms-exception');
  await expect(card.getByTestId('terms-exception-document-file')).toContainText('cfo-approval.pdf');
  await card
    .getByLabel('Rationale (required)')
    .fill('Strategic account; the CFO memo is attached.');
  await card.getByTestId('approve-terms-exception').click();
  await expect(card.getByTestId('terms-exception-status')).toHaveText('Approved');
  await checkLayouts(lead, 'Leadership decision');
  await leadContext.close();

  // The pricing lead could not have decided it.
  const refused = await request.post(`/api/v1/quotes/${qn}/terms/exception/decision`, {
    headers: as('pricing-lead'),
    data: { decision: 'reject', rationale: 'x' },
  });
  expect(refused.status()).toBe(409);
});

test('Final Review: the stock answer in the contract’s words, and amortized waits for the finance review', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const qn = await inFinalReview(request, {
    stockHoldRequested: true,
    stockHoldWeeks: 8,
    stockHoldNote: 'Two months of safety stock at the plant',
  });
  await ok(
    request.put(`/api/v1/quotes/${qn}/terms/engineering`, {
      headers: as('eng-lead'),
      data: { toolingFundingModel: 'AMORTIZED' },
    }),
  );
  await signInAs(page, 'approver');
  await page.goto(`/quotes/${qn}/review`);
  await expect(page.getByText('Inventory or safety stock requirements').first()).toBeVisible();
  await expect(page.getByTestId('fact-stock-hold').first()).toHaveText('Yes, for 8 weeks');
  await expect(
    page.getByText('Final Review also needs: Finance review (Leadership)').first(),
  ).toBeVisible();
  await checkLayouts(page, 'Final Review');
});
