import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

import { seriousViolations } from './axe';
import { SYNTHETIC_XLSX } from './models';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// FB-07 (D-001, decided Nov 9; F-031, F-032, F-074, F-081, F-083; T-034): costing, then ROI, then price
// approved, as steps inside Quoting. The pricer uploads the costing model (two versions), Finance uploads
// the ROI model, the pricing lead approves the price ("Advance – price approved") and the Approver sees
// the models at Final Review. A second quote with no capital shows the ROI step as "Not required".
// The quotes are qualified and engineered through the API (those stages have their own specs).

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function ok(res: Promise<APIResponse>, status = 200) {
  const r = await res;
  expect(r.status(), await r.text()).toBe(status);
  return r;
}

async function inQuoting(
  request: APIRequestContext,
  engineerId: string,
  g2: 'proceed' | 'capital_required',
): Promise<string> {
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
    prelimCapitalUsd: 420000,
  });
  await put('capacity-evidence', 'eng-lead', {
    rows: [
      {
        site: 'PLANT_01',
        assumedEffectivenessPct: 70,
        cycleTimeS: 14.5,
        utilizationBeforePct: 62,
        analysisDate: '2026-10-26',
        analystId: engineerId,
      },
    ],
  });
  await put('capacity-signoff', 'eng-lead', { status: 'approved' });
  await post(
    'gates/G2/decisions',
    'eng-lead',
    g2 === 'proceed' ? { outcomeKey: g2 } : { outcomeKey: g2, note: 'New mold set needed' },
  );
  return qn;
}

/** The pricer's approval record and capital status (the form itself is pricing.spec.ts). */
async function pricingRecorded(request: APIRequestContext, qn: string, pricingId: string) {
  await ok(
    request.put(`/api/v1/quotes/${qn}/pricing-record`, {
      headers: as('pricing'),
      data: { approvedBy: pricingId, costingCompleted: true },
    }),
  );
  await ok(
    request.put(`/api/v1/quotes/${qn}/capital-readiness`, {
      headers: as('pricing'),
      data: { capitalReadiness: 'pre_approved' },
    }),
  );
}

const file = (name: string) => ({ name, mimeType: XLSX, buffer: SYNTHETIC_XLSX });

test('costing → ROI → price approved → Final Review, with versions and the Finance role', async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  for (const p of [
    'kam',
    'sales-leader',
    'eng-lead',
    'pricing',
    'pricing-lead',
    'finance',
    'approver',
  ]) {
    await request.get('/api/v1/me', { headers: as(p) });
  }
  const id = async (persona: string) =>
    (
      (await (await request.get('/api/v1/me', { headers: as(persona) })).json()) as {
        user: { id: string };
      }
    ).user.id;
  const engineerId = await id('engineer');
  const pricingId = await id('pricing');
  const qn = await inQuoting(request, engineerId, 'capital_required');

  const open = async (persona: string) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAs(page, persona);
    await page.goto(`/quotes/${qn}?tab=quoting`);
    await expect(page.getByTestId('quoting-steps')).toBeVisible();
    return page;
  };

  // ── Step 1, the pricer: the costing model, then a second version (T-034) ──
  const pricer = await open('pricing');
  const steps = pricer.getByTestId('quoting-steps');
  await expect(steps).toHaveAttribute('data-current', 'costing');
  await expect(steps.getByTestId('step-roi')).toHaveAttribute('data-status', 'blocked');
  await expect(steps.getByTestId('roi-reasons')).toContainText('Advance – capital required');
  await steps.getByTestId('upload-cost_model').setInputFiles(file('Costing model.synthetic.xlsx'));
  await expect(steps.getByTestId('model-cost_model')).toContainText('v1 · current');
  await steps.getByTestId('upload-cost_model').setInputFiles(file('Costing model.synthetic.xlsx'));
  await expect(steps.getByTestId('model-cost_model')).toContainText('v2 · current');
  await expect(steps.getByTestId('model-cost_model')).toContainText('2 versions');
  await steps.getByTestId('model-history').locator('summary').click();
  await expect(steps.getByTestId('model-history')).toContainText('v1');
  // The quote's file list keeps one record with its history, the latest flagged.
  await pricer.goto(`/quotes/${qn}?tab=attachments`);
  const versions = pricer.getByTestId('attachment-version');
  await expect(versions.filter({ hasText: 'v2 · current' })).toHaveCount(1);
  await expect(versions.filter({ hasText: 'v1 · replaced' })).toHaveCount(1);
  await pricingRecorded(request, qn, pricingId);
  await pricer.goto(`/quotes/${qn}?tab=quoting`);
  await expect(pricer.getByTestId('step-costing')).toHaveAttribute('data-status', 'done');
  await expect(pricer.getByTestId('quoting-steps')).toHaveAttribute('data-current', 'roi');
  expect(await seriousViolations(pricer)).toEqual([]);

  // ── Step 2, Finance: reads the quote, uploads the ROI model, can do nothing else ──
  const finance = await open('finance');
  const fSteps = finance.getByTestId('quoting-steps');
  await expect(fSteps.getByTestId('step-roi')).toHaveAttribute('data-status', 'waiting');
  await expect(fSteps.getByTestId('upload-cost_model')).toHaveCount(0);
  await expect(finance.getByTestId('pricing-record-form')).toHaveCount(0);
  await fSteps
    .getByTestId('upload-roi_model')
    .setInputFiles(file('ROI board template.synthetic.xlsx'));
  await expect(fSteps.getByTestId('model-roi_model')).toContainText('v1 · current');
  await expect(fSteps).toHaveAttribute('data-current', 'price');
  expect(await seriousViolations(finance)).toEqual([]);

  // ── Step 3, the pricing lead: an updated price table (optional), then "Price approved" ──
  const lead = await open('pricing-lead');
  const lSteps = lead.getByTestId('quoting-steps');
  await expect(lSteps.getByTestId('step-price')).toHaveAttribute('data-status', 'waiting');
  await lSteps.getByTestId('upload-price_table').setInputFiles(file('Price table.synthetic.xlsx'));
  await expect(lSteps.getByTestId('model-price_table')).toContainText('v1 · current');
  await lead.getByRole('button', { name: 'Price approved: advance to Final Review…' }).click();
  const g3 = lead.getByRole('dialog');
  await expect(g3.getByTestId('completeness')).toContainText('Nothing missing for this decision');
  await expect(g3.getByRole('radio', { name: 'Advance – price approved' })).toBeChecked();
  await g3.getByRole('button', { name: 'Record decision' }).click();
  await expect(g3).toHaveCount(0);
  await expect(lead.getByTestId('quote-detail')).toHaveAttribute('data-stage', 'FINAL_REVIEW');
  await lead.goto(`/quotes/${qn}?tab=quoting`);
  await expect(lead.getByTestId('quoting-steps')).toHaveAttribute('data-current', 'done');
  await expect(lead.getByTestId('price-confirmed')).toContainText('Approved by');
  // Locked after G3: no uploads for anyone.
  await expect(lead.getByTestId('upload-price_table')).toHaveCount(0);

  // ── Final Review: the approver sees the models, who uploaded them and when ──
  const approver = await browser.newContext().then((c) => c.newPage());
  await signInAs(approver, 'approver');
  await approver.goto(`/quotes/${qn}/review`);
  const review = approver.getByTestId('quoting-steps');
  await expect(review.getByTestId('model-cost_model')).toContainText('v2 · current');
  await expect(review.getByTestId('model-roi_model')).toContainText('ROI board template');
  await expect(review.getByTestId('step-price')).toHaveAttribute('data-status', 'done');
  await expect(review.getByTestId('upload-cost_model')).toHaveCount(0);
  expect(await seriousViolations(approver)).toEqual([]);
});

test('no capital: the ROI step says "Not required" and the lead approves without it', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  for (const p of ['kam', 'sales-leader', 'eng-lead', 'pricing', 'pricing-lead']) {
    await request.get('/api/v1/me', { headers: as(p) });
  }
  const id = async (persona: string) =>
    (
      (await (await request.get('/api/v1/me', { headers: as(persona) })).json()) as {
        user: { id: string };
      }
    ).user.id;
  const qn = await inQuoting(request, await id('engineer'), 'proceed');

  await signInAs(page, 'pricing-lead');
  await page.goto(`/quotes/${qn}?tab=quoting`);
  const steps = page.getByTestId('quoting-steps');
  await expect(steps.getByTestId('step-roi')).toHaveAttribute('data-status', 'not_required');
  await expect(steps.getByTestId('roi-not-required')).toContainText('Not required');
  await steps.getByTestId('upload-cost_model').setInputFiles(file('Costing model.synthetic.xlsx'));
  await expect(steps.getByTestId('model-cost_model')).toContainText('v1 · current');
  await pricingRecorded(request, qn, await id('pricing'));
  await page.reload();
  await expect(page.getByTestId('quoting-steps')).toHaveAttribute('data-current', 'price');
  await page.getByRole('button', { name: 'Price approved: advance to Final Review…' }).click();
  const g3 = page.getByRole('dialog');
  await expect(g3.getByTestId('completeness')).toContainText('Nothing missing for this decision');
  await g3.getByRole('button', { name: 'Record decision' }).click();
  await expect(page.getByTestId('quote-detail')).toHaveAttribute('data-stage', 'FINAL_REVIEW');
});
