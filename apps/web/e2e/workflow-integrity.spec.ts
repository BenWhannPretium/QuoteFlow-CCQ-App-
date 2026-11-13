import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

import { seriousViolations } from './axe';
import { prepareModels } from './models';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// FB-01 (workflow integrity). T-001 (F-001): once the pricing lead approves G3, the pricing fields are
// read-only for every role and say who locked them. T-005 (F-029 / F-030): the pricing lead sends the
// quote back to the KAM; the KAM fixes it, answers "No" to "Did the scope change?" and it lands back in
// Quoting with the same pricer. Earlier stages are driven through the API (they have their own specs).

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });

async function ok(res: Promise<APIResponse>, status = 200) {
  const r = await res;
  expect(r.status(), await r.text()).toBe(status);
  return r;
}

const userId = async (request: APIRequestContext, persona: string) =>
  (
    (await (await request.get('/api/v1/me', { headers: as(persona) })).json()) as {
      user: { id: string };
    }
  ).user.id;

/** Qualified, engineered, in Quoting with the pricer assigned and the price approval recorded. */
async function pricedInQuoting(request: APIRequestContext): Promise<string> {
  const engineerId = await userId(request, 'engineer');
  const pricerId = await userId(request, 'pricing');
  await userId(request, 'pricing-lead');
  const qn = await submitQuote(request, await freeOpportunities(request, 1));
  const post = (path: string, persona: string, data?: unknown) =>
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
  await ok(
    request.post(`/api/v1/quotes/${qn}/pricing-assignment`, {
      headers: as('pricing-lead'),
      data: { pricerId },
    }),
  );
  // FB-07 (F-032): the costing model (and the ROI model when needed) before costing is attested.
  await prepareModels(request, qn);
  await put('pricing-record', 'pricing', {
    approvedBy: pricerId,
    pricingBasisNote: 'March CDI, FOB Chicago',
    costingCompleted: true,
  });
  await put('capital-readiness', 'pricing', { capitalReadiness: 'not_required' });
  return qn;
}

test('T-001: after the pricing lead approves G3, the pricing fields are read-only', async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const qn = await pricedInQuoting(request);
  await ok(
    request.post(`/api/v1/quotes/${qn}/gates/G3/decisions`, {
      headers: as('pricing-lead'),
      data: { outcomeKey: 'submit' },
    }),
    201,
  );

  for (const persona of ['pricing', 'pricing-lead']) {
    const page = await (await browser.newContext()).newPage();
    await signInAs(page, persona);
    await page.goto(`/quotes/${qn}?tab=quoting`);
    const tab = page.getByTestId('quoting-tab');
    const lock = tab.getByTestId('section-lock');
    await expect(lock).toHaveAttribute('data-gate', 'G3');
    await expect(lock).toContainText(
      /Locked after G3 · decided by .+ on .+ · reopens if the quote is sent back/,
    );
    // Read-only: no edit form, the recorded values are shown.
    await expect(tab.getByTestId('pricing-record-form')).toHaveCount(0);
    await expect(tab.getByTestId('capital-form')).toHaveCount(0);
    await expect(tab).toContainText('March CDI, FOB Chicago');
    expect(await seriousViolations(page)).toEqual([]);
    await page.context().close();
  }
  // The server is the control.
  const write = await request.put(`/api/v1/quotes/${qn}/pricing-record`, {
    headers: as('pricing-lead'),
    data: { pricingBasisNote: 'after approval' },
  });
  expect(write.status()).toBe(409);
  expect(await write.json()).toMatchObject({ code: 'SECTION_LOCKED' });
});

test('T-005: Pricing → KAM → "No" scope change → back in Quoting with the same pricer', async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const qn = await pricedInQuoting(request);
  const pricerName = (
    (await (await request.get('/api/v1/me', { headers: as('pricing') })).json()) as {
      user: { displayName: string };
    }
  ).user.displayName;

  // ── The pricing lead sends it back to the KAM, with a reason and a note ──
  const lead = await (await browser.newContext()).newPage();
  await signInAs(lead, 'pricing-lead');
  await lead.goto(`/quotes/${qn}?tab=quoting`);
  await lead.getByTestId('decide-gate').click();
  const dialog = lead.getByRole('dialog');
  // One decision button: the dialog is titled like it and offers every outcome, back to the KAM included.
  await expect(dialog.getByRole('heading', { name: 'Decide price approval' })).toBeVisible();
  await dialog.getByRole('radio', { name: 'Rework (back to KAM)' }).check();
  // DR-engineering-10: the note helper says what to write for this outcome.
  await expect(dialog.getByText('Say what needs to change, and where.')).toBeVisible();
  await dialog.getByLabel('Reason (required)').selectOption({ label: 'Missing information' });
  await dialog.getByLabel('Note (required)').fill('Annual volume by SKU is missing');
  expect(await seriousViolations(lead)).toEqual([]);
  await dialog.getByRole('button', { name: 'Record decision' }).click();
  await expect(dialog).toHaveCount(0);
  await lead.context().close();

  // ── The KAM fixes it and says the scope did not change ──
  const kam = await (await browser.newContext()).newPage();
  await signInAs(kam, 'kam');
  await kam.goto('/intake/new');
  const returned = kam.getByTestId('returned');
  await expect(returned).toContainText(qn);
  await expect(returned).toContainText('Annual volume by SKU is missing');
  await returned
    .getByRole('listitem')
    .filter({ hasText: qn })
    .getByRole('button', { name: 'Fix and resubmit' })
    .click();
  await expect(kam.getByTestId('rework-notice')).toContainText('straight back to Pricing');
  // To the review step.
  const wizard = kam.getByTestId('intake-wizard');
  while ((await wizard.getAttribute('data-step')) !== '4') {
    await kam.getByRole('button', { name: 'Next' }).click();
  }
  const submit = kam.getByRole('button', { name: 'Submit to CCQ' });
  const scope = kam.getByTestId('scope-change');
  await expect(scope).toContainText('Did the scope change? (required)');
  await expect(submit).toBeDisabled();
  expect(await seriousViolations(kam)).toEqual([]);
  await scope.getByRole('radio', { name: 'No, same scope' }).check();
  await submit.click();
  await expect(kam.getByTestId('submitted')).toContainText('resubmitted');
  await expect(kam.getByTestId('submitted')).toContainText('It is now in Quoting.');
  await kam.context().close();

  // ── Back in Quoting with the same pricer, editable again ──
  const pricer = await (await browser.newContext()).newPage();
  await signInAs(pricer, 'pricing');
  await pricer.goto(`/quotes/${qn}?tab=quoting`);
  await expect(pricer.getByTestId('quote-detail')).toHaveAttribute('data-stage', 'QUOTING');
  const tab = pricer.getByTestId('quoting-tab');
  await expect(tab.getByTestId('assigned-pricer')).toContainText(pricerName);
  await expect(tab.getByTestId('section-lock')).toHaveCount(0);
  await expect(tab.getByTestId('pricing-record-form')).toBeVisible();
  await pricer.context().close();
});
