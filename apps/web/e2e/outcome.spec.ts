import { expect, test, type APIRequestContext } from '@playwright/test';

import { seriousViolations } from './axe';
import { as, centralToday, quoteInCustomerDecision } from './customer-decision';
import { signInAs } from './personas';

// B-13 / B-26: a KAM works "My open proposals": records one quote as Awarded (acceptance evidence +
// date), which moves it to Stage 6 (Commit & Hand Off); fills in the hand-off record (CER status and
// ID, receiving role), marks the hand-off accepted and closes it Won at G6; then records another as
// Lost with a reason. Both close with outcome + reason + owner + date. The quotes are taken to Customer
// Decision through the API (the earlier stages have their own specs).

const quote = async (request: APIRequestContext, quoteNumber: string) =>
  (await (await request.get(`/api/v1/quotes/${quoteNumber}`, { headers: as('kam') })).json()) as {
    stageKey: string;
    status: string;
    outcome: string | null;
    outcomeReasonCode: string | null;
    closedAt: string | null;
    customerDecision: {
      closure: { closureOwnerName: string | null; reasonLabel: string | null } | null;
      handoff: {
        cerId: string | null;
        cerStatus: string;
        completed: boolean;
        cerReady: boolean;
      } | null;
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
  await page.getByRole('button', { name: 'Record customer decision' }).click();
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
  // F-064: after the award the capital quoted was budgetary; "Ready for CER development" is ticked here.
  await expect(handoff.getByTestId('cer-ready-badge')).toHaveCount(0);
  await handoff.getByRole('checkbox', { name: /Ready for CER development/ }).check();
  await handoff.getByRole('button', { name: 'Save hand-off' }).click();
  await expect(page.getByText('Hand-off accepted').first()).toBeVisible();
  await expect(handoff.getByTestId('cer-ready-badge')).toHaveText('Ready for CER development');
  await expect(handoff.getByTestId('cer-ready-by')).toContainText('Marked ready by');
  await expect(handoff.getByTestId('handoff-completed-by')).toContainText('Confirmed by');

  // ── G6: commit and close Won ──
  await page.getByRole('button', { name: 'Commit and hand off' }).click();
  const g6 = page.getByRole('dialog');
  await g6.getByRole('radio', { name: 'Advance (close Won)' }).check();
  await expect(g6.getByTestId('outcome-definition')).toBeVisible();
  await expect(g6.getByTestId('completeness')).toContainText('Nothing missing');
  // DR-kam-sales-leader-02: the acceptance evidence G5 recorded is offered, not asked for again.
  await expect(g6.getByLabel(/^Reason/)).not.toHaveValue('');
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
    cerReady: true,
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
