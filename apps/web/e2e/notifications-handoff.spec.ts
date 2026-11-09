import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

import { seriousViolations } from './axe';
import { prepareModels } from './models';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// FB-05 (F-079, F-034). A KAM sees "Returned to you" in the notification bell after Pricing sends the
// quote back to them (G3 → KAM), and a comment alerts the assigned engineer. Earlier stages are driven
// through the API (they have their own specs).

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

test('a KAM sees "Returned to you" in the bell after a G3 rework, with the reason and note', async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
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

  // The pricing lead sends it back to the KAM.
  await post('gates/G3/decisions', 'pricing-lead', {
    outcomeKey: 'rework_kam',
    reasonCode: 'missing_information',
    note: 'Annual volume by SKU is missing',
  });

  // The KAM sees it in the bell and opens the quote from there.
  const kam = await (await browser.newContext()).newPage();
  await signInAs(kam, 'kam');
  await kam.goto('/');
  const bell = kam.getByTestId('notification-bell');
  await expect(bell).toHaveAccessibleName(/unread/);
  await bell.click();
  const list = kam.getByTestId('notification-list');
  const item = list.getByRole('link').filter({ hasText: `${qn} was returned to you for rework` });
  await expect(item).toBeVisible();
  await expect(item).toContainText('Quoting sent it back');
  await expect(item).toContainText('Reason: Missing information.');
  await expect(item).toContainText('Annual volume by SKU is missing');
  expect(await seriousViolations(kam)).toEqual([]);
  await item.click();
  await expect(kam.getByTestId('quote-detail')).toBeVisible();
  await kam.context().close();

  // The pricer, who is not the KAM, was not told it was returned "to them".
  const pricer = await (await browser.newContext()).newPage();
  await signInAs(pricer, 'pricing');
  await pricer.goto('/');
  await pricer.getByTestId('notification-bell').click();
  await expect(
    pricer.getByTestId('notification-list').getByText(`${qn} was returned to you for rework`),
  ).toHaveCount(0);
  await pricer.context().close();
});

test('T-010: a comment by the KAM alerts the assigned engineer in the bell', async ({
  browser,
  request,
}) => {
  test.setTimeout(90_000);
  const engineerId = await userId(request, 'engineer');
  const qn = await submitQuote(request, await freeOpportunities(request, 1));
  await ok(
    request.post(`/api/v1/quotes/${qn}/gates/G1/decisions`, {
      headers: as('sales-leader'),
      data: { outcomeKey: 'advance' },
    }),
    201,
  );
  await ok(
    request.post(`/api/v1/quotes/${qn}/assignment`, {
      headers: as('eng-lead'),
      data: { engineerId },
    }),
  );
  await ok(
    request.post(`/api/v1/quotes/${qn}/comments`, {
      headers: as('kam'),
      data: { body: 'The customer moved the launch up. Please look at the tooling.', mentions: [] },
    }),
    201,
  );

  const engineer = await (await browser.newContext()).newPage();
  await signInAs(engineer, 'engineer');
  await engineer.goto('/');
  await engineer.getByTestId('notification-bell').click();
  const item = engineer
    .getByTestId('notification-list')
    .getByRole('link')
    .filter({ hasText: `commented on ${qn}` });
  await expect(item).toBeVisible();
  // The alert says there is a comment; the text is on the quote.
  await expect(item).not.toContainText('tooling');
  await engineer.context().close();
});
