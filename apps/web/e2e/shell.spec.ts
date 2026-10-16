import { expect, test } from '@playwright/test';

import { PERSONA_EXPECTATIONS, signInAs, visibleNavKeys } from './personas';

test.describe('role landing and navigation', () => {
  for (const { persona, landing, nav } of PERSONA_EXPECTATIONS) {
    test(`${persona} lands on ${landing} with ${nav.join(', ')}`, async ({ page }) => {
      await signInAs(page, persona);
      await page.goto('/');
      await expect(page.getByTestId('landing')).toHaveAttribute('data-role', landing);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect.poll(() => visibleNavKeys(page)).toEqual(nav);
      await expect(page.getByTestId('dev-persona')).toHaveValue(persona);
    });
  }
});

test('nav items open their pages', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  for (const [key, title] of [
    ['intake', 'New intake'],
    ['pipeline', 'Pipeline'],
    ['analytics', 'Analytics'],
    ['admin', 'Admin'],
  ] as const) {
    await nav.locator(`[data-nav="${key}"]`).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(nav.locator(`[data-nav="${key}"]`)).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveTitle(`${title} · QuoteFlow`);
  }
});

test('multi-role users can switch dashboards', async ({ page }) => {
  await signInAs(page, 'multi-role');
  await page.goto('/');
  const tabs = page.getByRole('navigation', { name: 'Dashboard role' });
  await tabs.getByRole('link', { name: 'Sales leader' }).click();
  await expect(page.getByTestId('landing')).toHaveAttribute('data-role', 'SalesLeader');
  await expect(page).toHaveURL(/\?as=SalesLeader/);
});

test('the dev persona switcher changes who is signed in', async ({ page }) => {
  await signInAs(page, 'kam');
  await page.goto('/');
  await page.getByTestId('dev-persona').selectOption('pricing');
  await expect(page.getByTestId('landing')).toHaveAttribute('data-role', 'Pricing');
  await expect.poll(() => visibleNavKeys(page)).toContain('queue-pricing');
});

test('routes the role cannot use show the 403 page', async ({ page }) => {
  await signInAs(page, 'kam');
  await page.goto('/admin/reason-codes');
  await expect(page.getByTestId('forbidden')).toBeVisible();
  await page.goto('/approvals');
  await expect(page.getByTestId('forbidden')).toBeVisible();
});

test('unknown routes show the 404 page inside the shell', async ({ page }) => {
  await signInAs(page, 'kam');
  await page.goto('/no/such/page');
  await expect(page.getByTestId('not-found')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
});

test('an unknown quote shows not found; the admin splat renders its stub', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/quotes/CCQ-2099-00042');
  await expect(page.getByRole('heading', { level: 1, name: 'CCQ-2099-00042' })).toBeVisible();
  await expect(page.getByText('Not found')).toBeVisible();
  await page.goto('/admin/reason-codes');
  await expect(page.getByText('Configuration · reason-codes')).toBeVisible();
});

test('header search opens the pipeline with the query', async ({ page }) => {
  await signInAs(page, 'kam');
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search quotes' }).fill('Acme');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/quotes\?q=Acme/);
  await expect(page.getByText('Search: “Acme”')).toBeVisible();
});

test('theme toggle switches to dark and survives a reload', async ({ page }) => {
  await signInAs(page, 'kam');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.getByTestId('user-menu').click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByTestId('landing')).toBeVisible();
});

test('system dark mode is followed by default', async ({ page }) => {
  await signInAs(page, 'kam');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('user menu shows name and roles', async ({ page }) => {
  await signInAs(page, 'multi-role');
  await page.goto('/');
  await page.getByTestId('user-menu').click();
  await expect(page.getByTestId('user-roles')).toContainText('SalesLeader');
  await expect(page.getByTestId('user-roles')).toContainText('Approver');
});

test('skip link moves focus to the main content', async ({ page }) => {
  await signInAs(page, 'kam');
  await page.goto('/');
  await expect(page.getByTestId('landing')).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();
});

test('config bootstrap: GET /config/public serves labels from the config tables', async ({
  request,
}) => {
  const res = await request.get('/api/v1/config/public', { headers: { 'x-dev-user': 'kam' } });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { stages: { key: string; label: string }[] };
  expect(body.stages.length).toBeGreaterThan(0);
  expect(body.stages[0]).toMatchObject({ key: 'INTAKE' });
});
