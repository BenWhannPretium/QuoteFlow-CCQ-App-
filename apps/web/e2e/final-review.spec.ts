import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// B-12: an Approver on a 390 px phone works the Final Review queue: opens a quote's one-page review,
// approves it (the proposal issue and validity dates are set, the quote moves to Customer Decision),
// then opens another and declines it (note + reason code; it closes as Declined). Neither decision
// awards or loses the quote. The quotes are created, qualified, engineered and priced through the API
// (those stages have their own specs); this spec is the Final Review screen. It runs in the `mobile`
// project (390 × 844, touch).

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });

async function ok(res: Promise<APIResponse>, status = 200) {
  const r = await res;
  expect(r.status(), await r.text()).toBe(status);
  return r;
}

/** Qualified, engineered and priced: submitted by Pricing to Final Review (G3). Returns the quote number. */
async function quoteInFinalReview(
  request: APIRequestContext,
  engineerId: string,
  pricingId: string,
  g2: 'proceed' | 'capital_required',
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
    prelimCapitalUsd: 420000,
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
  // B-26: the capacity owner signs off before G2.
  await put('capacity-signoff', 'eng-lead', { status: 'approved' });
  await post('gates/G2/decisions', 'eng-lead', { outcomeKey: g2 });
  await put('pricing-record', 'pricing', {
    approvedBy: pricingId,
    pricingBasisNote: 'March CDI, FOB Chicago',
    approvedRangeNote: 'Hold the list price; floor per Gemma',
    erfRefs: ['48213'],
    costingCompleted: true,
  });
  await put('capital-readiness', 'pricing', {
    capitalReadiness: g2 === 'capital_required' ? 'pending' : 'pre_approved',
    ...(g2 === 'capital_required'
      ? { capitalPendingJustification: 'CER goes to the board Nov 10' }
      : {}),
  });
  await post('gates/G3/decisions', 'pricing', { outcomeKey: 'submit' });
  // B-26: the KAM checks the terms before the offer can be released at G4.
  await put('terms', 'kam', {
    termsPaymentTerms: 'Net 45',
    termsToolingCommitment: false,
    checked: true,
  });
  return quoteNumber;
}

const quote = async (request: APIRequestContext, quoteNumber: string, persona = 'kam') =>
  (await (await request.get(`/api/v1/quotes/${quoteNumber}`, { headers: as(persona) })).json()) as {
    stageKey: string;
    status: string;
    outcome: string | null;
    proposalIssuedAt: string | null;
    validityUntil: string | null;
  };

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('an Approver approves one quote and declines another from a phone', async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  // Provision the personas the flow names or notifies (the e2e database is config-seeded only).
  for (const p of ['approver', 'kam', 'pricing', 'eng-lead', 'sales-leader']) {
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

  const approveMe = await quoteInFinalReview(request, engineerId, pricingId, 'proceed');
  const declineMe = await quoteInFinalReview(request, engineerId, pricingId, 'capital_required');

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await signInAs(page, 'approver');

  // ── The queue: cards, not a table ──
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).locator('[data-nav="approvals"]').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Final Review' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Final Review' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // An Approver has no "To qualify" or "Overrides" tab (those are the sales leader's).
  await expect(page.getByTestId('approvals-tab-to-qualify')).toHaveCount(0);
  await expect(page.getByTestId('approvals-tab-overrides')).toHaveCount(0);

  await page.getByLabel('Search Final Review').fill(declineMe);
  const risky = page.locator(`[data-testid="final-review-item"][data-quote="${declineMe}"]`);
  await expect(risky).toHaveCount(1);
  await expect(risky.getByTestId('g2-outcome')).toHaveText('Advance – capital required');
  await expect(risky.getByTestId('capital-readiness')).toHaveText('Pending');
  await expect(risky.getByTestId('approval-status')).toContainText('Approved');
  await expect(risky.getByTestId('waiting')).toContainText('Waiting');
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByLabel('Search Final Review').fill(approveMe);
  const card = page.locator(`[data-testid="final-review-item"][data-quote="${approveMe}"]`);
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId('g2-outcome')).toHaveText('Advance');
  await expect(card.getByTestId('capital-readiness')).toHaveText('Pre-approved');

  // ── The review: one page, the decision bar stays in reach ──
  await card.getByRole('link', { name: `Review & decide ${approveMe}` }).click();
  await expect(page).toHaveURL(new RegExp(`/quotes/${approveMe}/review`));
  const review = page.getByTestId('review-screen');
  await expect(review).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: approveMe })).toBeVisible();
  await expect(page.getByTestId('review-price-status')).toContainText('Price approved');
  await expect(page.getByTestId('review-engineering')).toContainText('EBM');
  await expect(page.getByTestId('review-capacity')).toContainText('70%');
  await expect(page.getByTestId('review-pricing')).toContainText('March CDI, FOB Chicago');
  await expect(page.getByTestId('review-pricing')).toContainText('Hold the list price');
  await expect(page.getByTestId('review-capital')).toContainText('Pre-approved');
  await expect(page.getByTestId('review-attachments')).toContainText('No files are attached');
  await expect(page.getByTestId('review-decisions')).toContainText('G3');
  await expect(page.getByTestId('full-timeline-link')).toBeVisible();
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
  expect(await seriousViolations(page)).toEqual([]);

  // The sticky bar is on screen above the tab bar without scrolling, and so is it after scrolling down.
  const bar = page.getByTestId('decision-bar');
  await expect(bar).toBeInViewport({ ratio: 1 });
  await page.mouse.wheel(0, 4000);
  await expect(bar).toBeInViewport({ ratio: 1 });
  for (const name of [
    'Advance (release the offer)',
    'Hold',
    'Stop (withdraw)',
    'Rework (back to the affected gate)',
  ]) {
    const box = (await bar.getByRole('button', { name, exact: true }).boundingBox())!;
    expect(box.height, `${name} tap target height`).toBeGreaterThanOrEqual(44);
    expect(box.width, `${name} tap target width`).toBeGreaterThanOrEqual(44);
  }

  // ── Approve ──
  await bar.getByRole('button', { name: 'Advance (release the offer)', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('release-dates')).toContainText('does not award the quote');
  await expect(dialog.getByTestId('validity-preview')).toContainText(
    /Valid until \d{4}-\d{2}-\d{2}/,
  );
  expect(await seriousViolations(page)).toEqual([]);
  await dialog.getByRole('button', { name: 'Record decision' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Advance (release the offer) recorded')).toBeVisible();
  await expect(page).toHaveURL(/\/approvals\?tab=final-review/);

  // Customer Decision, with the proposal dates; not Awarded, not Lost, still open.
  const approved = await quote(request, approveMe);
  expect(approved).toMatchObject({
    stageKey: 'CUSTOMER_DECISION',
    status: 'active',
    outcome: null,
  });
  expect(approved.proposalIssuedAt).not.toBeNull();
  expect(approved.validityUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // The KAM is told to issue the proposal.
  const inbox = (await (
    await request.get('/api/v1/notifications', { headers: as('kam') })
  ).json()) as {
    items: { title: string; body: string }[];
  };
  expect(inbox.items.find((n) => n.title.includes(approveMe))?.body).toContain(
    'Approved; issue the proposal.',
  );
  // It left the queue.
  await page.getByLabel('Search Final Review').fill(approveMe);
  await expect(page.getByTestId('final-review-item')).toHaveCount(0);

  // ── Decline the other one: a note and a reason are required ──
  await page.goto(`/quotes/${declineMe}/review`);
  await expect(page.getByTestId('review-warnings')).toContainText(
    'Engineering flagged capital as required',
  );
  await expect(page.getByTestId('review-warnings')).toContainText('Capital is still pending');
  await page
    .getByTestId('decision-bar')
    .getByRole('button', { name: 'Stop (withdraw)', exact: true })
    .click();
  const decline = page.getByRole('dialog');
  await expect(decline.getByRole('radio', { name: 'Stop (withdraw)' })).toBeChecked();
  // Declining closes the quote: say so, and no release dates are offered.
  await expect(decline.getByText('Closes the quote')).toBeVisible();
  await expect(decline.getByTestId('release-dates')).toHaveCount(0);
  await decline.getByRole('button', { name: 'Record decision' }).click();
  await expect(decline.getByRole('alert')).toContainText('Choose a reason.');
  await expect(decline.getByRole('alert')).toContainText('Add a note.');
  await decline.getByLabel(/^Reason/).selectOption({ label: 'Capital not approved' });
  await decline
    .getByLabel(/^Note/)
    .fill('The CER is not approved and the volume does not carry it.');
  expect(await seriousViolations(page)).toEqual([]);
  await decline.getByRole('button', { name: 'Record decision' }).click();
  await expect(decline).toHaveCount(0);
  await expect(page.getByText('Stop (withdraw) recorded')).toBeVisible();

  const declined = await quote(request, declineMe);
  expect(declined).toMatchObject({ stageKey: 'DECLINED', status: 'closed', outcome: 'declined' });
  expect(declined.proposalIssuedAt).toBeNull();
  // The KAM is told, and a closed quote shows no decision bar.
  const kamInbox = (await (
    await request.get('/api/v1/notifications', { headers: as('kam') })
  ).json()) as {
    items: { title: string }[];
  };
  expect(kamInbox.items.some((n) => n.title === `${declineMe} was declined at Final Review`)).toBe(
    true,
  );
  await page.goto(`/quotes/${declineMe}/review`);
  await expect(page.getByTestId('not-in-final-review')).toBeVisible();
  await expect(page.getByTestId('decision-unavailable')).toContainText('No decision is waiting');
  await expect(
    page.getByRole('button', { name: 'Advance (release the offer)', exact: true }),
  ).toHaveCount(0);
});

test('a KAM cannot reach the approvals queue, and a reader of the review cannot decide', async ({
  browser,
  request,
}) => {
  await request.get('/api/v1/me', { headers: as('leadership') });
  const kam = await (await browser.newContext()).newPage();
  await signInAs(kam, 'kam');
  await kam.goto('/approvals');
  await expect(kam.getByTestId('forbidden')).toBeVisible();

  // Leadership reads the Final Review queue; it has no decision to take.
  const lead = await (await browser.newContext()).newPage();
  await signInAs(lead, 'leadership');
  await lead.goto('/approvals');
  await expect(lead.getByRole('heading', { level: 1, name: 'Final Review' })).toBeVisible();
  await expect(lead.getByTestId('final-review-counts')).not.toContainText('You can decide');
  expect(await seriousViolations(lead)).toEqual([]);
});
