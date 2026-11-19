import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { as, ok, quoteInCustomerDecision } from './customer-decision';
import { signInAs } from './personas';

// FB-29 (N19-01): Admin → Integrations → Salesforce write-back, against the FAKE writer only
// (SF_WRITE_MODE=fake in this stack; no real Salesforce org is ever written to). The fake refuses the
// first update of each opportunity (SF_WRITE_FAKE_FAIL_FIRST=1), so a failed row can be retried.

const me = async (request: APIRequestContext, persona: string) =>
  (
    (await (await ok(request.get('/api/v1/me', { headers: as(persona) }))).json()) as {
      user: { id: string };
    }
  ).user.id;

const lost = (request: APIRequestContext, qn: string) =>
  ok(
    request.post(`/api/v1/quotes/${qn}/gates/G5/decisions`, {
      headers: as('kam'),
      data: { outcomeKey: 'lost', reasonCode: 'price' },
    }),
    201,
  );

const setWriteback = (request: APIRequestContext, data: { enabled?: boolean; mode?: string }) =>
  ok(request.put('/api/v1/admin/salesforce/writeback', { headers: as('admin'), data }));

const rowFor = (page: Page, quoteNumber: string) =>
  page.getByTestId('sf-writeback-rows').getByRole('row').filter({ hasText: quoteNumber });

test.afterAll(async ({ request }) => {
  // Leave the switch off for every other spec.
  await setWriteback(request, { enabled: false, mode: 'dry_run' });
});

test('an Admin dry-runs the write-back, previews a quote, goes live and retries a failed write', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const engineer = await me(request, 'engineer');
  const pricing = await me(request, 'pricing');
  await setWriteback(request, { enabled: false, mode: 'dry_run' });

  await signInAs(page, 'admin');
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/admin/integrations');
  const card = page.getByTestId('sf-writeback-card');
  await expect(card.getByRole('heading', { name: 'Salesforce write-back' })).toBeVisible();
  await expect(card.getByTestId('sf-writeback-status')).toContainText('switched off');
  await expect(page.getByText(/read-only toward Salesforce/)).toHaveCount(0);

  // 1. Switch it on, in dry run.
  await card.getByLabel('Write back to Salesforce').check();
  await expect(card.getByTestId('sf-writeback-state')).toHaveText('Dry run');
  await expect(card.getByTestId('sf-writeback-status')).toContainText('sends nothing');

  // 2. A customer outcome is recorded: the row is a dry run, never sent.
  const first = await quoteInCustomerDecision(request, engineer, pricing);
  await lost(request, first);
  await page.reload();
  const dry = rowFor(page, first);
  await expect(dry.getByTestId('sf-write-status')).toHaveText('Dry run');
  await expect(dry).toContainText('StageName = Closed Lost');

  // 3. Preview what the map would send for it.
  await card.getByLabel('Preview for a quote number').fill(first);
  await card.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = card.getByTestId('sf-writeback-preview');
  await expect(preview).toContainText('Closed Lost');
  await expect(preview).toContainText('(closes the opportunity)');
  expect(await seriousViolations(page)).toEqual([]);

  // 4. Live (the fake writer): the first write is refused; the Admin retries it and it is sent.
  await card.getByLabel('Mode').selectOption('live');
  await expect(card.getByTestId('sf-writeback-state')).toHaveText('Live');
  const second = await quoteInCustomerDecision(request, engineer, pricing);
  await lost(request, second);
  await expect(async () => {
    await page.reload();
    await expect(rowFor(page, second).getByTestId('sf-write-status')).toHaveText('Failed', {
      timeout: 1_000,
    });
  }).toPass({ timeout: 30_000 });
  await expect(rowFor(page, second)).toContainText('Injected failure');
  await rowFor(page, second)
    .getByRole('button', { name: `Retry the write for ${second}` })
    .click();
  await expect(page.getByText('Queued to try again')).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(rowFor(page, second).getByTestId('sf-write-status')).toHaveText('Sent', {
      timeout: 1_000,
    });
  }).toPass({ timeout: 30_000 });

  // The fake writer reaches no Salesforce org, so the KAM is still asked to update the opportunity by
  // hand: only a LIVE writer makes the reminder say QuoteFlow updates it (integration-tested).
  const kam = await page.context().newPage();
  await signInAs(kam, 'kam');
  await kam.goto(`/quotes/${second}`);
  await kam.evaluate((qn) => localStorage.setItem(`ccq.sfReminder.${qn}`, 'lost'), second);
  await kam.reload();
  const reminder = kam.getByTestId('sf-update-reminder');
  await expect(reminder).toContainText('Update the Salesforce opportunity to match');
  await expect(reminder).toContainText('Closed Lost');
  await expect(reminder).not.toContainText('QuoteFlow updates');
  await kam.close();

  // Switched off, the card says plainly why nothing is written. (The tabs share one sign-in: back to Admin.)
  await signInAs(page, 'admin');
  await page.goto('/admin/integrations');
  await card.getByLabel('Write back to Salesforce').uncheck();
  await expect(card.getByTestId('sf-writeback-status')).toContainText(
    'writes nothing to Salesforce',
  );
});

for (const theme of ['light', 'dark'] as const) {
  test(`the write-back card fits a laptop and a phone (${theme})`, async ({ page }) => {
    await signInAs(page, 'admin', theme);
    for (const size of [
      { width: 1366, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await page.goto('/admin/integrations');
      const card = page.getByTestId('sf-writeback-card');
      await expect(card.getByRole('heading', { name: 'Salesforce write-back' })).toBeVisible();
      await expect(card.getByLabel('Mode')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${size.width}px`).toBeLessThanOrEqual(0);
      expect(await seriousViolations(page)).toEqual([]);
    }
  });
}
