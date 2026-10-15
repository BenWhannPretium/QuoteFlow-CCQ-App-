import { expect, test } from '@playwright/test';

test('home page shows API health with db up', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('System health')).toBeVisible();
  await expect(page.getByTestId('health-db')).toHaveText('up');
  await expect(page.getByTestId('health-status')).toHaveText('ok');
});

test('client-side routes fall back to the SPA', async ({ page }) => {
  const res = await page.goto('/some/client/route');
  expect(res?.status()).toBe(200);
  await expect(page.getByText('QuoteFlow').first()).toBeVisible();
});

test('unknown API routes return problem+json', async ({ request }) => {
  const res = await request.get('/api/v1/does-not-exist');
  expect(res.status()).toBe(404);
  expect(res.headers()['content-type']).toContain('application/problem+json');
});
