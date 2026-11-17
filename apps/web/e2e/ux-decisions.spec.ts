import { fileURLToPath } from 'node:url';

import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Locator,
} from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// UX proposals approved 2026-11-17 (docs/audit/03-ux-proposals.md), the decisions area:
// - UX-004 (a): a quote that is already on hold is not offered Hold again.
// - The score breakdown in the decision dialog is closed when the dialog opens.

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });

async function ok(res: Promise<APIResponse>, status = 200) {
  const r = await res;
  expect(r.status(), await r.text()).toBe(status);
  return r;
}

/** Provisions the persona (the e2e database is config-seeded only) and returns who it is. */
const me = async (request: APIRequestContext, persona: string) =>
  (
    (await (await request.get('/api/v1/me', { headers: as(persona) })).json()) as {
      user: { id: string; displayName: string };
    }
  ).user;

/** AUDIT_SCREENS=1 saves the proposal's screenshot under docs/audit/screens/. */
const screen = (name: string) =>
  fileURLToPath(new URL(`../../../docs/audit/screens/${name}.png`, import.meta.url));
const AUDIT_SCREENS = process.env.AUDIT_SCREENS === '1';

const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** A submitted quote waiting for G1. */
async function waitingForG1(request: APIRequestContext): Promise<string> {
  for (const p of ['kam', 'sales-leader']) await me(request, p);
  return submitQuote(request, await freeOpportunities(request, 1));
}

/** The choices a decision dialog offers, in order (each radio's accessible name). */
const choices = (dialog: Locator) =>
  dialog.getByRole('radio').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));

test('UX-004: a quote on hold is not offered Hold again; a quote not on hold still is', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const leader = await me(request, 'sales-leader');
  const held = await waitingForG1(request);
  const open = await waitingForG1(request);
  await ok(
    request.post(`/api/v1/quotes/${held}/gates/G1/decisions`, {
      headers: as('sales-leader'),
      data: {
        outcomeKey: 'hold',
        reasonCode: 'awaiting_customer_info',
        note: 'Customer is confirming the volume',
        holdUntil: daysFromNow(14),
        holdOwnerId: leader.id,
      },
    }),
    201,
  );

  await page.setViewportSize({ width: 1366, height: 850 });
  await signInAs(page, 'sales-leader', 'light');
  await page.goto('/approvals?gate=G1');
  const dialog = page.getByRole('dialog');

  // The quote on hold: every choice but Hold.
  await page
    .locator(`[data-testid="queue-item"][data-quote="${held}"]`)
    .getByRole('button', { name: `Decide ${held}` })
    .click();
  await expect(dialog.getByRole('radio', { name: 'Advance', exact: true })).toBeVisible();
  expect(await choices(dialog)).toEqual([
    'Advance',
    'Send back to…',
    'Stop: not CCQ work (send elsewhere)',
    'Stop',
  ]);
  await expect(dialog.getByRole('group', { name: 'Hold', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('radio', { name: 'Hold', exact: true })).toHaveCount(0);
  if (AUDIT_SCREENS) await page.screenshot({ path: screen('UX-004') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // A quote that is not on hold: Hold is offered as before.
  await page
    .locator(`[data-testid="queue-item"][data-quote="${open}"]`)
    .getByRole('button', { name: `Decide ${open}` })
    .click();
  await expect(dialog.getByRole('radio', { name: 'Hold', exact: true })).toBeVisible();
  expect(await choices(dialog)).toEqual([
    'Advance',
    'Send back to…',
    'Hold',
    'Stop: not CCQ work (send elsewhere)',
    'Stop',
  ]);
  await page.keyboard.press('Escape');

  // The server still refuses a second hold (two tabs), and says how a hold ends: nothing is called Resume.
  const again = await request.post(`/api/v1/quotes/${held}/gates/G1/decisions`, {
    headers: as('sales-leader'),
    data: {
      outcomeKey: 'hold',
      reasonCode: 'awaiting_customer_info',
      note: 'Still waiting',
      holdUntil: daysFromNow(21),
      holdOwnerId: leader.id,
    },
  });
  expect(again.status()).toBe(409);
  expect(((await again.json()) as { detail: string }).detail).toBe(
    'This quote is already on hold. Record a decision to end the hold.',
  );
});

test('the score breakdown is closed when the decision dialog opens, and opens from the keyboard', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const qn = await waitingForG1(request);
  // A laptop: 1366 px wide, 850 px of page.
  await page.setViewportSize({ width: 1366, height: 850 });
  await signInAs(page, 'sales-leader', 'light');
  await page.goto('/approvals?gate=G1');
  await page
    .locator(`[data-testid="queue-item"][data-quote="${qn}"]`)
    .getByRole('button', { name: `Decide ${qn}` })
    .click();
  const dialog = page.getByRole('dialog');
  const priority = dialog.getByTestId('decision-priority');
  const summary = priority.locator('summary');
  const breakdown = priority.getByTestId('score-breakdown');

  // Closed, with the score, the tier and "advisory" on the one line that stays.
  await expect(summary).toBeVisible();
  await expect(summary).toHaveText(/^Priority \d+(\.\d+)? · .+ \(advisory\)$/);
  await expect(priority).toHaveJSProperty('open', false);
  await expect(breakdown).toBeHidden();

  // The first choice is on the screen without scrolling the dialog.
  const first = dialog.getByRole('radio').first();
  await expect(first).toHaveAccessibleName('Advance');
  await expect(first).toBeInViewport({ ratio: 1 });
  expect(await dialog.evaluate((el) => el.scrollTop)).toBe(0);
  if (AUDIT_SCREENS) await page.screenshot({ path: screen('UX-score-breakdown') });

  // One key press opens the evidence, another closes it.
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(priority).toHaveJSProperty('open', true);
  await expect(breakdown).toBeVisible();
  await expect(breakdown).toContainText('Capital exposure');
  for (const column of ['Attribute', 'Weight', 'Points', 'Adds']) {
    await expect(breakdown.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
  }
  await expect(priority).toContainText('Advisory only');
  expect(await seriousViolations(page)).toEqual([]);
  await page.keyboard.press('Space');
  await expect(priority).toHaveJSProperty('open', false);
  await expect(breakdown).toBeHidden();
});
