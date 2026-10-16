import { expect, test, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// B-10: the EngLead is alerted and assigns from the engineering queue; the Engineer accepts and
// completes the Engineering Review with capacity evidence; the EngLead decides G2 Proceed.
// The quote is created and qualified through the API (intake and G1 have their own specs).

test('EngLead assigns → Engineer completes the review with capacity evidence → Proceed', async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  // Provision the EngLead (the e2e database is config-seeded only) so the arrival alert has a recipient.
  await request.get('/api/v1/me', { headers: { [DEV_USER_HEADER]: 'eng-lead' } });
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  const advance = await request.post(`/api/v1/quotes/${quoteNumber}/gates/G1/decisions`, {
    headers: { [DEV_USER_HEADER]: 'sales-leader' },
    data: { outcomeKey: 'advance', note: 'e2e: qualified' },
  });
  expect(advance.status(), await advance.text()).toBe(201);
  // Provision the engineer persona so the EngLead's picker lists them.
  const me = await request.get('/api/v1/me', { headers: { [DEV_USER_HEADER]: 'engineer' } });
  const engineerName = ((await me.json()) as { user: { displayName: string } }).user.displayName;

  const as = async (persona: string): Promise<Page> => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAs(page, persona);
    return page;
  };

  // ── EngLead: alerted, finds the quote in the queue, assigns it ──
  const lead = await as('eng-lead');
  await lead.goto('/');
  await expect(lead.getByTestId('notification-bell')).toHaveAccessibleName(/unread/);
  await lead.getByTestId('notification-bell').click();
  await expect(lead.getByTestId('notification-list')).toContainText(
    `${quoteNumber} is in the engineering queue`,
  );
  await lead.keyboard.press('Escape');

  await lead
    .getByRole('navigation', { name: 'Primary' })
    .locator('[data-nav="queue-engineering"]')
    .click();
  await expect(lead.getByRole('heading', { level: 1, name: 'Engineering queue' })).toBeVisible();
  await expect(lead.getByTestId('aging-chips')).toContainText('< 3 days');
  await lead.getByLabel('Search the queue').fill(quoteNumber);
  const row = lead.getByRole('row').filter({ hasText: quoteNumber });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('queue-status')).toHaveText('Unassigned');
  await expect(row.getByTestId('days-in-queue')).toHaveText('0 business days');
  expect(await seriousViolations(lead)).toEqual([]);

  await row.getByRole('button', { name: `Actions for ${quoteNumber}` }).click();
  await lead.getByRole('menuitem', { name: 'Assign…' }).click();
  const assign = lead.getByRole('dialog');
  await assign.getByRole('button', { name: 'Assign' }).click();
  await expect(assign.getByRole('alert')).toHaveText('Choose an engineer.');
  const picker = assign.getByLabel('Engineer');
  const option = picker.locator('option', { hasText: `${engineerName} (` });
  await expect(option).toContainText('open'); // the picker shows each engineer's open count
  await picker.selectOption(await option.getAttribute('value'));
  await assign.getByRole('button', { name: 'Assign' }).click();
  await expect(assign).toHaveCount(0);
  await expect(row.getByTestId('queue-status')).toHaveText('Awaiting acceptance');
  await expect(row).toContainText(engineerName);

  // ── Engineer: accepts and completes the review ──
  const eng = await as('engineer');
  await eng.goto('/queue/engineering');
  await expect(eng.getByRole('heading', { level: 1, name: 'My assignments' })).toBeVisible();
  const mine = eng.locator(`[data-testid="my-assignment"][data-quote="${quoteNumber}"]`);
  await expect(mine).toContainText('Awaiting acceptance');
  await mine.getByRole('link', { name: quoteNumber }).click();
  await expect(eng).toHaveURL(new RegExp(`/quotes/${quoteNumber}\\?tab=engineering`));
  const tab = eng.getByTestId('engineering-tab');
  await tab.getByRole('button', { name: 'Accept (start review)' }).click();
  await expect(tab).toContainText(/Accepted.*by/);
  await expect(eng.getByTestId('commercial-hidden')).toBeVisible();

  const solution = eng.getByTestId('solution-form');
  await solution.getByLabel('Process type').selectOption({ label: 'EBM' });
  await solution.getByLabel('Machine type').selectOption({ label: 'EBM shuttle' });
  await solution.getByLabel('Plant / site').selectOption({ index: 1 });
  await solution.getByLabel('Cavitation').fill('8');
  await solution.getByLabel('Cycle time (s)').fill('14.5');
  await solution.getByLabel('Preliminary capital (USD)').fill('350000');
  await solution.getByLabel('Downstream equipment').fill('Leak tester, compressed air drop');
  await solution.getByRole('button', { name: 'Save solution' }).click();
  await expect(eng.getByText('Engineering review saved')).toBeVisible();
  // Commercial: the engineer wrote the capital but can't read it back.
  await expect(solution.getByLabel('Preliminary capital (USD)')).toHaveValue('');

  const capacity = eng.getByTestId('capacity-form');
  await capacity.getByRole('button', { name: 'Add capacity row' }).click();
  const capRow = capacity.getByTestId('capacity-row');
  await capRow.getByLabel('Line / asset').fill('Line 4');
  await capRow.getByLabel('Utilization %').fill('62');
  await capacity.getByRole('button', { name: 'Save capacity evidence' }).click();
  // No OEE default: the effectiveness assumption must be stated.
  await expect(capRow.getByRole('alert')).toContainText('state the assumed effectiveness %');
  await expect(capRow).toContainText('85% vs ~70% demonstrated');
  await capRow.getByLabel('Assumed effectiveness %').fill('70');
  await capacity.getByRole('button', { name: 'Save capacity evidence' }).click();
  await expect(eng.getByText('Capacity evidence saved')).toBeVisible();
  expect(await seriousViolations(eng)).toEqual([]);

  // ── EngLead: decides G2 Proceed ──
  await lead.goto(`/quotes/${quoteNumber}?tab=engineering`);
  const leadTab = lead.getByTestId('engineering-tab');
  await expect(leadTab.getByLabel('Preliminary capital (USD)')).toHaveValue('350000');
  await leadTab.getByRole('button', { name: 'Decide G2…' }).click();
  const g2 = lead.getByRole('dialog');
  await expect(g2.getByTestId('completeness')).toContainText('Nothing missing for this decision');
  await g2.getByRole('radio', { name: 'Proceed', exact: true }).check();
  await g2.getByRole('button', { name: 'Record decision' }).click();
  await expect(g2).toHaveCount(0);
  await expect(lead.getByText(`${quoteNumber} is now in Quoting`)).toBeVisible();
  await expect(lead.getByTestId('quote-detail')).toHaveAttribute('data-stage', 'QUOTING');
  await expect(lead.getByTestId('stage-times')).toContainText('Engineering Review');

  await lead.goto('/queue/engineering');
  await lead.getByLabel('Search the queue').fill(quoteNumber);
  await expect(lead.getByText('No quotes match these filters')).toBeVisible();
});

test('the KAM sees the Engineering tab read-only, with capital hidden', async ({
  page,
  request,
}) => {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  await request.post(`/api/v1/quotes/${quoteNumber}/gates/G1/decisions`, {
    headers: { [DEV_USER_HEADER]: 'sales-leader' },
    data: { outcomeKey: 'advance' },
  });
  await request.put(`/api/v1/quotes/${quoteNumber}/eng-review`, {
    headers: { [DEV_USER_HEADER]: 'eng-lead' },
    data: { processType: 'EBM', prelimCapitalUsd: 125000 },
  });
  await signInAs(page, 'kam');
  await page.goto(`/quotes/${quoteNumber}`);
  await page.getByRole('tab', { name: 'Engineering' }).click();
  const tab = page.getByTestId('engineering-tab');
  await expect(tab).toContainText('Hidden (commercial)');
  await expect(tab).not.toContainText('125,000');
  await expect(tab.getByTestId('solution-form')).toHaveCount(0);
  await expect(tab.getByRole('button', { name: /Assign|Accept|Decide/ })).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);
});
