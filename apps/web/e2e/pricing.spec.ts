import { expect, test, type APIResponse, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// B-11: Pricing finds an engineering-cleared quote in the pricing queue, records the price approval
// (references, basis, range, costing attestation) and capital readiness, and submits to Final Review
// (G3). The KAM sees only "Price approved ✓"; the Approver is notified. The quote is created, qualified
// and engineered through the API (those stages have their own specs).

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });

test('Pricing records the approval and submits to Final Review; the KAM sees only the status', async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  // Provision the personas the flow notifies or names (the e2e database is config-seeded only).
  await request.get('/api/v1/me', { headers: as('approver') });
  await request.get('/api/v1/me', { headers: as('pricing') });
  const engineer = await request.get('/api/v1/me', { headers: as('engineer') });
  const engineerId = ((await engineer.json()) as { user: { id: string } }).user.id;

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
  await ok(
    request.post(`/api/v1/quotes/${quoteNumber}/gates/G2/decisions`, {
      headers: as('eng-lead'),
      data: { outcomeKey: 'capital_required' },
    }),
    201,
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
  await expect(row.getByTestId('g2-outcome')).toHaveText('Capital required');
  await expect(row.getByTestId('capital-readiness')).toHaveText('Pending');
  await expect(row.getByTestId('approval-status')).toHaveText('Awaiting approval');
  expect(await seriousViolations(pricing)).toEqual([]);

  await row.getByRole('link', { name: quoteNumber }).click();
  await expect(pricing).toHaveURL(new RegExp(`/quotes/${quoteNumber}\\?tab=quoting`));
  const tab = pricing.getByTestId('quoting-tab');
  await expect(tab.getByTestId('price-approval-status')).toContainText('not recorded');
  // Pricing reads the engineering summary, commercial numbers included.
  await expect(tab.getByTestId('quoting-g2')).toContainText('Capital required');
  await expect(tab).toContainText('$420,000');
  await expect(tab.getByTestId('pricing-app-slot')).toContainText('B-15');

  // ── The price approval: a bad reference is caught by format ──
  const form = tab.getByTestId('pricing-record-form');
  await expect(form.getByLabel('Approved by')).not.toHaveValue(''); // defaults to the caller
  await form.getByLabel('ERF number(s)').fill('ERF twelve');
  await form.getByLabel('Pricing basis').fill('March CDI, FOB Chicago');
  await form.getByLabel('Approved negotiation range').fill('Hold the list price; floor per Gemma');
  await form.getByLabel('Costing completed (Cost-to-Serve)').check();
  await form.getByRole('button', { name: 'Save price approval' }).click();
  await expect(form.getByRole('alert').first()).toContainText('is not a valid ERF number');
  await form.getByLabel('ERF number(s)').fill('48213');
  await form.getByRole('button', { name: 'Save price approval' }).click();
  await expect(pricing.getByText('Price approval recorded')).toBeVisible();
  await expect(tab.getByTestId('price-approval-status')).toContainText('Price approved ✓');
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

  // ── G3 Submit to Final Review ──
  await tab.getByRole('button', { name: 'Submit to Final Review…' }).click();
  const g3 = pricing.getByRole('dialog');
  await expect(g3.getByTestId('completeness')).toContainText('Nothing missing for this decision');
  await expect(g3.getByRole('radio', { name: 'Submit to Final Review' })).toBeChecked();
  await g3.getByRole('button', { name: 'Record decision' }).click();
  await expect(g3).toHaveCount(0);
  await expect(pricing.getByText(`${quoteNumber} is now in Final Review`)).toBeVisible();
  await expect(pricing.getByTestId('quote-detail')).toHaveAttribute('data-stage', 'FINAL_REVIEW');

  // ── The KAM: "Price approved ✓ on <date> by <name>", nothing else ──
  const kam = await open('kam');
  await kam.goto(`/quotes/${quoteNumber}?tab=quoting`);
  const kamTab = kam.getByTestId('quoting-tab');
  await expect(kamTab.getByTestId('price-approval-status')).toContainText(
    /Price approved ✓ on .+ by /,
  );
  await expect(kamTab.getByTestId('quoting-redacted')).toBeVisible();
  for (const secret of ['March CDI', 'Hold the list price', '48213', 'CER-4410', 'board Nov 10']) {
    await expect(kam.getByTestId('quote-detail')).not.toContainText(secret);
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
