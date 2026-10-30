import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// B-13 / B-26: a KAM works "My open proposals": records one quote as Awarded (acceptance evidence +
// date), which moves it to Stage 6 (Commit & Hand Off); fills in the hand-off record (CER status and
// ID, receiving role), marks the hand-off accepted and closes it Won at G6; then records another as
// Lost with a reason. Both close with outcome + reason + owner + date. The quotes are taken to Customer
// Decision through the API (the earlier stages have their own specs).

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });

async function ok(res: Promise<APIResponse>, status = 200) {
  const r = await res;
  expect(r.status(), await r.text()).toBe(status);
  return r;
}

/** Today on the US Central calendar (the server's validity and acceptance dates use it). */
const centralToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/** Qualified, engineered, priced and released by Final Review: waiting for the customer. */
async function quoteInCustomerDecision(
  request: APIRequestContext,
  engineerId: string,
  pricingId: string,
): Promise<string> {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  const post = (path: string, persona: string, data: unknown) =>
    ok(request.post(`/api/v1/quotes/${quoteNumber}/${path}`, { headers: as(persona), data }), 201);
  const put = (path: string, persona: string, data: unknown) =>
    ok(request.put(`/api/v1/quotes/${quoteNumber}/${path}`, { headers: as(persona), data }));
  await post('gates/G1/decisions', 'sales-leader', { outcomeKey: 'advance' });
  await put('eng-review', 'eng-lead', {
    processType: 'EBM',
    machineType: 'EBM_SHUTTLE',
    plantCode: 'PLANT_01',
    cavitation: 8,
    cycleTimeS: 14.5,
    prelimCapitalUsd: 180000,
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
    erfRefs: ['ERF26-213'],
    costingCompleted: true,
  });
  await put('capital-readiness', 'pricing', { capitalReadiness: 'pre_approved' });
  // 2026-10-30: the pricing lead decides G3.
  await post('gates/G3/decisions', 'pricing-lead', { outcomeKey: 'submit' });
  await put('terms', 'kam', {
    termsPaymentTerms: 'Net 45',
    termsToolingCommitment: false,
    checked: true,
  });
  await post('gates/G4/decisions', 'approver', { outcomeKey: 'approve' });
  return quoteNumber;
}

const quote = async (request: APIRequestContext, quoteNumber: string) =>
  (await (await request.get(`/api/v1/quotes/${quoteNumber}`, { headers: as('kam') })).json()) as {
    stageKey: string;
    status: string;
    outcome: string | null;
    outcomeReasonCode: string | null;
    closedAt: string | null;
    customerDecision: {
      closure: { closureOwnerName: string | null; reasonLabel: string | null } | null;
      handoff: { cerId: string | null; cerStatus: string; completed: boolean } | null;
    };
  };

test('a KAM records Awarded, hands off and closes Won at G6, and records Lost with a reason', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  for (const p of ['kam', 'sales-leader', 'eng-lead', 'pricing', 'approver']) {
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
  const winMe = await quoteInCustomerDecision(request, engineerId, pricingId);
  const loseMe = await quoteInCustomerDecision(request, engineerId, pricingId);
  const today = centralToday();

  await signInAs(page, 'kam');
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).locator('[data-nav="proposals"]').click();
  await expect(page.getByRole('heading', { level: 1, name: 'My open proposals' })).toBeVisible();
  const winCard = page.locator(`[data-testid="proposal-card"][data-quote="${winMe}"]`);
  await expect(winCard).toHaveCount(1);
  await expect(winCard.getByTestId('validity-chip')).toHaveAttribute('data-state', 'valid');
  await expect(winCard.getByTestId('validity-chip')).toContainText('days left');
  expect(await seriousViolations(page)).toEqual([]);

  // ── Awarded, from the quote page ──
  await winCard.getByRole('link', { name: winMe }).click();
  await expect(page.getByRole('heading', { level: 1, name: winMe })).toBeVisible();
  const header = page.getByTestId('customer-decision-header');
  await expect(header).toContainText('Proposal issued');
  await expect(header.getByTestId('validity-chip')).toBeVisible();
  await expect(header.getByTestId('sf-stage')).toBeVisible();
  await page.getByRole('button', { name: 'Outcome recorded' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Awarded' }).check();
  await expect(dialog.getByTestId('acceptance-fields')).toBeVisible();
  await dialog.getByRole('button', { name: 'Record decision' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Choose a reason.');
  await expect(dialog.getByRole('alert')).toContainText('Enter the date the customer accepted.');
  await dialog.getByLabel(/^Acceptance evidence/).selectOption({ label: 'Purchase order (PO)' });
  await dialog.getByLabel(/^Customer accepted on/).fill(today);
  await dialog.getByLabel(/^Document link/).fill('https://pretium.sharepoint.example/po-4471.pdf');
  expect(await seriousViolations(page)).toEqual([]);
  await dialog.getByRole('button', { name: 'Record decision' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Awarded recorded')).toBeVisible();

  // Acceptance is not spend authority: the quote is in Commit & Hand Off, not closed.
  await expect(page.getByTestId('quote-detail')).toHaveAttribute('data-stage', 'COMMIT_HANDOFF');
  await expect(page.getByTestId('closure-card')).toHaveCount(0);

  // The hand-off record opens, with the evidence from the decision; the CER field has focus.
  const handoff = page.getByTestId('handoff-card');
  await expect(handoff).toBeVisible();
  await expect(handoff.getByTestId('cer-status')).toContainText('Pending');
  await expect(handoff.getByLabel('Acceptance evidence')).toHaveValue('po');
  await expect(handoff.getByLabel('CER ID (Apex)')).toBeFocused();
  await handoff.getByLabel('CER ID (Apex)').fill('CER-2026-0412');
  await handoff.getByLabel('CER status').selectOption({ label: 'Approved' });
  await handoff.getByLabel('CER approved on').fill(today);
  await handoff
    .getByLabel('Receiving role', { exact: true })
    .selectOption({ label: 'Commercial Activation' });
  await handoff.getByLabel('Receiving contact', { exact: true }).fill('Amanda Cronkhite');
  await handoff.getByLabel('Accepted-by date', { exact: true }).fill(today);
  await handoff.getByRole('checkbox', { name: /Hand-off accepted/ }).check();
  await handoff.getByRole('button', { name: 'Save hand-off' }).click();
  await expect(page.getByText('Hand-off accepted').first()).toBeVisible();
  await expect(handoff.getByTestId('handoff-completed-by')).toContainText('Confirmed by');

  // ── G6: commit and close Won ──
  await page.getByRole('button', { name: 'Commit & hand off' }).click();
  const g6 = page.getByRole('dialog');
  await g6.getByRole('radio', { name: 'Advance (close Won)' }).check();
  await expect(g6.getByTestId('outcome-definition')).toBeVisible();
  await expect(g6.getByTestId('completeness')).toContainText('Nothing missing');
  await g6.getByLabel(/^Reason/).selectOption({ label: 'Purchase order (PO)' });
  await g6.getByRole('button', { name: 'Record decision' }).click();
  await expect(g6).toHaveCount(0);
  await expect(page.getByTestId('closure-card')).toContainText('Closed: Closed – Won');
  await expect(page.getByTestId('closure-card')).toContainText('Purchase order (PO)');
  expect(await seriousViolations(page)).toEqual([]);

  const won = await quote(request, winMe);
  expect(won).toMatchObject({
    stageKey: 'AWARDED',
    status: 'closed',
    outcome: 'awarded',
    outcomeReasonCode: 'po',
  });
  expect(won.closedAt).not.toBeNull();
  expect(won.customerDecision.closure?.closureOwnerName).toBeTruthy();
  expect(won.customerDecision.handoff).toMatchObject({
    cerId: 'CER-2026-0412',
    cerStatus: 'approved',
    completed: true,
  });

  // ── Lost, from My open proposals ──
  await page.getByRole('navigation', { name: 'Primary' }).locator('[data-nav="proposals"]').click();
  await expect(page.locator(`[data-testid="proposal-card"][data-quote="${winMe}"]`)).toHaveCount(0);
  const loseCard = page.locator(`[data-testid="proposal-card"][data-quote="${loseMe}"]`);
  await loseCard.getByRole('button', { name: 'Record outcome' }).click();
  const lost = page.getByRole('dialog');
  // "Silence is not a loss": Expired is its own outcome.
  await lost.getByRole('radio', { name: 'No response / Expired' }).check();
  await expect(lost.getByTestId('expired-explainer')).toContainText('Silence is not a loss');
  await lost.getByRole('radio', { name: 'Lost' }).check();
  await lost.getByRole('button', { name: 'Record decision' }).click();
  await expect(lost.getByRole('alert')).toContainText('Choose a reason.');
  await lost.getByLabel(/^Reason/).selectOption({ label: 'Other (note required)' });
  await lost.getByRole('button', { name: 'Record decision' }).click();
  await expect(lost.getByRole('alert')).toContainText('Add a note.');
  await lost.getByLabel(/^Reason/).selectOption({ label: 'Price' });
  await lost.getByLabel(/^Competitor/).fill('Acme Plastics');
  expect(await seriousViolations(page)).toEqual([]);
  await lost.getByRole('button', { name: 'Record decision' }).click();
  await expect(lost).toHaveCount(0);
  await expect(page.getByText('Lost recorded')).toBeVisible();
  await expect(page.locator(`[data-testid="proposal-card"][data-quote="${loseMe}"]`)).toHaveCount(
    0,
  );

  const gone = await quote(request, loseMe);
  expect(gone).toMatchObject({
    stageKey: 'CLOSED_LOST',
    status: 'closed',
    outcome: 'lost',
    outcomeReasonCode: 'price',
  });
  expect(gone.closedAt).not.toBeNull();
  expect(gone.customerDecision.closure).toMatchObject({ reasonLabel: 'Price' });
  expect(gone.customerDecision.closure?.closureOwnerName).toBeTruthy();
});
