import { expect, test, type Browser, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// FB-22 (N17-11, N17-14, N17-16; record D2): the engineer and the production scheduler each submit their
// part to the engineering lead; the lead is told once both are in and decides from "Go to the decision";
// the scheduler sees "New" in the queue; an engineering lead who is the assigned engineer decides G2 on
// their own work.

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });
type Request = Parameters<typeof submitQuote>[0];

const SOLUTION = {
  plantCode: 'AURORA',
  machineType: 'EBM',
  cavitation: 8,
  cycleTimeS: 14.5,
  prelimCapitalUsd: 0,
};

/** A quote past G1 with the given engineer (and scheduler) assigned. */
async function inEngineering(request: Request, engineerPersona: string, withScheduler: boolean) {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  const call = async (method: 'post' | 'put', path: string, persona: string, data?: unknown) => {
    const res = await request[method](`/api/v1/quotes/${quoteNumber}/${path}`, {
      headers: as(persona),
      ...(data === undefined ? {} : { data }),
    });
    expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
    return res;
  };
  const idOf = async (persona: string) => {
    const me = await request.get('/api/v1/me', { headers: as(persona) });
    return ((await me.json()) as { user: { id: string; displayName: string } }).user;
  };
  const engineer = await idOf(engineerPersona);
  const scheduler = await idOf('production-scheduler');
  await call('post', 'gates/G1/decisions', 'sales-leader', { outcomeKey: 'advance' });
  await call('post', 'assignment', 'eng-lead', {
    engineerId: engineer.id,
    ...(withScheduler ? { schedulerId: scheduler.id } : {}),
  });
  return { quoteNumber, call, engineer, scheduler };
}

async function open(browser: Browser, persona: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, persona);
  return page;
}

test('the engineer and the scheduler each submit; the lead is told and decides from "Go to the decision"', async ({
  browser,
  request,
}) => {
  test.setTimeout(150_000);
  const { quoteNumber, call } = await inEngineering(request, 'engineer', true);

  // ── The scheduler sees the quote as New in the queue until they save a capacity row ──
  const sched = await open(browser, 'production-scheduler');
  await sched.goto('/queue/engineering');
  const mine = sched.getByTestId('my-assignment').filter({ hasText: quoteNumber });
  await expect(mine.getByTestId('new-chip')).toHaveText('New');
  await sched.getByTestId('new-to-me').click();
  await expect(sched.getByTestId('new-to-me')).toHaveAttribute('aria-pressed', 'true');
  await expect(sched.getByRole('link', { name: quoteNumber, exact: true }).first()).toBeVisible();
  expect(await seriousViolations(sched)).toEqual([]);

  // ── The engineer does their part and submits it at the end of it ──
  await call('post', 'eng-review/accept', 'engineer');
  await call('put', 'eng-review', 'engineer', SOLUTION);
  const eng = await open(browser, 'engineer');
  await eng.goto(`/quotes/${quoteNumber}?tab=engineering`);
  const engTab = eng.getByTestId('engineering-tab');
  const solution = engTab.getByTestId('solution-form');
  await expect(solution.getByLabel('Technical concept')).toHaveCount(0);
  await expect(solution.getByLabel('Supply Chain')).toHaveCount(0);
  await expect(solution.getByText('Say whether the mold has a hot runner')).toBeVisible();
  await solution.getByLabel('Machine platform').fill('Bekum line 3');
  await solution.getByRole('button', { name: 'Save solution' }).click();
  await expect(eng.getByText('Solution saved')).toBeVisible();
  await eng.reload();
  await expect(solution.getByLabel('Machine platform')).toHaveValue('Bekum line 3');
  expect(await seriousViolations(eng)).toEqual([]);
  await engTab
    .getByTestId('eng-submit')
    .getByRole('button', { name: 'Submit to engineering lead' })
    .click();
  await expect(engTab.getByTestId('eng-part-engineer')).toContainText('Submitted');
  await expect(engTab.getByTestId('eng-part-scheduler')).toContainText('Not submitted yet');

  // The lead is not told yet: nothing waits on them, so there is no jump to the decision.
  const lead = await open(browser, 'eng-lead');
  await lead.goto(`/quotes/${quoteNumber}?tab=engineering`);
  await expect(lead.getByTestId('go-to-decision')).toHaveCount(0);

  // ── The scheduler adds a row, the New chip goes, and they submit capacity at the end of their part ──
  await sched.goto(`/quotes/${quoteNumber}?tab=engineering`);
  const tab = sched.getByTestId('engineering-tab');
  await expect(tab.getByTestId('capacity-submit-needed')).toBeVisible();
  const capacity = tab.getByTestId('capacity-form');
  await capacity.getByRole('button', { name: 'Add capacity row' }).click();
  const row = capacity.getByTestId('capacity-row');
  await row.getByLabel('Assumed effectiveness %').fill('70');
  await row.getByLabel('Utilization before %').fill('60');
  await capacity.getByRole('button', { name: 'Save capacity evidence' }).click();
  await expect(sched.getByText('Capacity evidence saved')).toBeVisible();
  await tab
    .getByTestId('capacity-submit')
    .getByRole('button', { name: 'Submit capacity to engineering lead' })
    .click();
  await expect(tab.getByTestId('eng-part-scheduler')).toContainText('Submitted');
  expect(await seriousViolations(sched)).toEqual([]);
  await sched.goto('/queue/engineering');
  await expect(
    sched.getByTestId('my-assignment').filter({ hasText: quoteNumber }).getByTestId('new-chip'),
  ).toHaveCount(0);

  // ── The lead is told, opens the quote, and jumps to the decision (focus moves there) ──
  await lead.goto('/');
  await expect(lead.getByTestId('notification-bell')).toHaveAccessibleName(/unread/);
  await lead.goto(`/quotes/${quoteNumber}?tab=engineering`);
  await expect(lead.getByTestId('lead-review-submitted')).toContainText('Every part is with');
  await lead.getByTestId('go-to-decision').click();
  await expect(lead.locator('#decision')).toBeFocused();
  await expect(lead.locator('#decision')).toBeInViewport();
  expect(await seriousViolations(lead)).toEqual([]);
  await lead.locator('#decision').getByTestId('decide-gate').click();
  const dialog = lead.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Advance', exact: true }).check();
  await dialog.getByRole('checkbox', { name: /Capacity approved/ }).check();
  await dialog.getByRole('button', { name: 'Record decision' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(lead.getByTestId('quote-detail')).toHaveAttribute('data-stage', 'QUOTING');
});

test('?tab=engineering#decision lands on the decision; a plain link does not scroll', async ({
  browser,
  request,
}) => {
  test.setTimeout(90_000);
  const { quoteNumber } = await inEngineering(request, 'engineer', false);
  const lead = await open(browser, 'eng-lead');
  await lead.goto(`/quotes/${quoteNumber}?tab=engineering`);
  await expect(lead.getByTestId('engineering-tab')).toBeVisible();
  expect(await lead.evaluate(() => window.scrollY)).toBe(0);
  await lead.goto(`/quotes/${quoteNumber}?tab=engineering#decision`);
  await expect(lead.locator('#decision')).toBeFocused();
});

test('D2: an engineering lead assigned as the engineer decides G2 on their own work', async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  // Sign in once so the persona exists before it is assigned.
  await request.get('/api/v1/me', { headers: as('eng-lead-engineer') });
  const { quoteNumber, call } = await inEngineering(request, 'eng-lead-engineer', false);
  await call('post', 'eng-review/accept', 'eng-lead-engineer');
  await call('put', 'eng-review', 'eng-lead-engineer', SOLUTION);
  const me = (await (
    await request.get('/api/v1/me', { headers: as('eng-lead-engineer') })
  ).json()) as { user: { id: string } };
  await call('put', 'capacity-evidence', 'eng-lead-engineer', {
    rows: [
      {
        site: 'AURORA',
        lineAsset: 'Line 4',
        assumedEffectivenessPct: 70,
        cycleTimeS: 14.5,
        utilizationBeforePct: 60,
        analysisDate: '2026-11-19',
        analystId: me.user.id,
      },
    ],
  });

  const page = await open(browser, 'eng-lead-engineer');
  await page.goto(`/quotes/${quoteNumber}?tab=engineering`);
  const tab = page.getByTestId('engineering-tab');
  // Nothing to submit, nobody to submit to: the decision is theirs.
  await expect(tab.getByRole('button', { name: 'Submit to engineering lead' })).toHaveCount(0);
  await expect(tab.getByTestId('lead-self-review')).toBeVisible();
  await tab.getByTestId('go-to-decision').click();
  await expect(page.locator('#decision')).toBeFocused();
  await page.locator('#decision').getByTestId('decide-gate').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Advance', exact: true }).check();
  await dialog.getByRole('checkbox', { name: /Capacity approved/ }).check();
  await dialog.getByRole('button', { name: 'Record decision' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('quote-detail')).toHaveAttribute('data-stage', 'QUOTING');
});
