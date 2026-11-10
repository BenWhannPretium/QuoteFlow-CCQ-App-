import { WHERE_TO_PLAY_SUB_MARKET_POINTS } from '@ccq/domain';
import { expect, test, type APIRequestContext } from '@playwright/test';

import { seriousViolations } from './axe';
import { as, ok } from './customer-decision';
import { signInAs } from './personas';
import { freeOpportunities, submitQuote } from './quotes';

// FB-10 (priority calibration; D-004 open): an Admin compares the live scoring model with the inactive
// 9-box draft on the open quotes before anything is saved or activated (F-073, T-036), and a quote below the
// platform minimum shows a warning, never a block (F-066, T-025). Nothing live changes: the draft is not
// activated here. admin-config.spec.ts discards the seeded draft, so this spec makes the same one when it
// is not there.

const WHY = 'FB-10 e2e';
/**
 * The seeded provisional 9-box points by sub-market (packages/domain/src/scoring/where-to-play.ts):
 * 80 / 50 / 20 by colour (Melanie Rasche, 2026-11-09; FB-12 re-keyed FB-10's draft from market to sub-market).
 */
const NINE_BOX = { ...WHERE_TO_PLAY_SUB_MARKET_POINTS };

interface ScoringVersion {
  version: number;
  modelVersion: number;
  status: string;
  model: {
    attributes: {
      key: string;
      map?: { values: Record<string, number>; bySegment?: { by: string; values: object } };
    }[];
    tiers: unknown[];
    unknownScore: number;
  };
}

async function versions(request: APIRequestContext): Promise<ScoringVersion[]> {
  const res = await ok(request.get('/api/v1/admin/config/scoring', { headers: as('admin') }));
  return ((await res.json()) as { versions: ScoringVersion[] }).versions;
}

async function ensureDraft(request: APIRequestContext) {
  if ((await versions(request)).some((v) => v.status === 'draft')) return;
  await ok(
    request.post('/api/v1/admin/config/scoring/draft', {
      headers: as('admin'),
      data: { changeReason: WHY },
    }),
    201,
  );
  const draft = (await versions(request)).find((v) => v.status === 'draft')!;
  const attributes = draft.model.attributes.map((a) =>
    a.key === 'strategic_fit'
      ? {
          ...a,
          map: {
            ...a.map,
            values: {},
            bySegment: { by: 'sub_market', values: NINE_BOX },
            defaultNote: 'Pick a sub-market to score strategic fit',
          },
        }
      : a,
  );
  await ok(
    request.put('/api/v1/admin/config/scoring/draft', {
      headers: as('admin'),
      data: { version: draft.version, changeReason: WHY, model: { ...draft.model, attributes } },
    }),
  );
}

async function patchSetting(
  request: APIRequestContext,
  key: string,
  change: (value: Record<string, unknown>) => Record<string, unknown>,
) {
  const res = await ok(request.get('/api/v1/admin/config/settings', { headers: as('admin') }));
  const row = (
    (await res.json()) as { items: { key: string; version: number; value: unknown }[] }
  ).items.find((s) => s.key === key)!;
  await ok(
    request.patch(`/api/v1/admin/config/settings/${key}`, {
      headers: as('admin'),
      data: {
        version: row.version,
        changeReason: WHY,
        value: change(row.value as Record<string, unknown>),
      },
    }),
  );
}

test.describe.configure({ mode: 'serial' });

test('an Admin compares the draft with the live model on the open quotes: old tier, new tier, points moved', async ({
  page,
  request,
}) => {
  await ensureDraft(request);
  // Two open quotes in sub-markets the 9-box scores differently (80 and 20 against the live 50).
  const candidates = await freeOpportunities(request, 2);
  await submitQuote(request, candidates, { market: 'FOOD', subMarket: 'FOOD_SNACKS' });
  await submitQuote(request, candidates, { market: 'FOOD', subMarket: 'FOOD_HONEY_SWEETENERS' });

  await signInAs(page, 'admin');
  await page.goto('/admin/scoring');
  await expect(page.getByRole('heading', { level: 1, name: 'Scoring model' })).toBeVisible();

  // The draft is selected, provisional and not active; the live model is still the one in effect.
  const preview = page.getByTestId('scoring-preview');
  await expect(preview.getByRole('heading', { name: 'Preview on the open quotes' })).toBeVisible();
  await expect(page.getByTestId('preview-summary')).toContainText('open quote');
  await expect(page.getByTestId('preview-summary')).toContainText('Points moved');
  for (const col of ['Old tier', 'New tier', 'Points moved', 'What moved']) {
    await expect(preview.getByRole('columnheader', { name: col })).toBeVisible();
  }
  const rows = preview.getByTestId('preview-row');
  expect(await rows.count()).toBeGreaterThanOrEqual(2);
  // The Snacks & Confections quote moves up and the Honey & Sweeteners quote moves down.
  await expect(
    preview.getByTestId('points-moved').filter({ hasText: /^\+/ }).first(),
  ).toBeVisible();
  await expect(preview.getByTestId('points-moved').filter({ hasText: /^-/ }).first()).toBeVisible();
  await expect(rows.first()).toContainText('Strategic fit (sub-market)');
  await expect(page.getByTestId('sub-market-points')).toBeVisible();

  // Activate is a separate, audited action: a reason is required and rescoring is a choice.
  await page.getByRole('button', { name: /^Activate v\d+$/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Rescore the open quotes now')).toBeChecked();
  await expect(dialog.getByLabel('Why are you making this change?')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Nothing was activated by looking.
  expect((await versions(request)).some((v) => v.status === 'draft')).toBe(true);
});

test('Leadership sees the same preview but cannot activate or discard', async ({
  page,
  request,
}) => {
  await ensureDraft(request);
  await signInAs(page, 'leadership');
  await page.goto('/admin/scoring');
  await expect(page.getByTestId('scoring-preview')).toBeVisible();
  await expect(page.getByTestId('preview-summary')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Activate v\d+$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Discard draft' })).toHaveCount(0);
});

test('a quote below the platform minimum shows a warning at G1 and is not blocked', async ({
  page,
  request,
}) => {
  await patchSetting(request, 'intake_guardrails', (v) => ({ ...v, enabled: true }));
  try {
    const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1), {
      estAnnualVolume: 400_000,
    });
    await signInAs(page, 'sales-leader');
    await page.goto('/approvals?gate=G1');
    const card = page.locator(`[data-testid="queue-item"][data-quote="${quoteNumber}"]`);
    await card.getByRole('button', { name: `Decide ${quoteNumber}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('guardrail-note')).toContainText(
      'Below the platform minimum for our machine platforms: 400,000 units/yr. You can still submit.',
    );
    // A warning, not a block: the decision can still be recorded (advance needs no exception note).
    await dialog.getByRole('radio', { name: 'Advance' }).check();
    await expect(dialog.getByRole('button', { name: 'Record decision' })).toBeEnabled();
    expect(await seriousViolations(page)).toEqual([]);
  } finally {
    await patchSetting(request, 'intake_guardrails', (v) => ({ ...v, enabled: false }));
  }
});
