import { fileURLToPath } from 'node:url';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { as, ok } from './customer-decision';
import { signInAs } from './personas';
import { freeOpportunities, isoDaysFromNow, submitQuote } from './quotes';

/**
 * The quote header, as approved in docs/audit/03-ux-proposals.md (2026-11-17): UX-002 (whose move it
 * is), UX-003, UX-006, UX-011, UX-013, UX-014 and UX-015. Each test builds its quote through the API
 * and reads the page as the persona the proposal is about.
 */

/** With AUDIT_SCREENS=1, saves the page (or one part of it) as the proposal's screenshot. */
async function auditScreen(page: Page, id: string, testId?: string) {
  if (process.env.AUDIT_SCREENS !== '1') return;
  const path = fileURLToPath(new URL(`../../../docs/audit/screens/${id}.png`, import.meta.url));
  if (testId) await page.getByTestId(testId).screenshot({ path });
  else await page.screenshot({ path });
}

/** A persona's user (created on its first request). */
async function me(request: APIRequestContext, persona: string) {
  const res = await ok(request.get('/api/v1/me', { headers: as(persona) }));
  return ((await res.json()) as { user: { id: string; displayName: string } }).user;
}

const decide = (
  request: APIRequestContext,
  quoteNumber: string,
  gate: string,
  persona: string,
  data: Record<string, unknown>,
) =>
  ok(
    request.post(`/api/v1/quotes/${quoteNumber}/gates/${gate}/decisions`, {
      headers: as(persona),
      data,
    }),
    201,
  );

/** Submitted by the KAM persona, then sent back at G1 with a reason and a note. */
async function reworkedQuote(request: APIRequestContext): Promise<string> {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  await decide(request, quoteNumber, 'G1', 'sales-leader', {
    outcomeKey: 'rework',
    reasonCode: 'missing_information',
    note: 'Add the target neck finish',
  });
  return quoteNumber;
}

test.describe('UX-002: whose move it is, under the stage tracker', () => {
  test('back for rework: the KAM is told it is their move and gets the way in', async ({
    page,
    request,
  }) => {
    const quoteNumber = await reworkedQuote(request);
    const kam = await me(request, 'kam');

    await signInAs(page, 'kam');
    await page.goto(`/quotes/${quoteNumber}`);
    const line = page.getByTestId('quote-next-step');
    await expect(line).toHaveAttribute('data-state', 'rework');
    await expect(line).toContainText('Waiting on you. Next: fix the intake and resubmit.');
    // One way in, on the line (the banner below says what to fix).
    await expect(page.getByRole('button', { name: 'Fix and resubmit' })).toHaveCount(1);
    await auditScreen(page, 'UX-002');

    // Someone else reading the same quote sees who it waits on, by name, and no button.
    const other = await page.context().browser()!.newPage();
    await signInAs(other, 'eng-lead');
    await other.goto(`/quotes/${quoteNumber}`);
    await expect(other.getByTestId('quote-next-step')).toHaveText(
      `Waiting on: the KAM (${kam.displayName}). Next: fix the intake and resubmit.`,
    );
    await expect(other.getByRole('button', { name: 'Fix and resubmit' })).toHaveCount(0);
    await other.close();

    await line.getByRole('button', { name: 'Fix and resubmit' }).click();
    await expect(page.getByTestId('rework-notice')).toContainText(`Rework of ${quoteNumber}`);
  });

  test('unassigned in Engineering: the engineering lead is sent to the Engineering tab', async ({
    page,
    request,
  }) => {
    const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
    await decide(request, quoteNumber, 'G1', 'sales-leader', { outcomeKey: 'advance' });

    await signInAs(page, 'eng-lead');
    await page.goto(`/quotes/${quoteNumber}`);
    const line = page.getByTestId('quote-next-step');
    await expect(line).toHaveAttribute('data-state', 'unassigned');
    await expect(line).toContainText('Waiting on you. Next: assign an engineer.');
    await line.getByRole('link', { name: 'Open the Engineering tab' }).click();
    await expect(page).toHaveURL(/tab=engineering/);
    await expect(page.getByRole('button', { name: 'Assign engineer' })).toBeVisible();
    // On the tab already: nothing left to open.
    await expect(line.getByRole('link')).toHaveCount(0);

    // The KAM reads who it waits on, and is offered nothing.
    const kam = await page.context().browser()!.newPage();
    await signInAs(kam, 'kam');
    await kam.goto(`/quotes/${quoteNumber}`);
    await expect(kam.getByTestId('quote-next-step')).toHaveText(
      'Waiting on: the engineering lead. Next: assign an engineer.',
    );
    await kam.close();
  });

  test('on hold: the line is the hold sentence, and says whose decision ends it', async ({
    page,
    request,
  }) => {
    const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
    const owner = await me(request, 'sales-leader');
    await decide(request, quoteNumber, 'G1', 'sales-leader', {
      outcomeKey: 'hold',
      reasonCode: 'awaiting_customer_info',
      note: 'Customer is confirming the volume',
      holdUntil: isoDaysFromNow(14),
      holdOwnerId: owner.id,
    });

    await signInAs(page, 'kam');
    await page.goto(`/quotes/${quoteNumber}`);
    const line = page.getByTestId('quote-next-step');
    await expect(line).toHaveAttribute('data-state', 'on_hold');
    await expect(line).toContainText(
      `On hold: Awaiting customer information. Owner: ${owner.displayName}. Review by`,
    );
    await expect(line).toContainText('A decision by the sales leader ends the hold.');
    // Said once: the sentence is not repeated beside the stage badge.
    await expect(
      page
        .getByRole('region', { name: 'Stage and priority' })
        .getByText(/On hold: Awaiting customer information/),
    ).toHaveCount(1);
  });
});

test.describe('UX-003: no decision is offered on a quote that is not waiting for one', () => {
  test('a sales leader on a reworked quote is told there is nothing to decide', async ({
    page,
    request,
  }) => {
    const quoteNumber = await reworkedQuote(request);

    await signInAs(page, 'sales-leader');
    await page.goto(`/quotes/${quoteNumber}`);
    const line = page.getByTestId('quote-next-step');
    // One sentence, in US Central with the zone named, in place of the decision button.
    await expect(line).toHaveText(
      /^Back with the KAM for rework since [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M C[SD]T\. Nothing to decide until it is resubmitted\.$/,
    );
    await expect(line.getByTestId('nothing-to-decide')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Qualify quote' })).toHaveCount(0);
    await auditScreen(page, 'UX-003');
  });

  test('the decision stays wherever one is possible: submitted, and on hold', async ({
    page,
    request,
  }) => {
    const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));

    await signInAs(page, 'sales-leader');
    await page.goto(`/quotes/${quoteNumber}`);
    await expect(page.getByTestId('quote-next-step')).toHaveText(
      'Waiting on you. Next: qualify quote.',
    );
    await expect(page.getByRole('button', { name: 'Qualify quote' })).toBeVisible();
    await expect(page.getByTestId('nothing-to-decide')).toHaveCount(0);

    // On hold, a decision is still possible (it is what ends the hold): the button stays.
    const owner = await me(request, 'sales-leader');
    await decide(request, quoteNumber, 'G1', 'sales-leader', {
      outcomeKey: 'hold',
      reasonCode: 'awaiting_customer_info',
      note: 'Customer is confirming the volume',
      holdUntil: isoDaysFromNow(14),
      holdOwnerId: owner.id,
    });
    await page.reload();
    await expect(page.getByTestId('quote-next-step')).toHaveAttribute('data-state', 'on_hold');
    await expect(page.getByRole('button', { name: 'Qualify quote' })).toBeVisible();
    await expect(page.getByTestId('nothing-to-decide')).toHaveCount(0);
  });
});

test('UX-006: the Gate decisions card shows the reason’s label, not its stored key', async ({
  page,
  request,
}) => {
  const quoteNumber = await reworkedQuote(request);

  await signInAs(page, 'kam');
  await page.goto(`/quotes/${quoteNumber}`);
  const decisions = page.getByTestId('decisions');
  await expect(decisions.getByTestId('decision-reason')).toHaveText('Reason: Missing information');
  await expect(decisions).not.toContainText('missing_information');
  await decisions.scrollIntoViewIfNeeded();
  await auditScreen(page, 'UX-006');
});

/** Qualified, then engineered and advanced by the engineering lead: in Quoting, Engineering locked. */
async function quoteInQuoting(request: APIRequestContext): Promise<string> {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  const put = (path: string, data: unknown) =>
    ok(request.put(`/api/v1/quotes/${quoteNumber}/${path}`, { headers: as('eng-lead'), data }));
  await decide(request, quoteNumber, 'G1', 'sales-leader', { outcomeKey: 'advance' });
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
        analysisDate: isoDaysFromNow(-1),
        analystId: (await me(request, 'engineer')).id,
      },
    ],
  });
  await put('capacity-signoff', { status: 'approved' });
  await decide(request, quoteNumber, 'G2', 'eng-lead', { outcomeKey: 'proceed' });
  return quoteNumber;
}

test('UX-011: one clock on the quote page, whatever the browser’s zone and language', async ({
  browser,
  request,
}) => {
  // "Nov 17, 2026, 12:13 PM CST": US Central with the zone named, as everywhere else in the app.
  const CENTRAL = /[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M C[SD]T/;
  // What a German browser in Tokyo used to show: "18.11.2026, 03:13:49".
  const BROWSER_LOCAL = /\d{1,2}\.\d{1,2}\.\d{4}/;
  const reworked = await reworkedQuote(request);
  const inQuoting = await quoteInQuoting(request);

  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'de-DE' });
  const page = await context.newPage();
  await signInAs(page, 'kam');

  // The rework banner and the Gate decisions card.
  await page.goto(`/quotes/${reworked}`);
  for (const testId of ['rework-banner', 'decisions']) {
    await expect(page.getByTestId(testId)).toContainText(CENTRAL);
    await expect(page.getByTestId(testId)).not.toContainText(BROWSER_LOCAL);
  }
  await auditScreen(page, 'UX-011');

  // The Intake card's "Submitted", and the line a locked section shows.
  await page.goto(`/quotes/${inQuoting}`);
  await expect(page.locator('div:has(> dt:text-is("Submitted")) > dd')).toHaveText(
    new RegExp(`^${CENTRAL.source}$`),
  );
  await page.goto(`/quotes/${inQuoting}?tab=engineering`);
  const lock = page.getByTestId('engineering-tab').getByTestId('section-lock').first();
  await expect(lock).toContainText(
    new RegExp(`decided by .+ on ${CENTRAL.source} · reopens if the quote is sent back`),
  );
  await context.close();
});

test('UX-013: plain words in the quote header: who returned it, entries, priority, Salesforce', async ({
  page,
  request,
}) => {
  const quoteNumber = await reworkedQuote(request);
  const leader = await me(request, 'sales-leader');

  await signInAs(page, 'kam');
  await page.goto(`/quotes/${quoteNumber}`);

  // The rework banner names who returned it and the gate by its configured label, not "G1".
  const banner = page.getByTestId('rework-banner');
  await expect(banner).toContainText(`Returned by ${leader.displayName} at Qualify & prioritize`);
  await expect(banner).toContainText('Reason: Missing information');
  await expect(banner).toContainText('What to fix: Add the target neck finish');
  await expect(banner).not.toContainText('G1');

  // Time in stage: back in Intake a second time.
  const times = page.getByTestId('stage-times');
  await expect(times).toContainText('entered this stage twice');
  await expect(times).not.toContainText('visits');

  // The number and the tier are labelled.
  await expect(page.getByTestId('quote-priority')).toContainText(
    /Priority\s*\d+\s*(Critical|High|Standard|Low)/,
  );

  // No Salesforce URL set in this environment: the ID, with its label.
  const labelled = page.getByTestId('sf-opportunity-labelled');
  await expect(labelled).toContainText('Salesforce opportunity');
  await expect(labelled.getByTestId('sf-opportunity-plain')).toHaveText(/^006\w+$/);
  await auditScreen(page, 'UX-013');

  // With the URL the quote carries (set by an Admin; fb04.spec.ts covers the setting itself), the
  // label is the link. The response is given a URL here so the shared setting is left alone.
  const href = 'https://example.lightning.force.com/lightning/r/Opportunity/006X/view';
  await page.route(`**/api/v1/quotes/${quoteNumber}`, async (route) => {
    const response = await route.fetch();
    const json = { ...((await response.json()) as object), sfOpportunityUrl: href };
    await route.fulfill({ response, json });
  });
  await page.reload();
  const link = page.locator('main header').getByRole('link', { name: 'Salesforce opportunity' });
  await expect(link).toHaveText('Salesforce opportunity ↗');
  await expect(link).toHaveAttribute('href', href);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(page.getByTestId('sf-opportunity-labelled')).toHaveCount(0);
});

test('UX-014: a quote that cannot be opened says why it might be, and offers the way back', async ({
  page,
  request,
}) => {
  const sentence = (quoteNumber: string) =>
    `We could not find ${quoteNumber}, or it is outside what your role can see.`;

  // A number that does not exist.
  await signInAs(page, 'kam');
  await page.goto('/quotes/CCQ-2026-99999');
  const notFound = page.getByTestId('quote-not-found');
  await expect(notFound).toContainText(sentence('CCQ-2026-99999'));
  await expect(notFound).toContainText('Check the number, or search from the Pipeline.');
  // The request reference for support, in small print; never the API path.
  await expect(notFound).toContainText(/Reference for support: \S+/);
  await expect(notFound).not.toContainText('/api/');
  await expect(page.getByText('Not found', { exact: true })).toHaveCount(0);
  await auditScreen(page, 'UX-014');

  // A quote that exists but is outside the reader's scope reads exactly the same: the page does not
  // say which of the two it is. (`kam-owner` sees only the quotes they own.)
  const someoneElses = await submitQuote(request, await freeOpportunities(request, 1));
  const other = await page.context().browser()!.newPage();
  await signInAs(other, 'kam-owner');
  await other.goto(`/quotes/${someoneElses}`);
  const outOfScope = other.getByTestId('quote-not-found');
  await expect(outOfScope).toContainText(sentence(someoneElses));
  await expect(outOfScope).toContainText('Check the number, or search from the Pipeline.');
  await other.close();

  await notFound.getByRole('link', { name: 'Go to the Pipeline' }).click();
  await expect(page).toHaveURL(/\/quotes$/);
});
