import { readFile } from 'node:fs/promises';

import { expect, test, type APIResponse, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// B-11: Pricing finds an engineering-cleared quote in the pricing queue, records the price approval
// (references, basis, range, costing attestation) and capital readiness, and submits to Final Review
// (G3). B-15: an Admin imports the pricing history (a synthetic export with the real headers); the
// panel resolves the Legacy ERF #, the Pricing history page searches ERF / BPR / SPR, and the ERF #
// still saves when the history can't be loaded (B-26: the ERF # is optional; no BPR on a quote).
// B-26 (A6): the queue shows who the pricing lead assigned it to. The KAM sees only "Price approved
// ✓" and no panel (403 from the API); the Approver is notified. The quote is created, qualified
// and engineered through the API (those stages have their own specs).

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });

test('Pricing records the approval and submits to Final Review; the KAM reads the record', async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  // Provision the personas the flow notifies or names (the e2e database is config-seeded only).
  await request.get('/api/v1/me', { headers: as('approver') });
  const pricer = await request.get('/api/v1/me', { headers: as('pricing') });
  const pricerId = ((await pricer.json()) as { user: { id: string } }).user.id;
  const engineer = await request.get('/api/v1/me', { headers: as('engineer') });
  const engineerId = ((await engineer.json()) as { user: { id: string } }).user.id;

  // B-15: the legacy pricing history (idempotent: re-importing the same file changes nothing).
  const imported = await request.post('/api/v1/admin/pricing-history/import?apply=true', {
    headers: as('admin'),
    multipart: {
      file: {
        name: 'pricing-history.synthetic.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: await readFile(
          new URL('./fixtures/pricing-history.synthetic.xlsx', import.meta.url),
        ),
      },
    },
  });
  expect(imported.status(), await imported.text()).toBe(200);

  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  const ok = async (res: Promise<APIResponse>, status = 200) => {
    const r = await res;
    expect(r.status(), await r.text()).toBe(status);
  };
  await ok(
    request.post(`/api/v1/quotes/${quoteNumber}/gates/G1/decisions`, {
      headers: as('sales-leader'),
      data: { outcomeKey: 'advance' },
    }),
    201,
  );
  await ok(
    request.put(`/api/v1/quotes/${quoteNumber}/eng-review`, {
      headers: as('eng-lead'),
      data: {
        processType: 'EBM',
        machineType: 'EBM_SHUTTLE',
        plantCode: 'PLANT_01',
        cavitation: 8,
        cycleTimeS: 14.5,
        prelimCapitalUsd: 420000,
      },
    }),
  );
  await ok(
    request.put(`/api/v1/quotes/${quoteNumber}/capacity-evidence`, {
      headers: as('eng-lead'),
      data: {
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
      },
    }),
  );
  // B-26: the capacity owner signs off before G2 can advance.
  await ok(
    request.put(`/api/v1/quotes/${quoteNumber}/capacity-signoff`, {
      headers: as('eng-lead'),
      data: { status: 'approved' },
    }),
  );
  await ok(
    request.post(`/api/v1/quotes/${quoteNumber}/gates/G2/decisions`, {
      headers: as('eng-lead'),
      data: { outcomeKey: 'capital_required' },
    }),
    201,
  );

  // The pricing lead assigns the Quoting work to the pricer (B-26), who submits it back to them.
  await ok(
    request.post(`/api/v1/quotes/${quoteNumber}/pricing-assignment`, {
      headers: as('pricing-lead'),
      data: { pricerId },
    }),
  );

  const open = async (persona: string): Promise<Page> => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAs(page, persona);
    return page;
  };

  // ── Pricing: the queue flags "Capital required" with capital pending ──
  const pricing = await open('pricing');
  await pricing.goto('/');
  await pricing
    .getByRole('navigation', { name: 'Primary' })
    .locator('[data-nav="queue-pricing"]')
    .click();
  await expect(pricing.getByRole('heading', { level: 1, name: 'Pricing queue' })).toBeVisible();
  await pricing.getByLabel('Search the pricing queue').fill(quoteNumber);
  const row = pricing.getByRole('row').filter({ hasText: quoteNumber });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('g2-outcome')).toHaveText('Advance – capital required');
  await expect(row.getByTestId('capital-readiness')).toHaveText('Pending');
  await expect(row.getByTestId('approval-status')).toHaveText('Awaiting approval');
  await expect(row.getByTestId('assigned-pricer')).toBeVisible(); // assigned by the pricing lead
  expect(await seriousViolations(pricing)).toEqual([]);

  await row.getByRole('link', { name: quoteNumber }).click();
  await expect(pricing).toHaveURL(new RegExp(`/quotes/${quoteNumber}\\?tab=quoting`));
  const tab = pricing.getByTestId('quoting-tab');
  await expect(tab.getByTestId('price-approval-status')).toContainText('not recorded');
  // Pricing reads the engineering summary, commercial numbers included.
  await expect(tab.getByTestId('quoting-g2')).toContainText('Advance – capital required');
  await expect(tab).toContainText('$420,000');
  // B-15: the pricing history panel sits above the approval form (the history was imported above).
  const panel = tab.getByTestId('pricing-context');
  await expect(panel.getByRole('heading', { name: 'Pricing history' })).toBeVisible();

  // ── The price approval: a bad reference is caught by format (the export's ERF<yy>-<n>) ──
  const form = tab.getByTestId('pricing-record-form');
  await expect(form.getByLabel('Approved by')).not.toHaveValue(''); // defaults to the caller
  await form.getByLabel('Legacy ERF #').fill('48211');
  await form.getByLabel('Pricing basis').fill('March CDI, FOB Chicago');
  await form.getByLabel('Approved negotiation range').fill('Hold the list price; floor per Gemma');
  await form.getByLabel('Costing completed (Cost-to-Serve)').check();
  await form.getByRole('button', { name: 'Save price approval' }).click();
  await expect(form.getByRole('alert').first()).toContainText('is not a valid Legacy ERF number');
  await form.getByLabel('Legacy ERF #').fill('erf26-211, ERF99-999');
  await form.getByRole('button', { name: 'Save price approval' }).click();
  await expect(pricing.getByText('Price approval recorded')).toBeVisible();
  await expect(tab.getByTestId('price-approval-status')).toContainText('Price approved ✓');

  // ── B-15: the Legacy ERF # resolves in the imported history (no BPR on a quote: B-26) ──
  const erf = panel.getByTestId('pricing-context-erf').filter({ hasText: 'ERF26-211' });
  await expect(erf).toContainText('Abandoned');
  await expect(erf).toContainText('E2E Bottling Co (synthetic)');
  await expect(erf).toContainText('$450,000'); // est. revenue
  await expect(erf.getByText('Unknown').first()).toBeVisible(); // volume written as 0 = unknown
  await expect(erf).toContainText('Customer paused the launch (synthetic note).'); // free text
  await expect(erf.getByText('Referenced')).toBeVisible();
  await expect(panel.getByTestId('pricing-context-not-found')).toContainText('ERF99-999');
  expect(await seriousViolations(pricing)).toEqual([]);

  // ── The history page: every kind for the customer, BPR prices included ──
  await panel.getByTestId('pricing-history-link').click();
  await expect(pricing.getByRole('heading', { level: 1, name: 'Pricing history' })).toBeVisible();
  await pricing.getByLabel('Customer').fill('E2E Bottling');
  await pricing.getByRole('button', { name: 'Search' }).click();
  const results = pricing.getByTestId('history-results');
  await expect(results.getByTestId('history-erf')).toHaveCount(3);
  await expect(results).toContainText('EP09-045');
  await pricing.getByTestId('history-kind-bpr').click();
  const bpr = results.getByTestId('history-bpr');
  await expect(bpr).toHaveCount(1);
  await bpr.locator('summary').click();
  await expect(bpr).toContainText('$0.4125');
  expect(await seriousViolations(pricing)).toEqual([]);
  await pricing.goBack(); // the search replaces its own history entry
  await expect(tab.getByTestId('price-approval-status')).toContainText('Price approved ✓');

  // ── History unavailable: the panel says so and the Legacy ERF # still saves ──
  await pricing.route('**/api/v1/quotes/*/pricing-context', (route) =>
    route.fulfill({ status: 500, contentType: 'application/problem+json', body: '{}' }),
  );
  await pricing.reload();
  await expect(pricing.getByTestId('pricing-context-unavailable')).toContainText(
    'you can still type a Legacy ERF #',
  );
  await form.getByLabel('Legacy ERF #').fill('ERF26-211, ERF25-340');
  const saved = pricing.waitForResponse(
    (r) => r.url().endsWith('/pricing-record') && r.request().method() === 'PUT',
  );
  await form.getByRole('button', { name: 'Save price approval' }).click();
  expect((await saved).status()).toBe(200);
  await expect(form.getByLabel('Legacy ERF #')).toHaveValue('ERF26-211, ERF25-340');
  await pricing.unroute('**/api/v1/quotes/*/pricing-context');
  // No price figure can be typed anywhere on the tab.
  await expect(tab.locator('input[type="number"]')).toHaveCount(0);

  // ── Capital: still pending, with a justification (D-11: warned, not blocked) ──
  const capital = tab.getByTestId('capital-form');
  await expect(capital.getByLabel('Status')).toHaveValue('pending');
  await capital.getByLabel('Pending-capital justification').fill('CER goes to the board Nov 10');
  await capital.getByLabel('CER reference').fill('CER-4410');
  await capital.getByRole('button', { name: 'Save capital readiness' }).click();
  await expect(pricing.getByText('Capital readiness saved')).toBeVisible();
  await expect(tab.getByTestId('quoting-warnings')).toContainText('Capital is still pending');
  expect(await seriousViolations(pricing)).toEqual([]);

  // ── Lead review (2026-10-30): the pricer submits to the pricing lead; only the lead decides G3 ──
  await expect(tab.getByRole('button', { name: 'Advance to Final Review…' })).toHaveCount(0);
  await tab.getByRole('button', { name: 'Submit to pricing lead' }).click();
  await expect(tab.getByTestId('lead-review-submitted')).toContainText(
    'Submitted to the pricing lead',
  );
  await expect(tab.getByTestId('capital-form')).toHaveCount(0); // locked for the pricer

  const lead = await open('pricing-lead');
  await lead.goto('/queue/pricing');
  await lead.getByTestId('review-tab-ready').click();
  await lead.getByRole('link', { name: quoteNumber }).click();
  await lead.goto(`/quotes/${quoteNumber}?tab=quoting`);
  const leadTab = lead.getByTestId('quoting-tab');
  await expect(leadTab.getByTestId('lead-review-submitted')).toBeVisible();
  await leadTab.getByRole('button', { name: 'Advance to Final Review…' }).click();
  const g3 = lead.getByRole('dialog');
  await expect(g3.getByTestId('completeness')).toContainText('Nothing missing for this decision');
  await expect(g3.getByRole('radio', { name: 'Advance to Final Review' })).toBeChecked();
  await g3.getByRole('button', { name: 'Record decision' }).click();
  await expect(g3).toHaveCount(0);
  await expect(lead.getByText(`${quoteNumber} is now in Final Review`)).toBeVisible();
  await expect(lead.getByTestId('quote-detail')).toHaveAttribute('data-stage', 'FINAL_REVIEW');

  // ── The KAM: "Price approved ✓ on <date> by <name>", and (2026-10-30) the record itself ──
  const kam = await open('kam');
  await kam.goto(`/quotes/${quoteNumber}?tab=quoting`);
  const kamTab = kam.getByTestId('quoting-tab');
  await expect(kamTab.getByTestId('price-approval-status')).toContainText(
    /Price approved ✓ on .+ by /,
  );
  await expect(kamTab.getByTestId('quoting-redacted')).toHaveCount(0);
  for (const figure of [
    'March CDI',
    'Hold the list price',
    'ERF26-211',
    'CER-4410',
    'board Nov 10',
  ]) {
    await expect(kam.getByTestId('quote-detail')).toContainText(figure);
  }
  // B-15: the pricing history is open to every role too.
  await expect(kam.getByTestId('pricing-context')).toBeVisible();
  for (const persona of ['kam', 'engineer']) {
    const context = await request.get(`/api/v1/quotes/${quoteNumber}/pricing-context`, {
      headers: as(persona),
    });
    expect(context.status()).toBe(200);
    const lookup = await request.get('/api/v1/pricing/erf/ERF26-211', { headers: as(persona) });
    expect(lookup.status()).not.toBe(403);
  }
  expect(await seriousViolations(kam)).toEqual([]);

  // ── The Approver group is told ──
  const approver = await open('approver');
  await approver.goto('/');
  await approver.getByTestId('notification-bell').click();
  await expect(approver.getByTestId('notification-list')).toContainText(
    `${quoteNumber} is ready for Final Review`,
  );
});

// The pricing lead assigns work like the engineering lead: from the quote's Quoting tab, or by ticking
// quotes in the queue and "Assign selected…". A plain pricer sees who is assigned, without the button.
test('the pricing lead assigns a pricer from the Quoting tab and from the queue', async ({
  browser,
  request,
}) => {
  test.setTimeout(90_000);
  const me = async (persona: string) =>
    (
      (await (await request.get('/api/v1/me', { headers: as(persona) })).json()) as {
        user: { id: string; displayName: string };
      }
    ).user;
  const pricer = await me('pricing');
  await me('pricing-lead');
  const engineerId = (await me('engineer')).id;
  const ok = async (res: Promise<APIResponse>, status = 200) => {
    const r = await res;
    expect(r.status(), await r.text()).toBe(status);
  };
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  await ok(
    request.post(`/api/v1/quotes/${quoteNumber}/gates/G1/decisions`, {
      headers: as('sales-leader'),
      data: { outcomeKey: 'advance' },
    }),
    201,
  );
  await ok(
    request.put(`/api/v1/quotes/${quoteNumber}/eng-review`, {
      headers: as('eng-lead'),
      data: {
        processType: 'EBM',
        machineType: 'EBM_SHUTTLE',
        plantCode: 'PLANT_01',
        cavitation: 8,
        cycleTimeS: 14.5,
      },
    }),
  );
  await ok(
    request.put(`/api/v1/quotes/${quoteNumber}/capacity-evidence`, {
      headers: as('eng-lead'),
      data: {
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
      },
    }),
  );
  await ok(
    request.put(`/api/v1/quotes/${quoteNumber}/capacity-signoff`, {
      headers: as('eng-lead'),
      data: { status: 'approved' },
    }),
  );
  await ok(
    request.post(`/api/v1/quotes/${quoteNumber}/gates/G2/decisions`, {
      headers: as('eng-lead'),
      data: { outcomeKey: 'proceed' },
    }),
    201,
  );

  // ── From the Quoting tab ──
  const lead = await (await browser.newContext()).newPage();
  await signInAs(lead, 'pricing-lead');
  await lead.goto(`/quotes/${quoteNumber}?tab=quoting`);
  const box = lead.getByTestId('pricer-assignment');
  await expect(box).toContainText('Unassigned');
  await box.getByRole('button', { name: 'Assign…' }).click();
  const dialog = lead.getByRole('dialog');
  await dialog.getByLabel('Pricer').selectOption({ value: pricer.id });
  await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(box.getByTestId('assigned-pricer')).toContainText(pricer.displayName);
  await expect(box.getByRole('button', { name: 'Reassign…' })).toBeVisible();

  // ── From the queue: tick the quote, Assign selected… (back to the lead) ──
  await lead.goto('/queue/pricing');
  await lead.getByLabel('Search the pricing queue').fill(quoteNumber);
  await lead.getByLabel(`Select ${quoteNumber}`).check();
  const bar = lead.getByRole('region', { name: 'Bulk actions' });
  await expect(bar).toContainText('1 selected');
  await bar.getByRole('button', { name: 'Assign selected…' }).click();
  const bulk = lead.getByRole('dialog');
  await bulk.getByLabel('Pricer').selectOption({ index: 1 });
  await bulk.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(bulk).toHaveCount(0);
  await expect(bar).toHaveCount(0);
  expect(await seriousViolations(lead)).toEqual([]);

  // ── A plain pricer sees the assignment, with no Assign button ──
  const p = await (await browser.newContext()).newPage();
  await signInAs(p, 'pricing');
  await p.goto(`/quotes/${quoteNumber}?tab=quoting`);
  const theirs = p.getByTestId('pricer-assignment');
  await expect(theirs.getByTestId('assigned-pricer')).toBeVisible();
  await expect(theirs.getByRole('button')).toHaveCount(0);
});
