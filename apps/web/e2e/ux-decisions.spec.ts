import { fileURLToPath } from 'node:url';

import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Locator,
} from '@playwright/test';

import { seriousViolations } from './axe';
import { prepareModels } from './models';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// UX proposals approved 2026-11-17 (docs/audit/03-ux-proposals.md), the decisions area:
// - UX-004 (a): a quote that is already on hold is not offered Hold again.
// - The score breakdown in the decision dialog is closed when the dialog opens.
// - UX-010: the Final Review "Open warnings" footer says what blocks the release, and where to fix it,
//   instead of "none of them blocks it" under a blocker.

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

/**
 * In Final Review as final-review-unblock.spec.ts builds it: a tooling commitment (a Legal trigger) and
 * the terms not checked, both warnings under the seeded `g4_required_checks`. The capital terms are
 * NOT confirmed, and that check is required: it blocks the release.
 */
async function inFinalReviewUnconfirmed(request: APIRequestContext): Promise<string> {
  for (const p of ['kam', 'sales-leader', 'eng-lead', 'pricing', 'pricing-lead', 'approver']) {
    await me(request, p);
  }
  const engineer = await me(request, 'engineer');
  const pricing = await me(request, 'pricing');
  const qn = await submitQuote(request, await freeOpportunities(request, 1));
  const post = (path: string, persona: string, data: unknown) =>
    ok(request.post(`/api/v1/quotes/${qn}/${path}`, { headers: as(persona), data }), 201);
  const put = (path: string, persona: string, data: unknown) =>
    ok(request.put(`/api/v1/quotes/${qn}/${path}`, { headers: as(persona), data }));
  await post('gates/G1/decisions', 'sales-leader', { outcomeKey: 'advance' });
  await put('eng-review', 'eng-lead', {
    processType: 'EBM',
    machineType: 'EBM',
    plantCode: 'AURORA',
    cavitation: 8,
    cycleTimeS: 14.5,
    prelimCapitalUsd: 0,
  });
  await put('capacity-evidence', 'eng-lead', {
    rows: [
      {
        site: 'AURORA',
        assumedEffectivenessPct: 70,
        cycleTimeS: 14.5,
        utilizationBeforePct: 62,
        analysisDate: '2026-10-26',
        analystId: engineer.id,
      },
    ],
  });
  await put('capacity-signoff', 'eng-lead', { status: 'approved' });
  await post('gates/G2/decisions', 'eng-lead', { outcomeKey: 'proceed' });
  await prepareModels(request, qn);
  await put('pricing-record', 'pricing', {
    approvedBy: pricing.id,
    pricingBasisNote: 'March CDI',
    costingCompleted: true,
  });
  await put('capital-readiness', 'pricing', { capitalReadiness: 'pre_approved' });
  await post('gates/G3/decisions', 'pricing-lead', { outcomeKey: 'submit' });
  await put('terms', 'kam', { termsToolingCommitment: true, termsPaymentTermsCode: 'NET_30' });
  return qn;
}

test('UX-010: the Final Review warnings footer names what blocks the release, and says so only then', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const qn = await inFinalReviewUnconfirmed(request);
  const approver = await me(request, 'approver');
  await page.setViewportSize({ width: 1366, height: 850 });
  await signInAs(page, 'approver', 'light');
  await page.goto(`/quotes/${qn}/review`);
  await expect(page.getByTestId('review-screen')).toBeVisible();

  // ── Something blocks: the capital terms are not confirmed ──
  const warnings = page.getByTestId('review-warnings');
  await expect(warnings.locator('li[data-code="TERMS_NOT_CHECKED"]')).toBeVisible();
  const blockers = warnings.getByTestId('review-blockers');
  await expect(blockers).toContainText('The offer cannot be released yet. This blocks it:');
  await expect(blockers.getByRole('listitem')).toHaveCount(1);
  await expect(blockers.getByRole('listitem')).toContainText(
    "The approver's confirmation of the capital terms",
  );
  // The old footer is gone while something blocks.
  await expect(warnings.getByTestId('review-warnings-footer')).toHaveCount(0);
  await expect(warnings).not.toContainText('none of them blocks it');
  expect(await seriousViolations(page)).toEqual([]);
  if (AUDIT_SCREENS) await page.screenshot({ path: screen('UX-010') });

  // Where to fix it: the approver's own confirmation is on this page, and the link goes there.
  const termsHeading = page
    .getByTestId('review-terms-legal')
    .getByRole('heading', { level: 2, name: 'Terms and Legal', exact: true });
  await blockers.getByRole('button', { name: 'Go to Terms and Legal on this page' }).click();
  await expect(termsHeading).toBeFocused();
  await expect(termsHeading).toBeInViewport();
  // The decision dialog agrees: the same item is what is missing for Advance.
  await page
    .getByTestId('decision-bar')
    .getByRole('button', { name: 'Advance (release the offer)', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('completeness')).toContainText(
    "The approver's confirmation of the capital terms",
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // ── Nothing blocks: the approver confirms the capital terms; the warnings stay warnings ──
  await ok(
    request.put(`/api/v1/quotes/${qn}/terms/capital`, {
      headers: as('approver'),
      data: {
        toolingFundingModel: 'COMPANY_FUNDED',
        termsMoldOwnership: 'PRETIUM',
        termsAmortized: false,
        termsMinSupply: 'None',
        termsAgreementInPlace: false,
        finalized: true,
      },
    }),
  );
  await page.reload();
  await expect(warnings.locator('li[data-code="TERMS_NOT_CHECKED"]')).toBeVisible();
  await expect(warnings.getByTestId('review-warnings-footer')).toHaveText(
    'Warnings inform the decision; none of them blocks it.',
  );
  await expect(warnings.getByTestId('review-blockers')).toHaveCount(0);
  // The open checks that do not block keep their link to the Commercial panel.
  await expect(
    warnings
      .locator('li[data-code="TERMS_NOT_CHECKED"]')
      .getByRole('link', { name: 'Open the Commercial panel' }),
  ).toHaveAttribute('href', `/quotes/${qn}#commercial`);

  // ── UX-004 at Final Review: on hold, the decision bar offers every choice but Hold ──
  const bar = page.getByTestId('decision-bar');
  await expect(bar.getByRole('button', { name: 'Hold', exact: true })).toBeVisible();
  await ok(
    request.post(`/api/v1/quotes/${qn}/gates/G4/decisions`, {
      headers: as('approver'),
      data: {
        outcomeKey: 'hold',
        reasonCode: 'awaiting_customer_info',
        note: 'Customer is confirming the volume',
        holdUntil: daysFromNow(14),
        holdOwnerId: approver.id,
      },
    }),
    201,
  );
  await page.reload();
  await expect(page.getByTestId('review-on-hold')).toBeVisible();
  await expect(
    bar.getByRole('button', { name: 'Advance (release the offer)', exact: true }),
  ).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Stop (withdraw)', exact: true })).toBeVisible();
  await expect(
    bar.getByRole('button', { name: 'Send back to Quoting or Engineering', exact: true }),
  ).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Hold', exact: true })).toHaveCount(0);
});
