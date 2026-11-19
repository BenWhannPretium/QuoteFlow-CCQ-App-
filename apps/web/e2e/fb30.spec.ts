import { expect, test, type Browser, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { prepareModels } from './models';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// FB-30 (N19-28; Sarah Brennan, 2026-11-19): Engineering and Capacity apart. The production scheduler
// opens a capacity request from the queue on the Capacity tab, enters evidence, signs capacity off and
// submits; the engineer submits on the Engineering tab; the lead sees both recommendations apart, follows
// the link to the decision and decides. Overview, Quoting and Final Review show two blocks.

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });
type Request = Parameters<typeof submitQuote>[0];

const SOLUTION = {
  plantCode: 'AURORA',
  machineType: 'EBM',
  cavitation: 8,
  cycleTimeS: 14.5,
  prelimCapitalUsd: 0,
  toolingNotes: 'Hot runner, eight cavities',
};

async function open(browser: Browser, persona: string, theme?: 'light' | 'dark'): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, persona, theme);
  return page;
}

/** No sideways page scroll (UX-018). */
const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function inEngineering(request: Request) {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  const call = async (method: 'post' | 'put', path: string, persona: string, data?: unknown) => {
    const res = await request[method](`/api/v1/quotes/${quoteNumber}/${path}`, {
      headers: as(persona),
      ...(data === undefined ? {} : { data }),
    });
    expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
    return res;
  };
  const user = async (persona: string) => {
    const me = await request.get('/api/v1/me', { headers: as(persona) });
    return ((await me.json()) as { user: { id: string; displayName: string } }).user;
  };
  const engineer = await user('engineer');
  const scheduler = await user('production-scheduler');
  await call('post', 'gates/G1/decisions', 'sales-leader', { outcomeKey: 'advance' });
  await call('post', 'assignment', 'eng-lead', {
    engineerId: engineer.id,
    schedulerId: scheduler.id,
  });
  await call('post', 'eng-review/accept', 'engineer');
  await call('put', 'eng-review', 'engineer', SOLUTION);
  return { quoteNumber, call, scheduler, user };
}

test('the scheduler, the engineer and the lead each work their own tab; two blocks everywhere', async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const { quoteNumber, call, scheduler, user } = await inEngineering(request);
  const tabSelected = (page: Page) => page.getByRole('tab', { selected: true });

  // ── The scheduler opens the capacity request from the queue: the Capacity tab ──
  const sched = await open(browser, 'production-scheduler');
  await sched.goto('/queue/engineering');
  await sched
    .getByTestId('my-assignment')
    .filter({ hasText: quoteNumber })
    .getByRole('link', { name: quoteNumber })
    .click();
  await expect(sched).toHaveURL(new RegExp(`/quotes/${quoteNumber}\\?tab=capacity$`));
  await expect(tabSelected(sched)).toHaveText('Capacity');
  await expect(sched.getByTestId('quote-tab-capacity').getByTestId('tab-work-dot')).toBeVisible();
  await expect(sched.getByTestId('quote-tab-engineering').getByTestId('tab-work-dot')).toHaveCount(
    0,
  );
  const cap = sched.getByTestId('capacity-tab');
  const recommendation = cap.getByTestId('capacity-recommendation');
  await expect(
    recommendation.getByRole('heading', { name: 'Capacity recommendation' }),
  ).toBeVisible();
  await expect(recommendation).toContainText('Not signed off yet');
  await expect(cap.getByTestId('capacity-scheduler')).toContainText(scheduler.displayName);
  // The capacity rows are calculated with the engineer's solution: it is named here.
  await expect(cap.getByTestId('capacity-solution')).toContainText('cavitation 8');
  // Assignment stays on the Engineering tab: no assign buttons here.
  await expect(cap.getByRole('button', { name: /Assign|Reassign/ })).toHaveCount(0);

  const form = cap.getByTestId('capacity-form');
  await form.getByRole('button', { name: 'Add capacity row' }).click();
  const row = form.getByTestId('capacity-row');
  await row.getByLabel('Line / asset').fill('Line 4');
  await row.getByLabel('Assumed effectiveness %').fill('70');
  await row.getByLabel('Utilization before %').fill('60');
  await row.getByLabel('Notes and assumptions').fill('Line 4 has room after the changeover');
  await form.getByRole('button', { name: 'Save capacity evidence' }).click();
  await expect(sched.getByText('Capacity evidence saved')).toBeVisible();
  // "Capacity at a glance" is still beside the row.
  await expect(row.getByTestId('capacity-glance')).toBeVisible();
  // The recommendation reads the same quote: the new row is in its headline at once.
  await expect(recommendation.getByTestId('capacity-headline')).toContainText('Line 4');
  await expect(recommendation.getByTestId('capacity-headline')).toContainText('practical capacity');

  const signoff = cap.getByTestId('capacity-signoff');
  await signoff.getByRole('button', { name: 'Approve capacity' }).click();
  await expect(signoff.getByTestId('capacity-signoff-status')).toContainText('Capacity approved');
  await expect(recommendation).toContainText(`Capacity is signed off by ${scheduler.displayName}`);
  await cap
    .getByTestId('capacity-submit')
    .getByRole('button', { name: 'Submit capacity to engineering lead' })
    .click();
  await expect(cap.getByTestId('eng-part-scheduler')).toContainText('Submitted');
  await expect(recommendation.getByTestId('capacity-recommendation-status')).toContainText(
    'Submitted',
  );
  expect(await seriousViolations(sched)).toEqual([]);

  // Two sizes, two themes: axe clean, no sideways scroll, the tab bar still there with its dot.
  for (const theme of ['light', 'dark'] as const) {
    const page = await open(browser, 'production-scheduler', theme);
    await page.goto(`/quotes/${quoteNumber}?tab=capacity`);
    await expect(page.getByTestId('capacity-recommendation')).toBeVisible();
    for (const size of [
      { width: 1366, height: 768 },
      { width: 390, height: 844 },
      { width: 320, height: 640 },
    ]) {
      await page.setViewportSize(size);
      expect(await noSideScroll(page), `capacity ${theme} ${size.width}`).toBe(true);
      await expect(page.getByTestId('quote-tabs')).toBeVisible();
      await page.getByTestId('quote-tab-capacity').scrollIntoViewIfNeeded();
      await expect(page.getByTestId('quote-tab-capacity')).toBeInViewport();
      if (size.width !== 320) {
        expect(await seriousViolations(page), `axe ${theme} ${size.width}`).toEqual([]);
      }
    }
    await page.context().close();
  }

  // ── The engineer opens the quote on the Engineering tab and submits their part ──
  const eng = await open(browser, 'engineer');
  await eng.goto(`/quotes/${quoteNumber}`);
  await expect(eng).toHaveURL(new RegExp(`/quotes/${quoteNumber}\\?tab=engineering$`));
  const engTab = eng.getByTestId('engineering-tab');
  const engRec = engTab.getByTestId('engineering-recommendation');
  await expect(engRec.getByRole('heading', { name: 'Engineering recommendation' })).toBeVisible();
  await expect(engRec).toContainText('Hot runner, eight cavities');
  await expect(engRec.getByTestId('engineering-recommendation-status')).toHaveText(
    'Not submitted yet',
  );
  // The capacity cards are not on this tab; its part line links to the Capacity tab.
  await expect(engTab.getByTestId('capacity-form')).toHaveCount(0);
  await expect(engTab.getByTestId('capacity-signoff')).toHaveCount(0);
  await expect(engTab.getByTestId('eng-part-link-capacity')).toBeVisible();
  await engTab
    .getByTestId('eng-submit')
    .getByRole('button', { name: 'Submit to engineering lead' })
    .click();
  await expect(engRec.getByTestId('engineering-recommendation-status')).toContainText(
    'Submitted by',
  );
  expect(await seriousViolations(eng)).toEqual([]);

  // ── The lead sees the two recommendations apart, follows the link to the decision and decides ──
  const lead = await open(browser, 'eng-lead');
  await lead.goto(`/quotes/${quoteNumber}`);
  await expect(lead).toHaveURL(new RegExp(`/quotes/${quoteNumber}\\?tab=engineering$`));
  await expect(lead.getByTestId('engineering-recommendation')).toContainText('Aurora');
  await lead.getByRole('tab', { name: 'Capacity', exact: true }).click();
  const leadCap = lead.getByTestId('capacity-tab');
  await expect(leadCap.getByTestId('capacity-recommendation')).toContainText(
    'Capacity is signed off',
  );
  await expect(leadCap.getByTestId('engineering-recommendation')).toHaveCount(0);
  expect(await seriousViolations(lead)).toEqual([]);
  await leadCap.getByRole('link', { name: 'Go to the decision on the Engineering tab' }).click();
  await expect(tabSelected(lead)).toHaveText('Engineering');
  await expect(lead.locator('#decision')).toBeFocused();
  await lead.locator('#decision').getByTestId('decide-gate').click();
  const dialog = lead.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Advance', exact: true }).check();
  await dialog.getByRole('button', { name: 'Record decision' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(lead.getByTestId('quote-detail')).toHaveAttribute('data-stage', 'QUOTING');

  // ── Overview: two cards, each with a link to its tab ──
  await lead.goto(`/quotes/${quoteNumber}?tab=overview`);
  const glanceEng = lead.getByTestId('glance-engineering');
  const glanceCap = lead.getByTestId('glance-capacity');
  await expect(glanceEng).toContainText('Feasibility decided');
  await expect(glanceEng).toContainText('Hot runner, eight cavities');
  await expect(glanceEng).not.toContainText('Capacity is signed off');
  await expect(glanceCap).toContainText(`Capacity is signed off by ${scheduler.displayName}`);
  await expect(glanceCap).toContainText('Line 4 has room after the changeover');
  await expect(glanceCap.getByTestId('glance-capacity-open')).toHaveAttribute(
    'href',
    `/quotes/${quoteNumber}?tab=capacity`,
  );
  expect(await seriousViolations(lead)).toEqual([]);

  // ── Quoting: the engineering summary and the capacity group, each headed ──
  const pricing = await open(browser, 'pricing');
  await pricing.goto(`/quotes/${quoteNumber}?tab=quoting`);
  const group = pricing.getByTestId('quoting-capacity-group');
  await expect(group.getByRole('heading', { name: 'Capacity', exact: true })).toBeVisible();
  await expect(group).toContainText('Capacity is signed off');
  await expect(group.getByTestId('quoting-capacity')).toContainText('Line 4');
  await expect(pricing.getByRole('heading', { name: 'Engineering summary' })).toBeVisible();
  expect(await seriousViolations(pricing)).toEqual([]);

  // ── Final Review: "Engineering solution" and "Capacity evidence", two sections ──
  const pricingId = (await user('pricing')).id;
  await prepareModels(request, quoteNumber);
  await call('put', 'pricing-record', 'pricing', {
    approvedBy: pricingId,
    erfRefs: ['ERF26-301'],
    costingCompleted: true,
  });
  await call('put', 'capital-readiness', 'pricing', { capitalReadiness: 'pre_approved' });
  await call('post', 'gates/G3/decisions', 'pricing-lead', { outcomeKey: 'submit' });
  const approver = await open(browser, 'approver');
  await approver.goto(`/quotes/${quoteNumber}/review`);
  const reviewEng = approver.getByTestId('review-engineering');
  const reviewCap = approver.getByTestId('review-capacity');
  await expect(reviewEng.getByRole('heading', { name: 'Engineering solution' })).toBeVisible();
  await expect(reviewEng).not.toContainText('Line 4');
  await expect(reviewCap.getByRole('heading', { name: 'Capacity evidence' })).toBeVisible();
  await expect(reviewCap).toContainText('Capacity is signed off');
  await expect(reviewCap).toContainText('Line 4');
  expect(await seriousViolations(approver)).toEqual([]);
});

test('old links keep working: ?tab=engineering, #decision and #capacity', async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const { quoteNumber } = await inEngineering(request);
  const sched = await open(browser, 'production-scheduler');
  // A link sent before the Capacity tab existed still opens the Engineering tab, for anyone.
  await sched.goto(`/quotes/${quoteNumber}?tab=engineering`);
  await expect(sched.getByRole('tab', { selected: true })).toHaveText('Engineering');
  await expect(sched.getByTestId('engineering-tab')).toBeVisible();
  // #capacity opens the Capacity tab.
  await sched.goto(`/quotes/${quoteNumber}#capacity`);
  await expect(sched.getByRole('tab', { selected: true })).toHaveText('Capacity');
  await expect(sched).toHaveURL(new RegExp(`\\?tab=capacity#capacity$`));
  // The lead's decision link from an email still lands on the decision.
  const lead = await open(browser, 'eng-lead');
  await lead.goto(`/quotes/${quoteNumber}?tab=engineering#decision`);
  await expect(lead.locator('#decision')).toBeFocused();
});
