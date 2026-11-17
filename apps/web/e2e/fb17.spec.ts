import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// FB-17 (W13-23 to W13-28): the decision dialog's four plain choices (Advance, Send back to…, Hold,
// Stop), a send-back named by where the quote goes, a hold owned by the person who will clear it and
// readable on the timeline, and the "Why?" score popover that stays on the screen.
// (G1 "Stop: not CCQ work" and the G1 send-back are in g1.spec.ts; capital needed from the preliminary
// capital is in engineering.spec.ts, pricing.spec.ts, quoting-steps.spec.ts and final-review.spec.ts.)

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });

async function ok(res: Promise<APIResponse>, status = 200) {
  const r = await res;
  expect(r.status(), await r.text()).toBe(status);
  return r;
}

/** Provisions the persona (the e2e database is config-seeded only) and returns who it is. */
const me = async (request: APIRequestContext, persona: string) =>
  (
    (await (await request.get('/api/v1/me', { headers: as(persona) })).json()) as {
      user: { id: string; displayName: string };
    }
  ).user;

interface QuoteNow {
  stageKey: string;
  status: string;
  version: number;
  reviewDate: string | null;
  decisions: { gateKey: string; outcomeKey: string; reasonCode: string | null }[];
}
const quoteNow = async (request: APIRequestContext, qn: string) =>
  (await (await request.get(`/api/v1/quotes/${qn}`, { headers: as('kam') })).json()) as QuoteNow;

const inbox = async (request: APIRequestContext, persona: string) =>
  (
    (await (await request.get('/api/v1/notifications', { headers: as(persona) })).json()) as {
      items: { title: string; body: string }[];
    }
  ).items;

/** A qualified quote waiting in Engineering. */
async function inEngineering(request: APIRequestContext) {
  for (const p of ['kam', 'sales-leader', 'eng-lead']) await me(request, p);
  const qn = await submitQuote(request, await freeOpportunities(request, 1));
  await ok(
    request.post(`/api/v1/quotes/${qn}/gates/G1/decisions`, {
      headers: as('sales-leader'),
      data: { outcomeKey: 'advance' },
    }),
    201,
  );
  return qn;
}

/** A quote Engineering advanced into Quoting ($0 preliminary capital: no capital needed). */
async function inQuoting(request: APIRequestContext) {
  const qn = await inEngineering(request);
  const engineer = await me(request, 'engineer');
  const put = (path: string, data: unknown) =>
    ok(request.put(`/api/v1/quotes/${qn}/${path}`, { headers: as('eng-lead'), data }));
  await put('eng-review', {
    processType: 'EBM',
    machineType: 'EBM',
    plantCode: 'AURORA',
    cavitation: 8,
    cycleTimeS: 14.5,
    prelimCapitalUsd: 0,
  });
  await put('capacity-evidence', {
    rows: [
      {
        site: 'AURORA',
        assumedEffectivenessPct: 70,
        cycleTimeS: 14.5,
        utilizationBeforePct: 62,
        analysisDate: '2026-10-26',
        analystId: engineer.id,
      },
    ],
  });
  await put('capacity-signoff', { status: 'approved' });
  await ok(
    request.post(`/api/v1/quotes/${qn}/gates/G2/decisions`, {
      headers: as('eng-lead'),
      data: { outcomeKey: 'proceed' },
    }),
    201,
  );
  return qn;
}

test('G2: the engineering lead sends a quote back to the KAM with a reason', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const qn = await inEngineering(request);
  await page.setViewportSize({ width: 1366, height: 768 });
  await signInAs(page, 'eng-lead', 'light');
  await page.goto(`/quotes/${qn}?tab=engineering`);

  // The review is not finished, so the tab offers the secondary button only.
  const other = page.getByTestId('engineering-tab').getByTestId('decide-other');
  await expect(other).toHaveText('Send back, hold or stop');
  await other.click();
  const g2 = page.getByRole('dialog');
  await expect(g2.getByRole('heading', { name: 'Send back, hold or stop' })).toBeVisible();
  // Three of the four choices: Advance is not offered until the work is done.
  await expect(g2.getByRole('group', { name: 'Advance', exact: true })).toHaveCount(0);
  for (const choice of ['Send back to…', 'Hold', 'Stop']) {
    await expect(g2.getByRole('radio', { name: choice, exact: true })).toBeVisible();
  }
  // A send-back is never offered as a Hold: Hold is one outcome.
  await expect(g2.getByRole('group', { name: 'Hold', exact: true }).getByRole('radio')).toHaveCount(
    1,
  );

  // "Send back to…" is one choice; "Send to" names where the quote can go.
  await g2.getByRole('radio', { name: 'Send back to…', exact: true }).check();
  const sendTo = g2.getByLabel('Send to (required)');
  await expect(sendTo.locator('option')).toHaveText([
    'Choose who it goes to…',
    'The KAM (fix the intake)',
    'Engineering (try another platform or site)',
  ]);
  await g2.getByRole('button', { name: 'Record decision' }).click();
  await expect(g2.getByRole('alert')).toContainText('Choose who to send it back to.');
  await sendTo.selectOption({ label: 'The KAM (fix the intake)' });
  await expect(g2.getByTestId('outcome-definition')).toContainText('It goes back to the KAM');
  await expect(g2.getByText('Say what needs to change, and where.')).toBeVisible();

  // Every send-back needs a reason and a note.
  await g2.getByRole('button', { name: 'Record decision' }).click();
  await expect(g2.getByRole('alert')).toContainText('Choose a reason.');
  await expect(g2.getByRole('alert')).toContainText('Add a note.');
  await g2.getByLabel('Reason (required)').selectOption({ label: 'Missing information' });
  await g2.getByLabel('Note (required)').fill('The drawing and the volume by SKU are missing');
  expect(await seriousViolations(page)).toEqual([]);
  await g2.getByRole('button', { name: 'Record decision' }).click();
  await expect(g2).toHaveCount(0);
  await expect(page.getByText('Send back to the KAM (fix the intake) recorded')).toBeVisible();

  const quote = await quoteNow(request, qn);
  expect(quote.stageKey).toBe('INTAKE');
  expect(quote.decisions[0]).toMatchObject({
    gateKey: 'G2',
    outcomeKey: 'rework',
    reasonCode: 'missing_information',
  });
});

test('G3: the pricing lead sends a quote back to Engineering', async ({ page, request }) => {
  test.setTimeout(120_000);
  await me(request, 'pricing-lead');
  const qn = await inQuoting(request);
  await page.setViewportSize({ width: 1366, height: 768 });
  await signInAs(page, 'pricing-lead', 'dark');
  await page.goto(`/quotes/${qn}?tab=quoting`);

  await page.getByTestId('quoting-tab').getByTestId('decide-other').click();
  const g3 = page.getByRole('dialog');
  await expect(g3.getByRole('heading', { name: 'Send back, hold or stop' })).toBeVisible();
  await g3.getByRole('radio', { name: 'Send back to…', exact: true }).check();
  const sendTo = g3.getByLabel('Send to (required)');
  await expect(sendTo.locator('option')).toHaveText([
    'Choose who it goes to…',
    'Pricing (re-cost)',
    'Engineering',
    'The KAM',
    'Pricing (another capital model)',
  ]);
  await sendTo.selectOption({ label: 'Engineering' });
  await expect(g3.getByTestId('outcome-definition')).toContainText('Back to Engineering');
  await g3.getByLabel('Reason (required)').selectOption({ label: 'Missing information' });
  await g3.getByLabel('Note (required)').fill('The cavitation does not match the press');
  expect(await seriousViolations(page)).toEqual([]);
  await g3.getByRole('button', { name: 'Record decision' }).click();
  await expect(g3).toHaveCount(0);
  await expect(page.getByText('Send back to Engineering recorded')).toBeVisible();

  const quote = await quoteNow(request, qn);
  expect(quote).toMatchObject({ stageKey: 'ENG_REVIEW', status: 'active', version: 2 });
  expect(quote.decisions[0]).toMatchObject({
    gateKey: 'G3',
    outcomeKey: 'rework',
    reasonCode: 'missing_information',
  });
});

test('a hold is owned by the assigned engineer by default, who is told; the timeline reads it', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const qn = await inEngineering(request);
  const engineer = await me(request, 'engineer');
  const lead = await me(request, 'eng-lead');
  const assigned = await request.post(`/api/v1/quotes/${qn}/assignment`, {
    headers: as('eng-lead'),
    data: { engineerId: engineer.id },
  });
  expect(assigned.ok(), await assigned.text()).toBe(true);
  const reviewDate = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

  await page.setViewportSize({ width: 1366, height: 768 });
  await signInAs(page, 'eng-lead', 'light');
  await page.goto(`/quotes/${qn}?tab=engineering`);
  await page.getByTestId('engineering-tab').getByTestId('decide-other').click();
  const g2 = page.getByRole('dialog');
  await g2.getByRole('radio', { name: 'Hold', exact: true }).check();
  // What Hold is for, and what it is not for.
  await expect(g2.getByTestId('outcome-definition')).toContainText(
    'To get something fixed, use Send back to… instead.',
  );

  // The owner is the person who will clear the hold: the assigned engineer, not the decider.
  const owner = g2.getByTestId('hold-owner');
  await expect(owner.getByTestId('hold-owner-choice')).toHaveText(`Now: ${engineer.displayName}`);
  await expect(
    owner.getByRole('radio', { name: `The assigned engineer (${engineer.displayName})` }),
  ).toBeChecked();
  await expect(owner.getByRole('radio', { name: 'Me', exact: true })).not.toBeChecked();
  await expect(owner.getByRole('radio', { name: /^The KAM \(/ })).toHaveCount(1);

  await g2.getByLabel('Reason (required)').selectOption({ label: 'Awaiting internal input' });
  await g2.getByLabel('Review date (required)').fill(reviewDate);
  await g2.getByLabel('Note (required)').fill('Waiting for the press schedule from the plant');
  expect(await seriousViolations(page)).toEqual([]);
  await g2.getByRole('button', { name: 'Record decision' }).click();
  await expect(g2).toHaveCount(0);

  const held = await quoteNow(request, qn);
  expect(held).toMatchObject({ stageKey: 'ENG_REVIEW', status: 'on_hold', reviewDate });

  // The owner is told, with the review date; the KAM's notice names the owner and the reason.
  const mine = (await inbox(request, 'engineer')).find(
    (n) => n.title.includes(qn) && n.title.includes('you own the hold'),
  );
  expect(mine?.body).toContain(`Review date: ${reviewDate}.`);
  const forKam = (await inbox(request, 'kam')).find(
    (n) => n.title.includes(qn) && n.title.includes('was put on hold'),
  );
  expect(forKam?.body).toContain(`Owner: ${engineer.displayName}.`);
  expect(forKam?.body).toContain('Reason: Awaiting internal input.');
  expect(forKam?.body).toContain(`Review date: ${reviewDate}.`);

  // The quote header and the timeline read the same: why, who owns it, when it is reviewed (UX-012: the
  // timeline is on Overview; without ?tab= the engineering lead opens this quote on Engineering).
  await page.goto(`/quotes/${qn}?tab=overview`);
  const sentence = `On hold: Awaiting internal input. Owner: ${engineer.displayName}. Review by`;
  await expect(page.getByTestId('quote-status')).toContainText(sentence);
  const timeline = page.getByTestId('quote-timeline');
  const entry = timeline.getByTestId('timeline-item').filter({ hasText: 'On hold:' });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText(sentence);
  await expect(entry).toContainText('Waiting for the press schedule from the plant');
  await expect(entry).toContainText(lead.displayName); // who placed it
  expect(await seriousViolations(page)).toEqual([]);

  // The next decision ends the hold, and the timeline says who ended it and how. A send-back to
  // Engineering keeps the quote in the stage, and needs a reason like every send-back.
  await ok(
    request.post(`/api/v1/quotes/${qn}/gates/G2/decisions`, {
      headers: as('eng-lead'),
      data: {
        outcomeKey: 'redirect',
        reasonCode: 'missing_information',
        note: 'Try the Bethlehem line instead',
      },
    }),
    201,
  );
  await page.reload();
  const ended = timeline.getByTestId('timeline-item').filter({ hasText: 'Hold ended:' });
  await expect(ended).toContainText(
    `Hold ended: ${lead.displayName} recorded “Send back to Engineering (try another platform or site)”`,
  );
  expect((await quoteNow(request, qn)).status).toBe('active');
});

for (const theme of ['light', 'dark'] as const) {
  test(`the four choices fit a laptop and a phone (${theme})`, async ({ page, request }) => {
    test.setTimeout(90_000);
    for (const p of ['kam', 'sales-leader']) await me(request, p);
    const leader = await me(request, 'sales-leader');
    const qn = await submitQuote(request, await freeOpportunities(request, 1));
    await signInAs(page, 'sales-leader', theme);
    for (const size of [
      { width: 1366, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await page.goto('/approvals?gate=G1');
      const card = page.locator(`[data-testid="queue-item"][data-quote="${qn}"]`);
      await card.getByRole('button', { name: `Decide ${qn}` }).click();
      const dialog = page.getByRole('dialog');
      // Advance, Send back to…, Hold, Stop, in that order; "not CCQ work" sits under Stop.
      await expect(dialog.getByRole('radio', { name: 'Advance', exact: true })).toBeVisible();
      const choices = await dialog
        .getByRole('radio')
        .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
      expect(choices).toEqual([
        'Advance',
        'Send back to…',
        'Hold',
        'Stop: not CCQ work (send elsewhere)',
        'Stop',
      ]);
      await expect(
        dialog.getByRole('group', { name: 'Stop', exact: true }).getByRole('radio'),
      ).toHaveCount(2);
      await dialog.getByRole('radio', { name: 'Send back to…', exact: true }).check();
      await expect(dialog.getByLabel('Send to (required)')).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
      // At G1 nobody is assigned yet, so the hold owner starts as the decider.
      await dialog.getByRole('radio', { name: 'Hold', exact: true }).check();
      await expect(dialog.getByTestId('send-to')).toHaveCount(0);
      await expect(dialog.getByTestId('hold-owner-choice')).toHaveText(
        `Now: ${leader.displayName} (me)`,
      );
      expect(await seriousViolations(page)).toEqual([]);
      // Nothing runs off the side of the screen.
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }
  });
}

// W13-28: on a laptop the score breakdown ran off the bottom of the screen. 1366 × 657 is a 768 px
// laptop with the browser chrome and a taskbar.
test('the "Why?" score popover stays on the screen and scrolls inside', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  for (const p of ['kam', 'sales-leader']) await me(request, p);
  const qn = await submitQuote(request, await freeOpportunities(request, 1));
  await signInAs(page, 'sales-leader');
  for (const size of [
    { width: 1366, height: 768 },
    { width: 1366, height: 657 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('/approvals?gate=G1');
    const card = page.locator(`[data-testid="queue-item"][data-quote="${qn}"]`);
    await card.getByRole('button', { name: `Why this priority? ${qn}` }).click();
    const why = page.getByTestId('why-priority');
    await expect(why.getByTestId('score-breakdown')).toContainText('Capital exposure');
    // The whole popover is on the screen…
    await expect(why).toBeInViewport({ ratio: 1 });
    // …and its last line can be reached by scrolling inside it.
    const breakdown = why.getByRole('group', { name: 'Score breakdown' });
    await breakdown.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(breakdown.getByText('Advisory only')).toBeInViewport({ ratio: 1 });
    await expect(why).toBeInViewport({ ratio: 1 });
    expect(await seriousViolations(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(why).toHaveCount(0);
  }
});
