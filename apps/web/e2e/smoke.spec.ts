import { expect, test } from '@playwright/test';

test('signed-out users get the branded sign-in page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Pretium Packaging')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible();
});

test('client-side routes fall back to the SPA', async ({ page }) => {
  const res = await page.goto('/some/client/route');
  expect(res?.status()).toBe(200);
  await expect(page.getByText('QuoteFlow').first()).toBeVisible();
});

test('API health is public and reports db up', async ({ request }) => {
  const res = await request.get('/api/v1/health');
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: 'ok', db: 'up' });
});

test('auth config tells the SPA to use Entra', async ({ request }) => {
  const res = await request.get('/api/v1/auth/config');
  expect(await res.json()).toMatchObject({
    authMode: 'entra',
    apiScope: 'api://quoteflow-e2e/access_as_user',
  });
});

test('GET /me without a token is 401 problem+json', async ({ request }) => {
  const res = await request.get('/api/v1/me');
  expect(res.status()).toBe(401);
  expect(res.headers()['content-type']).toContain('application/problem+json');
  expect(res.headers()['www-authenticate']).toMatch(/^Bearer/);
});

test('dev personas are refused in production', async ({ request }) => {
  const res = await request.get('/api/v1/me', { headers: { 'x-dev-user': 'admin' } });
  expect(res.status()).toBe(401);
});

test('unknown API routes return problem+json', async ({ request }) => {
  const res = await request.get('/api/v1/does-not-exist');
  expect(res.status()).toBe(404);
  expect(res.headers()['content-type']).toContain('application/problem+json');
});
