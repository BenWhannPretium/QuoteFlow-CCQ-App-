import { expect, test, type APIRequestContext } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';

// B-08: a SalesLeader works the "To qualify" (G1) queue: qualifies one quote and redirects another.
// The quotes are created through the API as the KAM (the intake UI has its own spec).

const DEV_USER_HEADER = 'x-dev-user';
const asKam = { [DEV_USER_HEADER]: 'kam' };

async function freeOpportunities(request: APIRequestContext, count: number): Promise<string[]> {
  const found = new Set<string>();
  for (const q of ['Bottle', 'Jar', 'Closure', 'Preform', 'Tub', 'Pack', 'Container']) {
    const res = await request.get(
      `/api/v1/salesforce/opportunities?q=${q}&mine=false&openOnly=true&limit=50`,
      { headers: asKam },
    );
    expect(res.ok(), await res.text()).toBe(true);
    const body = (await res.json()) as {
      items: { id: string; accountId: string | null; activeQuote: unknown }[];
    };
    for (const o of body.items) if (!o.activeQuote && o.accountId) found.add(o.id);
    if (found.size >= count + 5) break;
  }
  // Shuffle a little so parallel / repeated runs don't race for the same opportunity.
  return [...found].sort(() => Math.random() - 0.5).slice(0, count + 5);
}

/** Creates and submits an intake as the KAM; returns the quote number (waiting for G1). */
async function submitQuote(
  request: APIRequestContext,
  candidates: string[],
  over: Record<string, unknown> = {},
): Promise<string> {
  while (candidates.length > 0) {
    const id = candidates.shift()!;
    const detail = await request.get(`/api/v1/salesforce/opportunities/${id}`, { headers: asKam });
    const sf = (await detail.json()) as {
      opportunity: {
        name: string;
        accountId: string;
        accountName: string;
        closeDate: string | null;
      };
      account: { id: string; name: string } | null;
    };
    const shipTo = {
      line1: '1 Test Way',
      city: 'St. Louis',
      state: 'MO',
      postal: '63101',
      country: 'US',
    };
    const draft = await request.post('/api/v1/quotes/drafts', {
      headers: asKam,
      data: {
        data: {
          sfOpportunityId: id,
          sfOpportunityName: sf.opportunity.name,
          customer: {
            status: 'existing',
            sfAccountId: sf.account?.id ?? sf.opportunity.accountId,
            name: sf.account?.name ?? sf.opportunity.accountName,
          },
          shipTo,
          shipToDefault: shipTo,
          requestClass: 'CCQ',
          productFamily: 'BOTTLE',
          components: ['CONTAINER'],
          market: 'FOOD',
          resin: 'HDPE',
          packagingType: 'BULK',
          estAnnualVolume: 750_000,
          estAnnualRevenue: 150_000,
          expectedCloseDate: sf.opportunity.closeDate,
          drawingStatus: 'HAVE_DRAWING',
          ...over,
        },
      },
    });
    expect(draft.status(), await draft.text()).toBe(201);
    const { id: draftId } = (await draft.json()) as { id: string };
    const submit = await request.post(`/api/v1/quotes/drafts/${draftId}/submit`, {
      headers: asKam,
    });
    if (submit.status() === 409) continue; // someone else took this opportunity
    expect(submit.status(), await submit.text()).toBe(201);
    return ((await submit.json()) as { quoteNumber: string }).quoteNumber;
  }
  throw new Error('no free Salesforce opportunity for the G1 spec');
}

test('a SalesLeader qualifies one quote and redirects another from the G1 queue', async ({
  page,
  request,
}) => {
  const candidates = await freeOpportunities(request, 2);
  const toAdvance = await submitQuote(request, candidates);
  const toRedirect = await submitQuote(request, candidates, { requestClass: 'STOCK' });

  await signInAs(page, 'sales-leader');
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).locator('[data-nav="qualify"]').click();
  await expect(page).toHaveURL(/\/approvals\?gate=G1/);
  await expect(page.getByRole('heading', { level: 1, name: 'To qualify' })).toBeVisible();

  // Both quotes are listed with an advisory score, a tier and the request class.
  const advanceCard = page.locator(`[data-testid="queue-item"][data-quote="${toAdvance}"]`);
  const redirectCard = page.locator(`[data-testid="queue-item"][data-quote="${toRedirect}"]`);
  await expect(advanceCard).toBeVisible();
  await expect(redirectCard.getByTestId('request-class')).toContainText('Stock');
  await expect(advanceCard.getByRole('img', { name: /^Priority score \d+/ })).toBeVisible();

  // "Why this priority?" explains the score attribute by attribute.
  await advanceCard.getByRole('button', { name: `Why this priority? ${toAdvance}` }).click();
  const breakdown = page.getByTestId('score-breakdown');
  await expect(breakdown).toContainText('Capital exposure');
  await expect(breakdown).toContainText('unknown until Engineering Review');
  expect(await seriousViolations(page)).toEqual([]);
  await page.keyboard.press('Escape');

  // Qualify (Advance) the first one.
  const decide = advanceCard.getByRole('button', { name: `Decide ${toAdvance}` });
  await decide.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('completeness')).toContainText('Intake complete');
  await dialog.getByRole('button', { name: 'Record decision' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Choose a decision.');
  expect(await seriousViolations(page)).toEqual([]);
  await dialog.getByRole('radio', { name: 'Advance' }).check();
  await dialog.getByLabel('Note (optional)').fill('Good fit for the Midwest plants');
  await dialog.getByRole('button', { name: 'Record decision' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(`${toAdvance} is now in Engineering Review`)).toBeVisible();
  await expect(advanceCard).toHaveCount(0);

  // Redirect the second: a reason is required.
  await redirectCard.getByRole('button', { name: `Decide ${toRedirect}` }).click();
  await dialog.getByRole('radio', { name: 'Redirect' }).check();
  await dialog.getByRole('button', { name: 'Record decision' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Choose a reason.');
  await dialog.getByLabel('Reason (required)').selectOption({ label: 'Stock item' });
  await dialog.getByRole('button', { name: 'Record decision' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(redirectCard).toHaveCount(0);

  // The quote pages show the outcomes and the decisions.
  await page.goto(`/quotes/${toRedirect}`);
  await expect(page.getByTestId('quote-detail')).toHaveAttribute('data-stage', 'REDIRECTED');
  await expect(page.getByTestId('decisions')).toContainText('G1 · Redirect');
  await page.goto(`/quotes/${toAdvance}`);
  await expect(page.getByTestId('quote-detail')).toHaveAttribute('data-stage', 'ENG_REVIEW');
  await expect(page.getByTestId('decisions')).toContainText('Good fit for the Midwest plants');
  expect(await seriousViolations(page)).toEqual([]);
});

test('Rework sends the quote back to the KAM with what to fix', async ({ page, request }) => {
  const candidates = await freeOpportunities(request, 1);
  const quoteNumber = await submitQuote(request, candidates);

  await signInAs(page, 'sales-leader');
  await page.goto('/approvals?gate=G1');
  const card = page.locator(`[data-testid="queue-item"][data-quote="${quoteNumber}"]`);
  const decide = card.getByRole('button', { name: `Decide ${quoteNumber}` });
  const dialog = page.getByRole('dialog');
  // Escape closes the dialog and returns focus to the button that opened it.
  await decide.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(decide).toBeFocused();

  await decide.click();
  await dialog.getByRole('radio', { name: /^Rework/ }).check();
  await dialog.getByLabel('Reason (required)').selectOption({ label: 'Missing information' });
  await dialog.getByLabel('Note (required)').fill('Add the target neck finish');
  await dialog.getByRole('button', { name: 'Record decision' }).click();
  await expect(dialog).toHaveCount(0);

  // The KAM sees it under "Returned for rework" and on the quote, with the note.
  const kamPage = await page.context().browser()!.newPage();
  await signInAs(kamPage, 'kam');
  await kamPage.goto(`/quotes/${quoteNumber}`);
  await expect(kamPage.getByTestId('rework-banner')).toContainText('Add the target neck finish');
  await kamPage.getByRole('button', { name: 'Fix and resubmit' }).click();
  await expect(kamPage.getByTestId('rework-notice')).toContainText(`Rework of ${quoteNumber}`);
  await kamPage.close();
});
