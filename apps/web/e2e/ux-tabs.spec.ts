import { fileURLToPath } from 'node:url';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// The quote page's tabs (UX proposals approved 2026-11-17, docs/audit/03-ux-proposals.md).
// UX-001: values typed on the Engineering and Quoting tabs survive a look at another tab; "Submit to
// lead" waits for the save; leaving the page with unsaved changes asks first.
// UX-017 (third bullet): the Engineering tab no longer says "Your role cannot see the saved figure".
// Synthetic data only: every quote is created through the API as a dev persona.

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n', 'latin1');
const LEAVE_QUESTION = 'You have unsaved changes on this quote. Leave without saving?';

const screenshotPath = (id: string) =>
  fileURLToPath(new URL(`../../../docs/audit/screens/${id}.png`, import.meta.url));
const auditScreens = process.env.AUDIT_SCREENS === '1';

/** Calls the quote's API as a persona and expects it to work. */
function caller(request: APIRequestContext, quoteNumber: string) {
  return async (method: 'post' | 'put', path: string, persona: string, data?: unknown) => {
    const res = await request[method](`/api/v1/quotes/${quoteNumber}/${path}`, {
      headers: as(persona),
      ...(data === undefined ? {} : { data }),
    });
    expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
    return res;
  };
}

const userOf = async (request: APIRequestContext, persona: string) => {
  const me = await request.get('/api/v1/me', { headers: as(persona) });
  return ((await me.json()) as { user: { id: string; displayName: string } }).user;
};

const SOLUTION = {
  plantCode: 'AURORA',
  machineType: 'EBM',
  cavitation: 8,
  cycleTimeS: 14.5,
  // $0 means no capital is needed (FB-17).
  prelimCapitalUsd: 0,
};
const capacityRow = (analystId: string) => ({
  site: 'AURORA',
  assumedEffectivenessPct: 70,
  cycleTimeS: 14.5,
  utilizationBeforePct: 62,
  analysisDate: '2026-11-16',
  analystId,
});

/**
 * A quote in Engineering & Capacity, assigned to the engineer persona, with the review started and the
 * solution and one capacity row saved: everything the engineer needs before submitting to the lead.
 */
async function readyForTheLead(request: APIRequestContext) {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  const call = caller(request, quoteNumber);
  const engineer = await userOf(request, 'engineer');
  await userOf(request, 'eng-lead');
  await call('post', 'gates/G1/decisions', 'sales-leader', { outcomeKey: 'advance' });
  await call('post', 'assignment', 'eng-lead', { engineerId: engineer.id });
  await call('post', 'eng-review/accept', 'engineer');
  await call('put', 'eng-review', 'engineer', SOLUTION);
  await call('put', 'capacity-evidence', 'engineer', { rows: [capacityRow(engineer.id)] });
  return { quoteNumber, call, engineer };
}

/** A quote the engineering lead has advanced: it is in Quoting, waiting on Pricing. */
async function inQuoting(request: APIRequestContext) {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  const call = caller(request, quoteNumber);
  const engineer = await userOf(request, 'engineer');
  for (const persona of ['eng-lead', 'pricing', 'pricing-lead', 'finance']) {
    await userOf(request, persona);
  }
  await call('post', 'gates/G1/decisions', 'sales-leader', { outcomeKey: 'advance' });
  await call('put', 'eng-review', 'eng-lead', SOLUTION);
  await call('put', 'capacity-evidence', 'eng-lead', { rows: [capacityRow(engineer.id)] });
  await call('put', 'capacity-signoff', 'eng-lead', { status: 'approved' });
  await call('post', 'gates/G2/decisions', 'eng-lead', { outcomeKey: 'proceed' });
  return { quoteNumber, call };
}

/** Whether the page would ask before a reload or a closed window (the browser's own question). */
const asksBeforeUnload = (page: Page) =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

/** The tab panel that holds `testId`, shown or hidden. */
const panelOf = (page: Page, testId: string) =>
  page.locator('[role="tabpanel"]', { has: page.getByTestId(testId) });

test('UX-001: typed engineering values survive a look at another tab, and Submit waits for the save', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { quoteNumber } = await readyForTheLead(request);
  // A file to look at on the Attachments tab.
  const upload = await request.post(`/api/v1/quotes/${quoteNumber}/attachments`, {
    headers: as('kam'),
    multipart: {
      kind: 'spec',
      size: String(PDF.length),
      file: { name: 'Bottle spec.synthetic.pdf', mimeType: 'application/pdf', buffer: PDF },
    },
  });
  expect(upload.status(), await upload.text()).toBe(201);

  // Every question the page asks is answered "stay" until the test says otherwise.
  const asked: { type: string; message: string }[] = [];
  page.on('dialog', (dialog) => {
    asked.push({ type: dialog.type(), message: dialog.message() });
    void dialog.dismiss();
  });

  await signInAs(page, 'engineer');
  await page.goto(`/quotes/${quoteNumber}?tab=engineering`);
  const tab = page.getByTestId('engineering-tab');
  const solution = tab.getByTestId('solution-form');
  const submit = tab.getByRole('button', { name: 'Submit to engineering lead' });
  await expect(submit).toBeEnabled();
  await expect(tab.getByTestId('save-first')).toHaveCount(0);
  expect(await asksBeforeUnload(page)).toBe(false);

  // UX-017: the engineer reads every figure they enter, so no hint says otherwise. The capital and
  // effectiveness fields keep their ordinary help.
  await expect(tab).not.toContainText('cannot see the saved figure');
  await expect(solution).toContainText('Saving it updates the quote’s priority score.');
  await expect(tab.getByTestId('capacity-row')).toContainText(
    'Enter the effectiveness you are assuming.',
  );

  // ── Type, do not save: Submit waits and says why ──
  const concept = 'Two-cavity shuttle with an in-mold label';
  await solution.getByLabel('Technical concept').fill(concept);
  await expect(submit).toBeDisabled();
  await expect(tab.getByTestId('save-first')).toHaveText('Save your changes first.');
  await expect(submit).toHaveAccessibleDescription('Save your changes first.');
  expect(await asksBeforeUnload(page)).toBe(true);
  if (auditScreens) {
    await tab.getByTestId('lead-review-actions').scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshotPath('UX-001') });
  }

  // ── Look at a drawing on another tab: the Engineering tab is kept, hidden ──
  await page.getByRole('tab', { name: 'Attachments' }).click();
  await expect(page).toHaveURL(new RegExp(`/quotes/${quoteNumber}\\?tab=attachments`));
  const files = page.getByTestId('attachments');
  const file = files.getByTestId('attachment-row').filter({ hasText: 'Bottle spec.synthetic.pdf' });
  await expect(file).toBeVisible();
  await expect(tab).toBeHidden();
  await expect(panelOf(page, 'engineering-tab')).toHaveAttribute('hidden', '');
  // Hidden means out of the tab order and out of the accessibility tree: no field of it can be reached.
  await expect(page.getByRole('textbox', { name: 'Technical concept' })).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);
  // A download is not "leaving": no question, and the file arrives.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    file.getByRole('button', { name: /^Download/ }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Bottle spec.synthetic.pdf');
  expect(asked).toEqual([]);

  // ── Back on Engineering: what was typed is still there ──
  await page.getByRole('tab', { name: 'Engineering' }).click();
  await expect(solution.getByLabel('Technical concept')).toHaveValue(concept);
  await expect(submit).toBeDisabled();

  // ── Leaving the quote asks first; "stay" keeps the page and the typed value ──
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.locator('[data-nav="pipeline"]').click();
  await expect.poll(() => asked).toEqual([{ type: 'confirm', message: LEAVE_QUESTION }]);
  await expect(page).toHaveURL(new RegExp(`/quotes/${quoteNumber}\\?tab=engineering`));
  await expect(solution.getByLabel('Technical concept')).toHaveValue(concept);

  // ── Save: Submit is offered again and nothing asks any more ──
  await solution.getByRole('button', { name: 'Save solution' }).click();
  await expect(page.getByText('Solution saved')).toBeVisible();
  await expect(submit).toBeEnabled();
  await expect(tab.getByTestId('save-first')).toHaveCount(0);
  expect(await asksBeforeUnload(page)).toBe(false);
  await nav.locator('[data-nav="pipeline"]').click();
  await expect(page).toHaveURL(/\/quotes(\?|$)/);
  expect(asked).toHaveLength(1);
});

test('UX-001: the Quoting tab keeps typed values too, and opening it is not a change', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { quoteNumber } = await inQuoting(request);
  const asked: string[] = [];
  page.on('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.accept();
  });

  await signInAs(page, 'pricing');
  await page.goto(`/quotes/${quoteNumber}?tab=quoting`);
  const tab = page.getByTestId('quoting-tab');
  const record = tab.getByTestId('pricing-record-form');
  // The approver and the time are filled in for the pricer: that is not something they typed.
  await expect(record.getByLabel('Approved by')).not.toHaveValue('');
  expect(await asksBeforeUnload(page)).toBe(false);

  const basis = 'Resin index for November, FOB Aurora';
  await record.getByLabel('Pricing basis').fill(basis);
  expect(await asksBeforeUnload(page)).toBe(true);

  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(tab).toBeHidden();
  await expect(panelOf(page, 'quoting-tab')).toHaveAttribute('hidden', '');
  await page.getByRole('tab', { name: 'Quoting' }).click();
  await expect(record.getByLabel('Pricing basis')).toHaveValue(basis);

  // Putting the value back is not a change any more.
  await record.getByLabel('Pricing basis').fill('');
  expect(await asksBeforeUnload(page)).toBe(false);

  // Type again and leave anyway: one question, then the pipeline.
  await record.getByLabel('Pricing basis').fill(basis);
  await page.getByRole('navigation', { name: 'Primary' }).locator('[data-nav="pipeline"]').click();
  await expect(page).toHaveURL(/\/quotes(\?|$)/);
  expect(asked).toEqual([LEAVE_QUESTION]);
});
