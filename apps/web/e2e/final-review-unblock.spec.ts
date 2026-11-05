import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// FB-01 T-026 (F-069, seen in the Nov 3 demo): on a 390 px phone, an Approver releases an offer whose
// terms nobody has checked and whose Legal review (triggered by a tooling commitment) is not recorded.
// With `g4_required_checks` at its seeded [] neither blocks: the review screen shows the terms and
// Legal read-only, both as warnings with a link to the Commercial panel, and the decision records
// that the approver saw them. Runs in the `mobile` project (390 × 844, touch).

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });

async function ok(res: Promise<APIResponse>, status = 200) {
  const r = await res;
  expect(r.status(), await r.text()).toBe(status);
  return r;
}

/** In Final Review with a tooling commitment (a Legal trigger) and the terms not checked. */
async function uncheckedInFinalReview(request: APIRequestContext): Promise<string> {
  const id = async (persona: string) =>
    (
      (await (await request.get('/api/v1/me', { headers: as(persona) })).json()) as {
        user: { id: string };
      }
    ).user.id;
  const engineerId = await id('engineer');
  const pricingId = await id('pricing');
  await id('approver');
  const qn = await submitQuote(request, await freeOpportunities(request, 1));
  const post = (path: string, persona: string, data: unknown) =>
    ok(request.post(`/api/v1/quotes/${qn}/${path}`, { headers: as(persona), data }), 201);
  const put = (path: string, persona: string, data: unknown) =>
    ok(request.put(`/api/v1/quotes/${qn}/${path}`, { headers: as(persona), data }));
  await post('gates/G1/decisions', 'sales-leader', { outcomeKey: 'advance' });
  await put('eng-review', 'eng-lead', {
    processType: 'EBM',
    machineType: 'EBM_SHUTTLE',
    plantCode: 'PLANT_01',
    cavitation: 8,
    cycleTimeS: 14.5,
  });
  await put('capacity-evidence', 'eng-lead', {
    rows: [
      {
        site: 'PLANT_01',
        assumedEffectivenessPct: 70,
        cycleTimeS: 14.5,
        utilizationPct: 62,
        analysisDate: '2026-10-26',
        analystId: engineerId,
      },
    ],
  });
  await put('capacity-signoff', 'eng-lead', { status: 'approved' });
  await post('gates/G2/decisions', 'eng-lead', { outcomeKey: 'proceed' });
  await put('pricing-record', 'pricing', {
    approvedBy: pricingId,
    pricingBasisNote: 'March CDI',
    costingCompleted: true,
  });
  await put('capital-readiness', 'pricing', { capitalReadiness: 'pre_approved' });
  await post('gates/G3/decisions', 'pricing-lead', { outcomeKey: 'submit' });
  // The KAM enters terms but nobody checks them; the tooling commitment triggers Legal.
  await put('terms', 'kam', { termsToolingCommitment: true, termsPaymentTerms: 'Net 30' });
  return qn;
}

test('T-026: the approver releases the offer with open terms and Legal checks (phone)', async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const qn = await uncheckedInFinalReview(request);

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await signInAs(page, 'approver');
  await page.goto(`/quotes/${qn}/review`);
  await expect(page.getByTestId('review-screen')).toBeVisible();

  // The open checks are warnings (not blockers), each with a link to the Commercial panel.
  const warnings = page.getByTestId('review-warnings');
  for (const code of ['TERMS_NOT_CHECKED', 'LEGAL_REVIEW_NOT_RECORDED']) {
    const item = warnings.locator(`li[data-code="${code}"]`);
    await expect(item).toBeVisible();
    await expect(item.getByRole('link', { name: 'Open the Commercial panel' })).toHaveAttribute(
      'href',
      `/quotes/${qn}#commercial`,
    );
  }
  // Terms and Legal, read-only.
  const terms = page.getByTestId('review-terms-legal');
  await expect(terms).toContainText('Net 30');
  await expect(terms).toContainText('Not checked');
  await expect(terms.getByTestId('review-legal')).toContainText('Legal review (optional)');
  await expect(terms.getByTestId('review-legal')).toContainText('Tooling commitment');
  await expect(terms.getByRole('textbox')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  expect(await seriousViolations(page)).toEqual([]);

  // Approve: nothing owned by another role blocks it.
  const bar = page.getByTestId('decision-bar');
  await bar.getByRole('button', { name: 'Advance (release the offer)', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Required for exception decisions')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Record decision' }).click();
  await expect(page).toHaveURL(/\/approvals/);

  const quote = (await (
    await request.get(`/api/v1/quotes/${qn}`, { headers: as('approver') })
  ).json()) as {
    stageKey: string;
    decisions: { gateKey: string; outcomeKey: string }[];
  };
  expect(quote.stageKey).toBe('CUSTOMER_DECISION');
  expect(quote.decisions[0]).toMatchObject({ gateKey: 'G4', outcomeKey: 'approve' });
  await context.close();
});
