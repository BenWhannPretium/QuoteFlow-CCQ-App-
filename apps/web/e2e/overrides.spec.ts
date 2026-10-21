import { expect, test } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// B-09: governed overrides end to end (tier with approval and revert; ship-to self-applied), the
// quote timeline with filters and an @mention comment, and the Leadership audit pages.

test('tier override: the KAM requests, the SalesLeader approves, then reverts from the timeline', async ({
  page,
  request,
}) => {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));

  // KAM: request a tier override (justification needs 15+ characters).
  await signInAs(page, 'kam');
  await page.goto(`/quotes/${quoteNumber}`);
  const priority = page.getByTestId('quote-priority');
  await priority.getByRole('button', { name: 'Override priority tier' }).click();
  const dialog = page.getByRole('dialog', { name: 'Override priority tier' });
  await dialog.getByLabel('New tier').selectOption({ label: 'Critical' });
  await expect(dialog.getByTestId('override-current-requested')).toContainText('Critical');
  await dialog.getByLabel('Justification (required)').fill('Too short');
  await dialog.getByRole('button', { name: 'Request override' }).click();
  await expect(dialog.getByRole('alert')).toContainText('at least 15 characters');
  expect(await seriousViolations(page)).toEqual([]);
  await dialog
    .getByLabel('Justification (required)')
    .fill('Strategic launch with the national account this quarter');
  await dialog.getByRole('button', { name: 'Request override' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('override-pending-priority_tier')).toContainText('Critical');

  // SalesLeader: approve it from Approvals → Override requests.
  await signInAs(page, 'sales-leader');
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).locator('[data-nav="approvals"]').click();
  const request_ = page.locator('[data-testid="override-request"]', { hasText: quoteNumber });
  await expect(request_).toContainText('Strategic launch with the national account');
  expect(await seriousViolations(page)).toEqual([]);
  // B-26 (A2): approving needs a note too.
  await request_.getByRole('textbox').fill('Agreed with the account plan');
  await request_.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Override approved and applied', { exact: true })).toBeVisible();
  await expect(request_).toHaveCount(0);

  // The quote shows the copper marker (original + justification) and the timeline entry.
  await page.goto(`/quotes/${quoteNumber}`);
  const marker = page.getByTestId('overridden-priority_tier');
  await expect(marker).toBeVisible();
  await expect(marker).toHaveAccessibleName(/Original: .+ Why: Strategic launch/);
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
