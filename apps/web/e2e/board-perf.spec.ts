import { expect, test } from '@playwright/test';

import { signInAs } from './personas';

// B-14 performance target (architecture §9): the board renders in < 1.5 s on 500 open quotes.
// Opt-in, against the database `pnpm --filter @ccq/api test:perf` builds (≥ 500 open quotes):
//   PERF_E2E=1 DATABASE_URL=postgres://ccq:ccq@localhost:5432/ccq_test_perf \
//     pnpm --filter @ccq/web exec playwright test --config e2e/playwright.config.ts board-perf
test.skip(!process.env.PERF_E2E, 'set PERF_E2E=1 (see the comment above)');

const BUDGET_MS = 1_500;

test(`the board renders every open card in < ${BUDGET_MS} ms`, async ({ page }) => {
  await signInAs(page, 'admin');
  // Warm: sign-in provisioning, config and the JS bundle are cached like a returning user's.
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();

  const start = Date.now();
  await page.goto('/board');
  await expect(
    page.locator('[data-column="ENG_REVIEW"] [data-testid="board-card"]').first(),
  ).toBeVisible();
  const expected = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-column]:not([data-column="__closed__"]) [data-testid="column-count"]',
      ),
    ]
      .map((el) => Number(/\d+/.exec(el.textContent ?? '')?.[0] ?? 0))
      .reduce((a, b) => a + b, 0),
  );
  await expect(page.locator('[data-testid="board-card"]')).toHaveCount(expected);
  const elapsed = Date.now() - start;
  test
    .info()
    .annotations.push({ type: 'board render', description: `${expected} cards in ${elapsed} ms` });
  process.stderr.write(`[perf] board render: ${expected} cards in ${elapsed} ms\n`);
  expect(expected).toBeGreaterThanOrEqual(500);
  expect(elapsed).toBeLessThan(BUDGET_MS);
});
