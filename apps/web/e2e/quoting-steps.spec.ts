import { buildPaybackWorkbook } from '@ccq/integrations/test/synthetic-workbooks';
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

import { seriousViolations } from './axe';
import { SYNTHETIC_XLSX, uploadBom, uploadModel } from './models';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// FB-07 (D-001, decided Nov 9; F-031, F-032, F-074, F-081, F-083; T-034): costing, then payback, then price
// approved, as steps inside Quoting. The pricer uploads the costing model (two versions), Finance uploads
// the payback model, the pricing lead approves the price ("Advance – price approved") and the Approver sees
// the models at Final Review. A second quote with no payback request shows the Payback step as "Not requested" (FB-21).
// The quotes are qualified and engineered through the API (those stages have their own specs).

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function ok(res: Promise<APIResponse>, status = 200) {
  const r = await res;
  expect(r.status(), await r.text()).toBe(status);
  return r;
}

/**
 * A quote Engineering advanced into Quoting. FB-17 (W13-22): "Advance – capital required" is switched
 * off; capital is needed when the preliminary capital is above $0. `needed`: $420,000 and the equipment
 * BOM, so the Advance flags the quote capital likely. `none`: $0.
 */
async function inQuoting(
  request: APIRequestContext,
  engineerId: string,
  capital: 'none' | 'needed',
): Promise<string> {
  const qn = await submitQuote(request, await freeOpportunities(request, 1));
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
    prelimCapitalUsd: capital === 'needed' ? 420000 : 0,
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
  // FB-06 (F-058) / FB-17: capital needed needs the equipment BOM on file.
  if (capital === 'needed') await uploadBom(request, qn);
  await post('gates/G2/decisions', 'eng-lead', { outcomeKey: 'proceed' });
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

const file = (name: string, buffer: Buffer = SYNTHETIC_XLSX) => ({ name, mimeType: XLSX, buffer });

test('costing → payback → price approved → Final Review, with versions and the Finance role', async ({
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
  const qn = await inQuoting(request, engineerId, 'needed');
  // FB-21 (N17-21): the pricing lead assigns the quote, so the pricer may ask Finance for payback.
  const assigned = await request.post(`/api/v1/quotes/${qn}/pricing-assignment`, {
    headers: as('pricing-lead'),
    data: { pricerId: pricingId },
  });
  expect(assigned.status(), await assigned.text()).toBe(200);

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
  // FB-21: nobody has asked Finance yet. FB-17 (W13-22): capital likely is only a hint now.
  await expect(steps.getByTestId('step-roi')).toHaveAttribute('data-status', 'not_requested');
  await expect(steps.getByTestId('payback-hint')).toContainText('Capital is flagged likely');
  // FB-21 Part E (N17-24): each model upload says what it takes.
  await expect(steps.getByTestId('formats-cost_model')).toHaveText(
    'Excel workbook (.xlsx), up to 100 MB',
  );
  await expect(steps.getByTestId('upload-cost_model')).toHaveAttribute('accept', '.xlsx');
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
  // FB-21: without a request the price is next; the pricer asks Finance for the payback model.
  await expect(pricer.getByTestId('quoting-steps')).toHaveAttribute('data-current', 'price');
  const payback = pricer.getByTestId('payback-request');
  await payback.getByTestId('payback-ask').click();
  await payback.getByLabel('Note to Finance (optional)').fill('Board pack on Friday (synthetic)');
  await payback.getByRole('button', { name: 'Ask Finance' }).click();
  await expect(pricer.getByText('Finance has been asked for a payback model')).toBeVisible();
  await expect(payback).toHaveAttribute('data-status', 'open');
  await expect(pricer.getByTestId('payback-requested')).toContainText('Waiting on Finance');
  await expect(pricer.getByTestId('quoting-steps')).toHaveAttribute('data-current', 'roi');
  await expect(payback.getByTestId('payback-withdraw')).toBeVisible();
  expect(await seriousViolations(pricer)).toEqual([]);

  // ── Step 2, Finance: reads the quote, uploads the ROI model, can do nothing else ──
  const finance = await open('finance');
  const fSteps = finance.getByTestId('quoting-steps');
  await expect(fSteps.getByTestId('step-roi')).toHaveAttribute('data-status', 'waiting');
  await expect(fSteps.getByTestId('upload-cost_model')).toHaveCount(0);
  await expect(finance.getByTestId('pricing-record-form')).toHaveCount(0);
  // FB-14: a workbook QuoteFlow cannot read is stored, and the step says "Summary unavailable" (never
  // blocks). Then the synthetic payback workbook: its summary, with the IRR error flagged.
  await fSteps.getByTestId('upload-roi_model').setInputFiles(file('Notes.synthetic.xlsx'));
  await expect(fSteps.getByTestId('model-roi_model')).toContainText('v1 · current');
  await expect(fSteps.getByTestId('summary-roi_model')).toHaveAttribute(
    'data-status',
    'unavailable',
  );
  await expect(fSteps.getByTestId('summary-roi_model')).toContainText('Summary unavailable');
  await expect(fSteps).toHaveAttribute('data-current', 'price');
  await fSteps
    .getByTestId('upload-roi_model')
    .setInputFiles(
      file(
        'Payback board template.synthetic.xlsx',
        await buildPaybackWorkbook({ irr: { error: '#NUM!' } }),
      ),
    );
  await expect(fSteps.getByTestId('model-roi_model')).toContainText('v2 · current');
  const summary = fSteps.getByTestId('summary-roi_model');
  await expect(summary).toHaveAttribute('data-status', 'complete');
  await expect(summary.getByTestId('summary-field-payback_years')).toContainText('2.5 years');
  await expect(summary.getByTestId('summary-field-capital_request')).toContainText('$400,000');
  await expect(summary.getByTestId('summary-warnings-roi_model')).toContainText(
    'The workbook shows an error in IRR. Ask Finance to check it.',
  );
  await expect(summary.getByTestId('summary-provenance-roi_model')).toContainText(
    'Read from v2, uploaded by',
  );
  await expect(fSteps).toHaveAttribute('data-current', 'price');
  expect(await seriousViolations(finance)).toEqual([]);

  // FB-21 (N17-22): the pricer who asked is told that Finance uploaded it.
  await pricer.goto('/');
  await pricer.getByTestId('notification-bell').click();
  await expect(pricer.getByTestId('notification-list')).toContainText(
    `${qn}: the payback model is uploaded`,
  );

  // ── Step 3, the pricing lead: an updated price table (optional), then "Price approved" ──
  const lead = await open('pricing-lead');
  const lSteps = lead.getByTestId('quoting-steps');
  await expect(lSteps.getByTestId('step-price')).toHaveAttribute('data-status', 'waiting');
  await lSteps.getByTestId('upload-price_table').setInputFiles(file('Price table.synthetic.xlsx'));
  await expect(lSteps.getByTestId('model-price_table')).toContainText('v1 · current');
  await lead.getByTestId('decide-gate').click();
  const g3 = lead.getByRole('dialog');
  await expect(g3.getByRole('heading', { name: 'Decide price approval' })).toBeVisible();
  await g3.getByRole('radio', { name: 'Advance – price approved' }).check();
  await expect(g3.getByTestId('completeness')).toContainText('Nothing missing for this decision');
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
  await expect(review.getByTestId('model-roi_model')).toContainText('Payback board template');
  // FB-14: the payback summary, read-only, at Final Review too.
  await expect(review.getByTestId('summary-roi_model')).toHaveAttribute('data-status', 'complete');
  await expect(review.getByTestId('summary-field-payback_years')).toContainText('2.5 years');
  await expect(review.getByTestId('summary-provenance-roi_model')).toContainText(
    'Figures come from the workbook and cannot be edited here.',
  );
  await expect(review.getByTestId('step-price')).toHaveAttribute('data-status', 'done');
  await expect(review.getByTestId('upload-cost_model')).toHaveCount(0);
  expect(await seriousViolations(approver)).toEqual([]);
});

test('no request: the Payback step says "Not requested" and the lead approves without it', async ({
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
  const qn = await inQuoting(request, await id('engineer'), 'none');

  await signInAs(page, 'pricing-lead');
  await page.goto(`/quotes/${qn}?tab=quoting`);
  const steps = page.getByTestId('quoting-steps');
  await expect(steps.getByTestId('step-roi')).toHaveAttribute('data-status', 'not_requested');
  await expect(steps.getByTestId('roi-not-required')).toContainText('Not requested');
  await steps.getByTestId('upload-cost_model').setInputFiles(file('Costing model.synthetic.xlsx'));
  await expect(steps.getByTestId('model-cost_model')).toContainText('v1 · current');
  await pricingRecorded(request, qn, await id('pricing'));
  await page.reload();
  await expect(page.getByTestId('quoting-steps')).toHaveAttribute('data-current', 'price');
  // One decision button at the end of the tab; its dialog is titled like the button and lists every outcome.
  await page.getByTestId('decide-gate').click();
  const g3 = page.getByRole('dialog');
  await expect(g3.getByRole('heading', { name: 'Decide price approval' })).toBeVisible();
  await expect(g3.getByRole('radio', { name: 'Hold', exact: true })).toBeVisible();
  await g3.getByRole('radio', { name: 'Advance – price approved' }).check();
  await expect(g3.getByTestId('completeness')).toContainText('Nothing missing for this decision');
  await g3.getByRole('button', { name: 'Record decision' }).click();
  await expect(page.getByTestId('quote-detail')).toHaveAttribute('data-stage', 'FINAL_REVIEW');
});

// FB-21 Part C (Ben, 2026-11-18): a pricing lead may approve their own work. Part D (N18-15): what
// Engineering handed over comes first on the Quoting tab. Part A: capital starts on pending and the
// lead advances with no note.
test('a pricing lead assigned to themselves prices the quote and approves it; Engineering first', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  for (const p of ['kam', 'sales-leader', 'eng-lead', 'pricing-lead']) {
    await request.get('/api/v1/me', { headers: as(p) });
  }
  const id = async (persona: string) =>
    (
      (await (await request.get('/api/v1/me', { headers: as(persona) })).json()) as {
        user: { id: string };
      }
    ).user.id;
  const qn = await inQuoting(request, await id('engineer'), 'needed');
  const leadId = await id('pricing-lead');
  await ok(
    request.post(`/api/v1/quotes/${qn}/pricing-assignment`, {
      headers: as('pricing-lead'),
      data: { pricerId: leadId },
    }),
  );
  await uploadModel(request, qn, 'cost_model', 'pricing-lead');
  await ok(
    request.put(`/api/v1/quotes/${qn}/pricing-record`, {
      headers: as('pricing-lead'),
      data: { approvedBy: leadId, costingCompleted: true },
    }),
  );

  await signInAs(page, 'pricing-lead');
  await page.goto(`/quotes/${qn}?tab=quoting`);
  const tab = page.getByTestId('quoting-tab');
  // Part D: Engineering's facts sit above the costing steps.
  await expect(tab.getByTestId('quoting-engineering-group')).toBeVisible();
  await expect(
    tab.locator('[data-testid="quoting-engineering-group"] ~ [data-testid="quoting-steps"]'),
  ).toHaveCount(1);
  // Part A: capital readiness started on pending (capital is needed) and needs no note.
  await expect(tab.getByTestId('capital-form').getByLabel('Status')).toHaveValue('pending');
  // A lead has nobody to submit to: no submit line, the decision instead.
  await expect(tab.getByTestId('pricer-submit-top')).toHaveCount(0);
  await page.getByTestId('decide-gate').click();
  const g3 = page.getByRole('dialog');
  await g3.getByRole('radio', { name: 'Advance – price approved' }).check();
  await expect(g3.getByTestId('completeness')).toContainText('Nothing missing for this decision');
  await g3.getByRole('button', { name: 'Record decision' }).click();
  await expect(g3).toHaveCount(0);
  await expect(page.getByTestId('quote-detail')).toHaveAttribute('data-stage', 'FINAL_REVIEW');
  expect(await seriousViolations(page)).toEqual([]);
});
