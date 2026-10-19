import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// B-18: the bell (unread count, per-item read, mark all read), the /notifications page and the email
// preferences page. Quotes are created and advanced through the API (intake and G1 have their own specs).

async function openAs(browser: Browser, persona: string, theme?: 'light' | 'dark') {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, persona, theme);
  return page;
}

async function advanceNewQuote(request: APIRequestContext) {
  // Provision the EngLead (the e2e database is config-seeded only) so the arrival alert has a recipient.
  await request.get('/api/v1/me', { headers: { [DEV_USER_HEADER]: 'eng-lead' } });
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  const advance = await request.post(`/api/v1/quotes/${quoteNumber}/gates/G1/decisions`, {
    headers: { [DEV_USER_HEADER]: 'sales-leader' },
    data: { outcomeKey: 'advance', note: 'e2e: qualified' },
  });
  expect(advance.status(), await advance.text()).toBe(201);
  return quoteNumber;
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('bell → notification opens the quote and is read; the page lists, filters and marks read', async ({
  browser,
  request,
}) => {
  test.setTimeout(90_000);
  const quoteNumber = await advanceNewQuote(request);
  const lead = await openAs(browser, 'eng-lead');

  // The badge counts unread; the bell's list shows the alert with a link to all of them.
  await lead.goto('/');
  const bell = lead.getByTestId('notification-bell');
  await expect(bell).toHaveAccessibleName(/\d+ unread/);
  const unreadBefore = Number((await bell.getAttribute('aria-label'))!.match(/(\d+) unread/)![1]);
  await bell.click();
  const item = lead.getByTestId('notification-list').getByRole('link', {
    name: new RegExp(`${quoteNumber} is in the engineering queue`),
  });
  await expect(item).toBeVisible();
  await expect(item.getByTestId('unread-dot')).toBeVisible();

  // Opening it goes to the Engineering tab and marks it read: the count drops by one.
  await item.click();
  await expect(lead).toHaveURL(new RegExp(`/quotes/${quoteNumber}\\?tab=engineering`));
  await expect(bell).toHaveAccessibleName(
    unreadBefore === 1 ? 'Notifications' : `Notifications, ${unreadBefore - 1} unread`,
  );

  // The full page: newest first, with the read state shown, and an Unread filter.
  await lead.getByTestId('notification-bell').click();
  await lead.getByTestId('notifications-view-all').click();
  await expect(lead).toHaveURL(/\/notifications$/);
  await expect(lead.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
  const row = lead
    .getByTestId('notification-page-list')
    .getByRole('listitem')
    .filter({ hasText: `${quoteNumber} is in the engineering queue` });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('unread-dot')).toHaveCount(0); // read when it was opened
  expect(await seriousViolations(lead)).toEqual([]);

  // Another quote's alert is still unread: mark it read from the page, without leaving it.
  const second = await advanceNewQuote(request);
  await lead.reload();
  const unreadRow = lead
    .getByTestId('notification-page-list')
    .getByRole('listitem')
    .filter({ hasText: `${second} is in the engineering queue` });
  await expect(unreadRow.getByTestId('unread-dot')).toBeVisible();
  await lead.getByTestId('filter-unread').click();
  await expect(lead).toHaveURL(/filter=unread/);
  await expect(unreadRow).toHaveCount(1);
  await unreadRow.getByRole('button', { name: /^Mark read:/ }).click();
  await expect(unreadRow).toHaveCount(0);

  // Mark all read clears the badge, and the Unread view is empty.
  await lead.getByRole('button', { name: 'Mark all read' }).click();
  await expect(lead.getByTestId('notification-bell')).toHaveAccessibleName('Notifications');
  await expect(lead.getByText('Nothing unread')).toBeVisible();
});

test('email preferences: one switch per emailed event, saved at once, kept after a reload', async ({
  browser,
  request,
}) => {
  test.setTimeout(60_000);
  await request.get('/api/v1/me', { headers: { [DEV_USER_HEADER]: 'engineer' } });
  // Start from the default (everything on), whatever an earlier run left behind.
  await request.put('/api/v1/me/preferences', {
    headers: { [DEV_USER_HEADER]: 'engineer' },
    data: { email: { 'quote.assigned': true, 'quote.to_qualify': true } },
  });
  const page = await openAs(browser, 'engineer', 'dark');
  await page.goto('/');

  // From the account menu.
  await page.getByTestId('user-menu').click();
  await page.getByTestId('email-preferences-link').click();
  await expect(page).toHaveURL(/\/me\/preferences$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Email preferences' })).toBeVisible();
  await expect(page.getByText('cannot be switched off')).toBeVisible();

  const assigned = page.getByRole('checkbox', { name: /A quote is assigned or reassigned to you/ });
  const digest = page.getByRole('checkbox', { name: /Quotes waiting to qualify/ });
  await expect(assigned).toBeChecked();
  await expect(digest).toBeChecked();
  await expect(page.getByText('One email each morning', { exact: true })).toBeVisible();
  // Events with no email (overrides, integration failures) are not offered.
  await expect(page.getByRole('checkbox', { name: /override/i })).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);

  await assigned.uncheck();
  await expect(assigned).not.toBeChecked();
  await page.reload();
  await expect(
    page.getByRole('checkbox', { name: /A quote is assigned or reassigned to you/ }),
  ).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Quotes waiting to qualify/ })).toBeChecked();

  // Put it back for the next run.
  await page.getByRole('checkbox', { name: /A quote is assigned or reassigned to you/ }).check();
  await expect(
    page.getByRole('checkbox', { name: /A quote is assigned or reassigned to you/ }),
  ).toBeChecked();
  expect(await seriousViolations(page)).toEqual([]);
});

test.describe('390 × 844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the bell, the page and the preferences fit the phone with no horizontal scroll', async ({
    browser,
    request,
  }) => {
    test.setTimeout(60_000);
    await advanceNewQuote(request);
    const lead = await openAs(browser, 'eng-lead', 'light');
    await lead.goto('/notifications');
    await expect(lead.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
    expect(await overflow(lead)).toBeLessThanOrEqual(0);
    await lead.goto('/me/preferences');
    await expect(lead.getByRole('heading', { level: 1, name: 'Email preferences' })).toBeVisible();
    expect(await overflow(lead)).toBeLessThanOrEqual(0);
    // Each switch is a 44 px tall touch target.
    const box = await lead
      .getByRole('checkbox')
      .first()
      .locator('xpath=ancestor::label')
      .boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});
