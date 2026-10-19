import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';

// B-19 acceptance: an Admin (Bailey, interim approver) changes a reason code, the validity default
// and the scoring weights without a code change, and the decision log shows who / what / why.
// The e2e database is shared with the other specs, so the test puts every value back: the weights go
// back to their original values before the version is activated (the rescore then changes nothing).

const WHY = 'Agreed with Bailey at the M4 config review';
const admin = { 'x-dev-user': 'admin' };

async function adminGet<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(path, { headers: admin });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as T;
}

async function saveChange(page: Page, submit = 'Save change') {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Why are you making this change?').fill(WHY);
  await dialog.getByRole('button', { name: submit }).click();
  await expect(dialog).toBeHidden();
}

test.describe.configure({ mode: 'serial' });

test('Admin changes a reason code, the validity default and the weights; the decision log shows who and why', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  type Code = { id: string; version: number; context: string; label: string; active: boolean };
  type Setting = { key: string; version: number; value: unknown };
  const codes = await adminGet<{ items: Code[] }>(request, '/api/v1/admin/config/reason-codes');
  const lost = codes.items.find((c) => c.context === 'lost' && c.active)!;
  const settings = await adminGet<{ items: Setting[] }>(request, '/api/v1/admin/config/settings');
  const validity = settings.items.find((s) => s.key === 'validity_days_default')!;
  const renamed = `${lost.label} (B-19 e2e)`;

  await signInAs(page, 'admin');
  try {
    // 1. Reason code
    await page.goto('/admin/reason-codes');
    await expect(page.getByRole('heading', { level: 1, name: 'Reason codes' })).toBeVisible();
    await page.getByRole('button', { name: `Edit ${lost.label}`, exact: true }).click();
    await page.getByRole('dialog').getByLabel('Label').fill(renamed);
    await page.getByRole('dialog').getByLabel('Approval').selectOption('approve');
    await saveChange(page);
    const entry = page.getByTestId('list-entry').filter({ hasText: renamed });
    await expect(entry).toBeVisible();
    await expect(entry.getByText(/Approved/)).toBeVisible();

    // 2. Validity default
    await page.goto('/admin/settings');
    await page.getByRole('button', { name: 'Edit Default proposal validity (days)' }).click();
    await page
      .getByRole('dialog')
      .getByLabel('Value')
      .fill(String(Number(validity.value) + 15));
    await saveChange(page);
    await expect(
      page.getByTestId('setting-validity_days_default').getByTestId('setting-value'),
    ).toHaveText(String(Number(validity.value) + 15));

    // 3. Weights: a new version, edited with a live preview, then activated.
    await page.goto('/admin/scoring');
    await page.getByRole('button', { name: 'Create new version' }).click();
    await saveChange(page, 'Create draft');
    const revenue = page.getByLabel('Weight of Estimated annual revenue');
    const volume = page.getByLabel('Weight of Estimated annual volume');
    await expect(revenue).toBeEditable();
    const [rev0, vol0] = [await revenue.inputValue(), await volume.inputValue()];
    await revenue.fill('0.3');
    await expect(page.getByTestId('weight-sum')).toContainText('Must be 1');
    await expect(page.getByTestId('model-problem')).toContainText('sum to 1');
    await volume.fill(String(Math.round((Number(vol0) - 0.1) * 100) / 100));
    await expect(page.getByTestId('weight-sum')).toHaveText('1');
    await expect(page.getByTestId('preview-summary')).toContainText('tier change');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await saveChange(page);

    // Put the weights back before activating, so the other specs' quotes keep their tiers.
    await revenue.fill(rev0);
    await volume.fill(vol0);
    await expect(page.getByTestId('preview-summary')).toContainText('0 tier changes');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await saveChange(page);
    await page.getByRole('button', { name: /^Activate v\d+$/ }).click();
    await saveChange(page, 'Activate');
    await expect(page.getByRole('button', { name: /^v\d+ Active/ }).first()).toBeVisible();

    // 4. The decision log: who, what, why, when.
    await page.goto('/admin/decision-log');
    const decisions = page.getByTestId('decision');
    await expect(decisions.filter({ hasText: 'Reason code: lost/' }).first()).toContainText(WHY);
    await expect(
      decisions.filter({ hasText: 'Setting: validity_days_default' }).first(),
    ).toContainText(`${Number(validity.value) + 15}`);
    const weights = decisions.filter({ hasText: 'Scoring model: v' }).filter({
      hasText: 'weights.revenue',
    });
    await expect(weights.first()).toContainText(WHY);
    await expect(decisions.first()).toContainText(/Admin|admin/i);
    expect(await seriousViolations(page)).toEqual([]);
  } finally {
    const now = await adminGet<{ items: Code[] }>(request, '/api/v1/admin/config/reason-codes');
    const code = now.items.find((c) => c.id === lost.id)!;
    await request.patch(`/api/v1/admin/config/reason-codes/${lost.id}`, {
      headers: admin,
      data: { version: code.version, changeReason: 'Reset after the B-19 e2e', label: lost.label },
    });
    const s = (
      await adminGet<{ items: Setting[] }>(request, '/api/v1/admin/config/settings')
    ).items.find((x) => x.key === 'validity_days_default')!;
    await request.patch('/api/v1/admin/config/settings/validity_days_default', {
      headers: admin,
      data: { version: s.version, changeReason: 'Reset after the B-19 e2e', value: validity.value },
    });
  }
});

test('Leadership reads the console without edit controls', async ({ page }) => {
  await signInAs(page, 'leadership');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('Read-only');
  await page.goto('/admin/settings');
  await expect(page.getByTestId('setting-validity_days_default')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0);
  await page.goto('/admin/decision-log');
  await expect(page.getByRole('heading', { level: 1, name: 'Decision log' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('other roles cannot open the console', async ({ page }) => {
  await signInAs(page, 'sales-leader');
  await page.goto('/admin/settings');
  await expect(page.getByTestId('forbidden')).toBeVisible();
});
