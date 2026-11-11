import { expect, test } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// B-09: governed overrides end to end (tier with approval and revert; ship-to self-applied), the
// quote timeline with filters and an @mention comment, and the Leadership audit pages.

test('tier override: only a SalesLeader overrides (self-applied, with a justification), then reverts from the timeline', async ({
  page,
  request,
}) => {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));

  // FB-04 (F-065, D-028): the KAM has no override option, only a pointer to escalation.
  await signInAs(page, 'kam');
  await page.goto(`/quotes/${quoteNumber}`);
  const priority = page.getByTestId('quote-priority');
  await expect(priority.getByRole('button', { name: 'Override priority tier' })).toHaveCount(0);
  await expect(priority.getByTestId('priority-escalate-hint')).toHaveText(
    'Need a different priority? Escalate to your sales leader.',
  );

  // SalesLeader: override the tier; the justification needs 15+ characters and applies at once.
  await signInAs(page, 'sales-leader');
  await page.goto(`/quotes/${quoteNumber}`);
  await page
    .getByTestId('quote-priority')
    .getByRole('button', { name: 'Override priority tier' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Override priority tier' });
  await expect(dialog).toContainText('Applies now and is logged with your reason');
  await dialog.getByLabel('New tier').selectOption({ label: 'Critical' });
  await expect(dialog.getByTestId('override-current-requested')).toContainText('Critical');
  await dialog.getByLabel('Justification (required)').fill('Too short');
  await dialog.getByRole('button', { name: 'Apply override' }).click();
  await expect(dialog.getByRole('alert')).toContainText('at least 15 characters');
  expect(await seriousViolations(page)).toEqual([]);
  await dialog
    .getByLabel('Justification (required)')
    .fill('Strategic launch with the national account this quarter');
  await dialog.getByRole('button', { name: 'Apply override' }).click();
  await expect(dialog).toHaveCount(0);

  // The quote shows the copper marker (original + justification), the priority panel repeats the
  // justification for Engineering (T-024), and the timeline has the entry.
  const marker = page.getByTestId('overridden-priority_tier');
  await expect(marker).toBeVisible();
  await expect(marker).toHaveAccessibleName(/Original: .+ Why: Strategic launch/);
  await expect(page.getByTestId('priority-override-note')).toContainText(
    'Strategic launch with the national account this quarter',
  );
  const timeline = page.getByTestId('quote-timeline');
  await timeline.getByRole('button', { name: 'Overrides' }).click();
  await expect(timeline.getByText(/Priority tier overridden: .+ → Critical/)).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  // One-click revert (confirmed), back to the original.
  await timeline.getByTestId('revert-override').first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revert' }).click();
  await expect(page.getByText('Override reverted', { exact: true })).toBeVisible();
  await expect(page.getByTestId('overridden-priority_tier')).toHaveCount(0);
  await expect(timeline.getByText(/Priority tier override reverted/)).toBeVisible();
});

test('ship-to: the KAM self-applies with a reason; the timeline and a comment with an @mention', async ({
  page,
  request,
}) => {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  const leader = (await (
    await request.get('/api/v1/me', { headers: { [DEV_USER_HEADER]: 'sales-leader' } })
  ).json()) as { user: { displayName: string } };

  await signInAs(page, 'kam');
  await page.goto(`/quotes/${quoteNumber}`);
  await page.getByRole('button', { name: 'Override ship-to' }).click();
  const dialog = page.getByRole('dialog', { name: 'Override ship-to' });
  await dialog.getByLabel('Street').fill('99 Co-packer Way');
  await dialog.getByLabel('City').fill('Columbus');
  await dialog.getByLabel('State').fill('OH');
  await dialog
    .getByLabel('Justification (required)')
    .fill('The customer fills this line at a co-packer');
  await dialog.getByRole('button', { name: 'Apply override' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('ship-to-value')).toContainText('99 Co-packer Way, Columbus, OH');
  await expect(page.getByTestId('overridden-ship_to')).toBeVisible();

  // Comment with an @mention picked from the user list.
  const box = page.getByTestId('comment-box');
  await box.fill('Heads up ');
  // The picker searches the word typed after @ (here part of the dev persona's name).
  await box.pressSequentially('@sales');
  await page.getByRole('option', { name: new RegExp(leader.user.displayName) }).click();
  await box.pressSequentially('the ship-to moved, **please** check freight');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();

  const timeline = page.getByTestId('quote-timeline');
  const comment = timeline.getByTestId('comment-body').first();
  await expect(comment).toContainText('please');
  await expect(comment.locator('strong')).toHaveText('please');
  await expect(comment.locator('[data-mention]')).toHaveText(`@${leader.user.displayName}`);

  // Filter chips.
  await timeline.getByRole('button', { name: 'Comments' }).click();
  await expect(timeline.getByTestId('timeline-item')).toHaveCount(1);
  await timeline.getByRole('button', { name: 'Decisions' }).click();
  await expect(timeline.getByText('Quote created from the Salesforce opportunity')).toBeVisible();
  await timeline.getByRole('button', { name: 'Overrides' }).click();
  await expect(timeline.getByText(/Ship-to overridden: .+ → 99 Co-packer Way/)).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  // DR-engineering-06: a double-click on Comment posts one comment.
  await timeline.getByRole('button', { name: 'Comments' }).click();
  await box.fill('Posted once even on a double-click');
  await page.getByRole('button', { name: 'Comment', exact: true }).dblclick();
  await expect(timeline.getByText('Posted once even on a double-click')).toHaveCount(1);
  await page.reload();
  await page.getByTestId('quote-timeline').getByRole('button', { name: 'Comments' }).click();
  await expect(
    page.getByTestId('quote-timeline').getByText('Posted once even on a double-click'),
  ).toHaveCount(1);
});

test('Leadership reads the audit log and the usage report; a KAM cannot', async ({ page }) => {
  await signInAs(page, 'leadership');
  await page.goto('/');
  // B-19: Leadership's nav item is Admin (read-only console); the audit log is a card on its hub.
  await page.getByRole('navigation', { name: 'Primary' }).locator('[data-nav="admin"]').click();
  await page
    .getByRole('navigation', { name: 'Reports and audit' })
    .getByRole('link', { name: /Audit log/ })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Audit events, newest first' })).toBeVisible();
  await page.getByLabel('Action').selectOption('sign in');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByRole('cell', { name: 'sign in' }).first()).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  const content = page.getByTestId('page');
  await content.getByRole('link', { name: 'Usage report' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Usage report' })).toBeVisible();
  await expect(page.getByTestId('usage-dau')).toContainText('Leadership');
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByTestId('page').getByRole('link', { name: 'Audit log' }).click();
  await page.getByTestId('page').getByRole('link', { name: 'Override log' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Override log' })).toBeVisible();

  await signInAs(page, 'kam');
  await page.goto('/admin/audit');
  await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toHaveCount(0);
});
