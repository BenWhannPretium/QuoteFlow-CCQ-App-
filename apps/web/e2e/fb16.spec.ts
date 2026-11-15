import { expect, test, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// FB-16 (W13-15, W13-17, W13-18, W13-19): the Production Scheduler owns the capacity part of a quote.
// The engineering lead assigns them next to the engineer; a block goes straight back to the engineer
// with the scheduler's note and the KAM is told; the lead can send work back to either person; and the
// lead approves capacity inside "Decide feasibility" when nobody has signed it off yet.
// (The plant-first "Process & machine type" pick, the as-you-type validation and the pack-out rule are
// covered by engineering.spec.ts.)

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });

/** A quote in Engineering with the engineer assigned, the review started and the solution saved. */
async function inEngineering(request: Parameters<typeof submitQuote>[0]) {
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
  const engineer = await idOf('engineer');
  const scheduler = await idOf('production-scheduler');
  await idOf('eng-lead');
  await call('post', 'gates/G1/decisions', 'sales-leader', { outcomeKey: 'advance' });
  await call('post', 'assignment', 'eng-lead', { engineerId: engineer.id });
  await call('post', 'eng-review/accept', 'engineer');
  await call('put', 'eng-review', 'engineer', {
    plantCode: 'AURORA',
    machineType: 'EBM',
    cavitation: 8,
    cycleTimeS: 14.5,
  });
  return { quoteNumber, call, engineer, scheduler };
}

test('the scheduler works capacity, blocks it, and the work goes straight back to the engineer', async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const { quoteNumber, engineer, scheduler } = await inEngineering(request);
  const open = async (persona: string): Promise<Page> => {
    const page = await (await browser.newContext()).newPage();
    await signInAs(page, persona);
    return page;
  };

  // ── The lead adds the production scheduler in the assign dialog (suggested, never chosen for them) ──
  const lead = await open('eng-lead');
  await lead.goto(`/quotes/${quoteNumber}?tab=engineering`);
  await lead.getByTestId('engineering-tab').getByRole('button', { name: 'Reassign' }).click();
  const assign = lead.getByRole('dialog');
  const picker = assign.getByLabel('Production scheduler (optional)');
  await expect(picker).toBeVisible();
  await picker.selectOption({ value: scheduler.id });
  await assign.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(assign).toHaveCount(0);
  // The quote header names both assignees.
  await expect(lead.getByTestId('quote-assignees')).toContainText(engineer.displayName);
  await expect(lead.getByTestId('quote-assignees')).toContainText(scheduler.displayName);

  // ── The scheduler is told, finds it under "Capacity requests" and opens their part ──
  const sched = await open('production-scheduler');
  await sched.goto('/');
  await expect(sched.getByTestId('notification-bell')).toHaveAccessibleName(/unread/);
  await sched.goto('/queue/engineering');
  await expect(sched.getByRole('heading', { name: 'Capacity requests', level: 1 })).toBeVisible();
  const mine = sched.getByTestId('my-assignment').filter({ hasText: quoteNumber });
  await expect(mine).toContainText('Capacity not signed off yet');
  await mine.getByRole('link', { name: quoteNumber }).click();
  const tab = sched.getByTestId('engineering-tab');
  // The solution is the engineer's part: read-only here. Capacity is "Your part".
  await expect(tab.getByTestId('solution-form')).toHaveCount(0);
  await expect(tab.getByTestId('part-engineer')).toHaveText('Engineer’s part');
  await expect(tab.getByTestId('part-scheduler').first()).toHaveText('Your part');

  const capacity = tab.getByTestId('capacity-form');
  await capacity.getByRole('button', { name: 'Add capacity row' }).click();
  const row = capacity.getByTestId('capacity-row');
  // The Site offers the plants that run the solution's machine type (EBM), not every plant.
  await expect(row.getByLabel('Site').locator('option', { hasText: 'Peru' })).toHaveCount(0);
  await row.getByLabel('Assumed effectiveness %').fill('70');
  await row.getByLabel('Utilization before %').fill('95');
  await capacity.getByRole('button', { name: 'Save capacity evidence' }).click();
  await expect(sched.getByText('Capacity evidence saved')).toBeVisible();

  // ── Block: a note is required; the work returns to the engineer at once ──
  const signoff = tab.getByTestId('capacity-signoff');
  await expect(signoff.getByRole('button', { name: 'Block capacity' })).toBeDisabled();
  await signoff.getByLabel('Sign-off note').fill('Line 4 is full until March.');
  await signoff.getByRole('button', { name: 'Block capacity' }).click();
  await expect(signoff.getByTestId('capacity-signoff-status')).toContainText('Capacity blocked');
  expect(await seriousViolations(sched)).toEqual([]);

  // ── The engineer sees it returned, with the blocker's note, and can edit again ──
  const eng = await open('engineer');
  await eng.goto('/');
  await expect(eng.getByTestId('notification-bell')).toHaveAccessibleName(/unread/);
  await eng.goto(`/quotes/${quoteNumber}?tab=engineering`);
  await expect(eng.getByTestId('lead-review-returned')).toContainText(
    'Capacity blocked: Line 4 is full until March.',
  );
  await expect(eng.getByTestId('solution-form')).toBeVisible();
  // The engineer does not sign capacity off: no buttons on the card.
  await expect(
    eng.getByTestId('capacity-signoff').getByRole('button', { name: 'Approve capacity' }),
  ).toHaveCount(0);
  // The block is on the quote's timeline, with its reason.
  await eng.goto(`/quotes/${quoteNumber}`);
  await expect(
    eng.getByText('Capacity blocked: Line 4 is full until March.').first(),
  ).toBeVisible();

  // ── The KAM is told in the bell (in-app) ──
  const kam = await open('kam');
  await kam.goto('/');
  await kam.getByTestId('notification-bell').click();
  await expect(
    kam
      .getByTestId('notification-list')
      .getByText(`Capacity is blocked on ${quoteNumber}; Engineering is reworking it`),
  ).toBeVisible();

  // ── The lead cannot advance while capacity is blocked; the dialog shows the block note ──
  await lead.reload();
  await expect(lead.getByRole('button', { name: 'Decide feasibility' })).toHaveCount(0);
  await lead.getByTestId('decide-other').click();
  const g2 = lead.getByRole('dialog');
  await expect(g2.getByTestId('capacity-blocked-note')).toContainText(
    'Line 4 is full until March.',
  );
  await expect(g2.getByRole('radio', { name: 'Advance', exact: true })).toHaveCount(0);
});

test('the lead sends work back to the scheduler, then approves capacity inside "Decide feasibility"', async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const { quoteNumber, call, engineer, scheduler } = await inEngineering(request);
  await call('post', 'assignment', 'eng-lead', {
    engineerId: engineer.id,
    schedulerId: scheduler.id,
  });
  await call('put', 'capacity-evidence', 'production-scheduler', {
    rows: [
      {
        site: 'AURORA',
        assumedEffectivenessPct: 70,
        cycleTimeS: 14.5,
        utilizationBeforePct: 62,
        analysisDate: '2026-11-14',
        analystId: scheduler.id,
      },
    ],
  });
  await call('post', 'eng-review/submit', 'engineer');
  const open = async (persona: string): Promise<Page> => {
    const page = await (await browser.newContext()).newPage();
    await signInAs(page, persona);
    return page;
  };

  // ── "Send back to…" offers the engineer (default) or the production scheduler ──
  const lead = await open('eng-lead');
  await lead.goto(`/quotes/${quoteNumber}?tab=engineering`);
  await lead.getByRole('button', { name: 'Send back to…' }).click();
  const back = lead.getByRole('dialog');
  const target = back.getByTestId('send-back-target');
  await expect(target.getByRole('radio', { name: /^Engineer/ })).toBeChecked();
  await target.getByRole('radio', { name: /^Production scheduler/ }).check();
  await back.getByLabel('What should change?').fill('Check the effectiveness on line 4.');
  await back.getByRole('button', { name: 'Send back', exact: true }).click();
  await expect(back).toHaveCount(0);
  await expect(lead.getByTestId('lead-review-returned')).toContainText(scheduler.displayName);
  expect(await seriousViolations(lead)).toEqual([]);

  // The scheduler is the one who is told; the engineer submits again once it is fixed.
  const sched = await open('production-scheduler');
  await sched.goto('/');
  await sched.getByTestId('notification-bell').click();
  await expect(sched.getByTestId('notification-list')).toContainText(quoteNumber);
  await call('post', 'eng-review/submit', 'engineer');

  // ── Capacity is not signed off yet: the lead signs it off with the decision, in one step ──
  await lead.reload();
  // The header offers the same decision; the tab's own button is the one under test.
  await lead
    .getByTestId('engineering-tab')
    .getByRole('button', { name: 'Decide feasibility' })
    .click();
  const g2 = lead.getByRole('dialog');
  await g2.getByRole('radio', { name: 'Advance', exact: true }).check();
  const tick = g2.getByRole('checkbox', { name: /Capacity approved \(I’m signing it off\)/ });
  await expect(tick).toBeVisible();
  // Required: without the tick the decision is not recorded.
  await g2.getByRole('button', { name: 'Record decision' }).click();
  await expect(g2.getByRole('alert')).toContainText('Tick “Capacity approved”');
  await tick.check();
  expect(await seriousViolations(lead)).toEqual([]);
  await g2.getByRole('button', { name: 'Record decision' }).click();
  await expect(g2).toHaveCount(0);
  await expect(lead.getByTestId('quote-detail')).toHaveAttribute('data-stage', 'QUOTING');
  await lead.goto(`/quotes/${quoteNumber}?tab=engineering`);
  await expect(lead.getByTestId('capacity-signoff-status')).toContainText('Capacity approved');
});
