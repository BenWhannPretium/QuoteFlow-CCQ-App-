import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

import { prepareModels } from './models';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// FB-08 (F-021, F-068; T-007, T-031) happy path through the UI:
// the KAM agrees Net 60 on the Commercial panel (non-standard: an exception goes to the pricing lead),
// the pricing lead approves it with a rationale, and the approver confirms the capital terms of a $0 CER
// quote on the Final Review screen and releases the offer. The terms then lock.

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });

async function ok(res: Promise<APIResponse>, status = 200) {
  const r = await res;
  expect(r.status(), await r.text()).toBe(status);
  return r;
}

/** A quote in Final Review, set up through the API. */
async function inFinalReview(request: APIRequestContext, kamPersona = 'kam'): Promise<string> {
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
  const qn = await submitQuote(request, await freeOpportunities(request, 1), {}, kamPersona);
  const post = (path: string, persona: string, data: unknown) =>
    ok(request.post(`/api/v1/quotes/${qn}/${path}`, { headers: as(persona), data }), 201);
  const put = (path: string, persona: string, data: unknown) =>
    ok(request.put(`/api/v1/quotes/${qn}/${path}`, { headers: as(persona), data }));
  await post('gates/G1/decisions', 'sales-leader', { outcomeKey: 'advance' });
  await put('eng-review', 'eng-lead', {
    processType: 'EBM',
    machineType: 'EBM',
    plantCode: 'AURORA',
    cavitation: 8,
    cycleTimeS: 14.5,
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

test('FB-08: non-standard terms are approved by the pricing lead; the approver confirms the capital terms and releases', async ({
  browser,
  request,
}) => {
  test.setTimeout(150_000);
  const qn = await inFinalReview(request);

  // 1. The KAM agrees Net 60: flagged non-standard, and an exception goes to the pricing lead (T-007).
  const kamContext = await browser.newContext();
  const kam = await kamContext.newPage();
  await signInAs(kam, 'kam');
  await kam.goto(`/quotes/${qn}`);
  const panel = kam.getByTestId('commercial-panel');
  await expect(panel).toBeVisible();
  // The KAM pre-fills a capital term (F-068) ...
  await panel.getByLabel('Mold ownership').selectOption({ label: 'Customer' });
  await panel.getByRole('button', { name: 'Save capital terms' }).click();
  await expect(panel.getByRole('button', { name: 'Save capital terms' })).toBeDisabled();
  // ... and agrees Net 60.
  await panel.getByLabel('Payment terms', { exact: true }).selectOption({ label: 'Net 60' });
  await expect(panel.getByTestId('payment-terms-nonstandard').first()).toBeVisible();
  await panel.getByRole('button', { name: 'Save terms' }).click();
  await expect(panel.getByTestId('terms-exception-status')).toHaveText(
    'Waiting for the pricing lead',
  );
  await kamContext.close();

  // 2. The pricing lead approves it with a rationale.
  const leadContext = await browser.newContext();
  const lead = await leadContext.newPage();
  await signInAs(lead, 'pricing-lead');
  await lead.goto(`/quotes/${qn}`);
  const exception = lead.getByTestId('terms-exception');
  await expect(exception).toBeVisible();
  await exception
    .getByLabel('Rationale (required)')
    .fill('Strategic account; financing cost priced in.');
  await exception.getByTestId('approve-terms-exception').click();
  await expect(exception.getByTestId('terms-exception-status')).toHaveText('Approved');
  await expect(exception.getByTestId('terms-exception-rationale')).toContainText(
    'Strategic account',
  );
  await leadContext.close();

  // 3. The approver confirms the capital terms of a $0 CER quote and releases the offer (T-031).
  const approverContext = await browser.newContext();
  const page = await approverContext.newPage();
  await signInAs(page, 'approver');
  await page.goto(`/quotes/${qn}/review`);
  const terms = page.getByTestId('review-terms-legal');
  await expect(terms.getByTestId('terms-exception-status')).toHaveText('Approved');
  const capital = terms.getByTestId('capital-terms');
  await expect(capital.getByLabel('Mold ownership')).toHaveValue('CUSTOMER');
  await capital
    .getByLabel('Funding model')
    .selectOption({ label: '$0 CER (customer-reimbursed capital)' });
  await capital.getByLabel('Amortized', { exact: true }).selectOption('no');
  await capital.getByLabel('Agreement in place').selectOption('yes');
  await capital.getByLabel('Agreement duration (months)').fill('60');
  await capital
    .getByLabel('Minimum supply / shortfall terms')
    .fill('Shortfall below 80% of forecast is invoiced');
  await capital.getByTestId('confirm-capital-terms').click();
  await expect(terms.getByTestId('capital-terms-confirmed')).toContainText('Confirmed by');

  await page
    .getByTestId('decision-bar')
    .getByRole('button', { name: 'Advance (release the offer)', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Record decision' }).click();
  await expect(page).toHaveURL(/\/approvals/);
  await approverContext.close();

  // 4. Locked after G4 Approve.
  const locked = await request.put(`/api/v1/quotes/${qn}/terms`, {
    headers: as('kam'),
    data: { termsMinSupply: 'changed' },
  });
  expect(locked.status()).toBe(409);
  const quote = (await (
    await request.get(`/api/v1/quotes/${qn}`, { headers: as('approver') })
  ).json()) as {
    stageKey: string;
    commercial: { terms: { capital: { toolingFundingModel: string; finalizedAt: string } } };
  };
  expect(quote.stageKey).toBe('CUSTOMER_DECISION');
  expect(quote.commercial.terms.capital).toMatchObject({ toolingFundingModel: 'ZERO_CER' });
});

// DR-approver-leadership-admin-01: an approver who is the quote's KAM (multi-role: SalesLeader + Approver)
// cannot edit or confirm its capital terms; the screen says why, and the API refuses (403).
test('the KAM of the quote cannot confirm its capital terms, even as an approver', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const qn = await inFinalReview(request, 'multi-role');
  await signInAs(page, 'multi-role');
  await page.goto(`/quotes/${qn}/review`);
  const terms = page.getByTestId('review-terms-legal');
  await expect(terms.getByTestId('capital-terms-blocked')).toContainText('where you are the KAM');
  await expect(terms.getByTestId('confirm-capital-terms')).toHaveCount(0);
  const refused = await request.put(`/api/v1/quotes/${qn}/terms/capital`, {
    headers: as('multi-role'),
    data: { finalized: true },
  });
  expect(refused.status()).toBe(403);
});
