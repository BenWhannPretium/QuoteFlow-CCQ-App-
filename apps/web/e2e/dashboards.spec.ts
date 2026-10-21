import { expect, test } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// B-17 role dashboards (F-02) and operational analytics (F-17 subset). The e2e database is
// config-seeded only, so most charts start empty: that is the "early pilot" case the empty states are
// for. Tests that need data make it through the API (a KAM submits, the SalesLeader qualifies).

async function quoteInEngReview(request: Parameters<typeof submitQuote>[0]): Promise<string> {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  const advance = await request.post(`/api/v1/quotes/${quoteNumber}/gates/G1/decisions`, {
    headers: { [DEV_USER_HEADER]: 'sales-leader' },
    data: { outcomeKey: 'advance', note: 'e2e: qualified' },
  });
  expect(advance.status(), await advance.text()).toBe(201);
  return quoteNumber;
}

test.describe('role dashboards', () => {
  test('KAM: new intake, drafts, returned, my quotes by stage, expiring, capture', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
    await signInAs(page, 'kam');
    await page.goto('/');
    await expect(page.getByTestId('landing')).toHaveAttribute('data-role', 'KAM');
    await expect(
      page.getByTestId('landing').getByRole('link', { name: 'New intake' }),
    ).toBeVisible();
    for (const name of [
      'Returned to me',
      'My drafts',
      'My open quotes by stage',
      'Proposals expiring soon',
      'My outcome capture rate',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    }
    // The quote I just submitted is counted in the first stage of my mini board (which lists only the
    // five oldest quotes per stage, so the count is the stable thing to check).
    const intake = page.getByTestId('mini-board').locator('[data-stage="INTAKE"]');
    await expect(intake.getByRole('heading', { name: 'Intake' })).toBeVisible();
    await expect(intake).toContainText(/\b[1-9]\d*\b/);
    expect(quoteNumber).toMatch(/^CCQ-\d{4}-\d{5}$/);
    // The capture block says what it measures and never shows NaN.
    await expect(page.getByTestId('dash-capture')).toContainText('Outcome capture rate');
    await expect(page.getByTestId('dash-capture')).not.toContainText('NaN');
  });

  test('every block opens an info tooltip with its definition and time window', async ({
    page,
  }) => {
    await signInAs(page, 'kam');
    await page.goto('/');
    await page.getByRole('button', { name: /About My outcome capture rate/ }).click();
    const pop = page.getByTestId('info-popover');
    await expect(pop).toContainText('Definition');
    await expect(pop).toContainText('gone dark');
    await expect(pop).toContainText('Time window');
    await expect(pop).toContainText('last 365 days');
  });

  test('SalesLeader: the new intake is waiting to be qualified', async ({ page, request }) => {
    await submitQuote(request, await freeOpportunities(request, 1));
    await signInAs(page, 'sales-leader');
    await page.goto('/');
    await expect(page.getByTestId('landing')).toHaveAttribute('data-role', 'SalesLeader');
    await expect(page.getByRole('heading', { level: 2, name: 'To qualify (G1)' })).toBeVisible();
    const waiting = page.getByTestId('dash-to-qualify').getByText('Waiting for your decision');
    await expect(waiting).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Pending override requests' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Team pipeline by stage' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Proposals with no outcome past validity' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Open the qualification queue' }).click();
    await expect(page).toHaveURL(/\/approvals\?tab=to-qualify/);
  });

  test('EngLead: queue health with total, unassigned and the three aging buckets', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await quoteInEngReview(request);
    await signInAs(page, 'eng-lead');
    await page.goto('/');
    await expect(page.getByTestId('landing')).toHaveAttribute('data-role', 'EngLead');
    const queue = page.getByTestId('dash-queue');
    await expect(queue.getByText('In the queue')).toBeVisible();
    await expect(queue.getByText('Unassigned')).toBeVisible();
    for (const label of ['< 3 days', '3–10 days', '> 10 days']) {
      await expect(queue.getByText(label)).toBeVisible();
    }
    await expect(queue.getByTestId('bucket-fresh')).toContainText(/[1-9]/);
    await expect(page.getByTestId('dash-load')).toContainText('Unassigned');
    await expect(page.getByTestId('stat-time-to-assign')).toContainText('Median time to assign');
    await expect(page.getByTestId('dash-returned-reasons')).toBeVisible();
    // The median windows are stated.
    await page.getByRole('button', { name: /About Time to assign and to G2/ }).click();
    await expect(page.getByTestId('info-popover')).toContainText('last 30 days');
  });

  test('Pricing and Approver dashboards load', async ({ page, request }) => {
    await quoteInEngReview(request);
    await signInAs(page, 'pricing');
    await page.goto('/');
    await expect(page.getByTestId('landing')).toHaveAttribute('data-role', 'Pricing');
    await expect(page.getByTestId('dash-queue')).toContainText('In the queue');
    await expect(page.getByTestId('dash-capital-pending')).toBeVisible();
    await expect(page.getByTestId('dash-median-quoting')).toBeVisible();

    await page.getByTestId('dev-persona').selectOption('approver');
    await expect(page.getByTestId('landing')).toHaveAttribute('data-role', 'Approver');
    await expect(page.getByTestId('dash-pending')).toBeVisible();
    await expect(page.getByTestId('dash-decided')).toBeVisible();
  });

  test('B-26: the pricing lead lands on triage with each pricer’s load', async ({ page }) => {
    await signInAs(page, 'pricing-lead');
    await page.goto('/');
    await expect(page.getByTestId('landing')).toHaveAttribute('data-role', 'PricingLead');
    await expect(page.getByTestId('dash-queue')).toContainText('Unassigned');
    await expect(page.getByTestId('dash-pricer-load')).toBeVisible();
  });

  test('Leadership: headline numbers, win rate always beside capture, link to analytics', async ({
    page,
  }) => {
    await signInAs(page, 'leadership');
    await page.goto('/');
    await expect(page.getByTestId('landing')).toHaveAttribute('data-role', 'Leadership');
    await expect(page.getByTestId('dash-kpis')).toBeVisible();
    const pair = page.getByTestId('dash-rate-pair');
    await expect(pair.getByText('Win rate (decided quotes only)')).toBeVisible();
    await expect(pair.getByText('Outcome capture rate')).toBeVisible();
    await page.getByRole('link', { name: 'Open full analytics' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
  });

  test('dashboards have no serious axe violations (light and dark)', async ({ page }) => {
    for (const [persona, theme] of [
      ['kam', 'light'],
      ['leadership', 'dark'],
    ] as const) {
      await signInAs(page, persona, theme);
      await page.goto('/');
      await expect(page.getByTestId('landing')).toBeVisible();
      await expect(page.locator('[data-testid^="dash-"]').first()).toBeVisible();
      expect(await seriousViolations(page), `${persona} ${theme}`).toEqual([]);
    }
  });
});

test.describe('analytics', () => {
  test('every section, every chart states its window, the footer is honest', async ({ page }) => {
    await signInAs(page, 'leadership');
    await page.goto('/analytics');
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
    // B-26 (A5): the leadership report reads pipeline → outcomes → time → reasons → governance.
    await expect(page.getByTestId('analytics-page')).toHaveAttribute('data-lens', 'leadership');
    for (const name of [
      'Pipeline',
      'Outcomes',
      'Cycle time',
      'Flow',
      'Reasons',
      'Quality and governance',
      'Priority',
      'Adoption',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('analytics-footer')).toHaveText(
      'Operational metrics from QuoteFlow; not yet D&A-certified.',
    );
    // Wait for the charts, then check each one states its window and has an info button.
    await expect(page.getByTestId('chart-pipeline-count')).toBeVisible();
    await expect.poll(() => page.locator('[data-chart-card]').count()).toBeGreaterThanOrEqual(14);
    const cards = page.locator('[data-chart-card]');
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      await expect(card.getByTestId('chart-window')).not.toBeEmpty();
      await expect(
        card.getByRole('button', { name: /^About .*definition and time window$/ }),
      ).toBeVisible();
    }
  });

  test('the info tooltip gives the definition and the window', async ({ page }) => {
    await signInAs(page, 'leadership');
    await page.goto('/analytics');
    const card = page.getByTestId('chart-pipeline-amount');
    await card.getByRole('button', { name: /^About .*definition and time window$/ }).click();
    const pop = page.getByTestId('info-popover');
    await expect(pop).toContainText('Definition');
    await expect(pop).toContainText('not a price');
    await expect(pop).toContainText('Time window');
    await expect(pop).toContainText('date range does not apply');
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
    // The pipeline amount is labelled as entered.
    await expect(
      card.getByRole('heading', { name: 'SF opportunity amount (as entered)' }),
    ).toBeVisible();
  });

  test('every chart has a table view with the same numbers', async ({ page, request }) => {
    test.setTimeout(90_000);
    await quoteInEngReview(request);
    await signInAs(page, 'leadership');
    await page.goto('/analytics');
    const card = page.getByTestId('chart-pipeline-count');
    const chart = card.getByRole('img', { name: 'Open quotes by stage' });
    await expect(chart).toBeVisible();
    await card.getByRole('button', { name: /Table view of Open quotes by stage/ }).click();
    const table = card.getByRole('table', { name: /Open quotes and SF opportunity amount/ });
    await expect(table).toBeVisible();
    await expect(table.getByRole('row', { name: /Engineering Review/ })).toBeVisible();
    await card.getByRole('button', { name: /Chart view of Open quotes by stage/ }).click();
    await expect(chart).toBeVisible();
  });

  test('drill-down opens the filtered quote list', async ({ page, request }) => {
    test.setTimeout(90_000);
    const quoteNumber = await quoteInEngReview(request);
    await signInAs(page, 'leadership');
    await page.goto('/analytics?market=FOOD');
    const card = page.getByTestId('chart-pipeline-count');
    await card.getByRole('button', { name: /Table view of Open quotes by stage/ }).click();
    await card
      .getByRole('row', { name: /Engineering Review/ })
      .getByRole('link', { name: 'View quotes' })
      .click();
    await expect(page).toHaveURL(/\/quotes\?.*stage=ENG_REVIEW/);
    await expect(page).toHaveURL(/market=FOOD/);
    await expect(page.getByRole('link', { name: quoteNumber })).toBeVisible();
  });

  test('filters live in the URL and survive a reload; clearing resets them', async ({ page }) => {
    await signInAs(page, 'leadership');
    await page.goto('/analytics');
    const filters = page.getByTestId('analytics-filters');
    await expect(filters.getByLabel('Market').locator('option')).not.toHaveCount(1);
    await filters.getByLabel('Market').selectOption({ index: 1 });
    await expect(page).toHaveURL(/market=/);
    await page.reload();
    await expect(page.getByTestId('analytics-filters').getByLabel('Market')).not.toHaveValue('');
    await page.getByRole('button', { name: /Clear filters/ }).click();
    await expect(page).not.toHaveURL(/market=/);
    await filters.getByRole('button', { name: 'Last 30 days' }).click();
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}/);
  });

  test('a thin window shows guidance, not an empty chart; win rate is never alone', async ({
    page,
  }) => {
    await signInAs(page, 'leadership');
    await page.goto('/analytics?from=2020-01-01&to=2020-01-31');
    await expect(page.getByTestId('chart-loss-reasons').getByTestId('thin-data')).toContainText(
      'Not enough data in this window yet',
    );
    const pair = page.getByTestId('rate-pair');
    await expect(pair.getByTestId('rate-pair-win')).toContainText('Win rate (decided quotes only)');
    await expect(pair.getByTestId('rate-pair-capture')).toContainText('Outcome capture rate');
    // No data: both are dashes, not 0%.
    await expect(pair.getByTestId('rate-pair-win')).toContainText('–');
    await expect(pair.getByTestId('rate-pair-capture')).toContainText('–');
  });

  test('a bad date range shows an error the user can act on', async ({ page }) => {
    await signInAs(page, 'leadership');
    await page.goto('/analytics?from=2026-10-10&to=2026-10-01');
    await expect(page.getByText('`from` is after `to`').first()).toBeVisible();
  });

  test('a KAM is refused the analytics page', async ({ page }) => {
    await signInAs(page, 'kam');
    await page.goto('/analytics');
    await expect(page.getByTestId('forbidden')).toBeVisible();
  });

  test('a SalesLeader reads analytics but has no adoption section (it reads the audit log)', async ({
    page,
  }) => {
    await signInAs(page, 'sales-leader');
    await page.goto('/analytics');
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
    await expect(page.getByTestId('chart-pipeline-count')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Adoption' })).toHaveCount(0);
    await expect(page.getByTestId('analytics-footer')).toBeVisible();
  });

  test('Leadership has the adoption section', async ({ page }) => {
    await signInAs(page, 'leadership');
    await page.goto('/analytics');
    await expect(page.getByRole('heading', { level: 2, name: 'Adoption' })).toBeVisible();
    await expect(page.getByTestId('chart-adoption')).toBeVisible();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`analytics has no serious axe violations (${theme})`, async ({ page, request }) => {
      test.setTimeout(90_000);
      await quoteInEngReview(request);
      await signInAs(page, 'leadership', theme);
      await page.goto('/analytics');
      await expect.poll(() => page.locator('[data-chart-card]').count()).toBeGreaterThanOrEqual(14);
      await expect(page.getByTestId('analytics-footer')).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    });
  }
});

test.describe('B-26 analytics lenses (A5)', () => {
  test('an engineering lead lands on the Engineering lens and can open the leadership report', async ({
    page,
  }) => {
    await signInAs(page, 'eng-lead');
    await page.goto('/analytics');
    await expect(page.getByTestId('analytics-page')).toHaveAttribute('data-lens', 'engineering');
    const lens = page.getByTestId('engineering-lens');
    await expect(
      lens.getByRole('heading', { level: 2, name: 'The queue right now' }),
    ).toBeVisible();
    await expect(lens.getByRole('heading', { level: 2, name: 'Capacity sign-off' })).toBeVisible();
    await expect(page.getByTestId('chart-eng-load')).toBeVisible();
    await expect(page.getByTestId('chart-g2-outcomes')).toBeVisible();
    await page.getByTestId('lens-leadership').click();
    await expect(page.getByTestId('analytics-page')).toHaveAttribute('data-lens', 'leadership');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Reasons', exact: true }),
    ).toBeVisible();
  });

  test('a pricer sees the leadership report only, with awards pending commitment', async ({
    page,
  }) => {
    await signInAs(page, 'pricing');
    await page.goto('/analytics');
    await expect(page.getByTestId('lens-engineering')).toHaveCount(0);
    await expect(page.getByTestId('stat-commitment-pending')).toBeVisible();
  });
});
