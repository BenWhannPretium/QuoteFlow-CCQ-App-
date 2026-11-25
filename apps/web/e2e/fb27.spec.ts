import { expect, test, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// FB-27 (N17-15, N17-17, N17-33 to N17-35, N18-16, the rest of N17-09 and N17-24): lists, timeline and
// polish. Faron's case first: filter the pipeline by a plant, move the Plant column first, save the view,
// reload. Then the timeline's file name, the hand cursor, formats beside the uploads, "Report an issue",
// and red / yellow with their key on the gate panels. Synthetic data only.

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });
type Request = Parameters<typeof submitQuote>[0];

// The machine type must be one the plant runs (the plant list says which).
const MACHINE: Record<string, string> = { ST_LOUIS: 'IBM', BOXMORE: 'EBM', AURORA: 'EBM' };
const SOLUTION = (plantCode: string) => ({
  plantCode,
  machineType: MACHINE[plantCode] ?? 'EBM',
  cavitation: 8,
  cycleTimeS: 14.5,
  prelimCapitalUsd: 0,
});
const PDF = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj << >> endobj\n%%EOF\n', 'latin1');

/** A quote past G1 with the engineer assigned and (optionally) their solution saved at `plantCode`. */
async function inEngineering(request: Request, plantCode: string | null, engineer = 'engineer') {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  const call = async (method: 'post' | 'put', path: string, persona: string, data?: unknown) => {
    const res = await request[method](`/api/v1/quotes/${quoteNumber}/${path}`, {
      headers: as(persona),
      ...(data === undefined ? {} : { data }),
    });
    expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
    return res;
  };
  const me = (await (await request.get('/api/v1/me', { headers: as(engineer) })).json()) as {
    user: { id: string };
  };
  await call('post', 'gates/G1/decisions', 'sales-leader', { outcomeKey: 'advance' });
  await call('post', 'assignment', 'eng-lead', { engineerId: me.user.id });
  await call('post', 'eng-review/accept', engineer);
  if (plantCode) await call('put', 'eng-review', engineer, SOLUTION(plantCode));
  return { quoteNumber, call, userId: me.user.id };
}

/** The visible column headers of the pipeline table, in order. */
/** The first column header (the list may still be loading, so this waits). Headers are shown in capitals. */
const firstColumn = (page: Page) => expect(page.getByRole('columnheader').first());

test('Faron: filter the pipeline by plant, move Plant first, save the view, reload', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  // St. Louis is a plant no other spec uses, so the filter finds this quote and few others.
  const { quoteNumber } = await inEngineering(request, 'ST_LOUIS');
  const other = await inEngineering(request, 'BOXMORE');
  await signInAs(page, 'kam');
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/quotes');
  await expect(page.getByRole('heading', { level: 1, name: 'Pipeline' })).toBeVisible();

  // ── A Plant filter (any item at the plant), shared through the link ──
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page
    .getByRole('group', { name: 'Plant' })
    .getByRole('checkbox', { name: 'St. Louis' })
    .check();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/plant=ST_LOUIS/);
  await expect(page.getByTestId(`quote-row-${quoteNumber}`)).toBeVisible();
  await expect(page.getByTestId(`quote-row-${other.quoteNumber}`)).toHaveCount(0);

  // ── The Plant column, then first in the order ──
  await page.getByTestId('column-chooser').click();
  const chooser = page
    .getByRole('dialog', { name: 'Columns' })
    .or(page.getByLabel('Columns').last());
  await page.getByRole('checkbox', { name: 'Plant', exact: true }).check();
  for (let i = 0; i < 12; i += 1) {
    const up = page.getByRole('button', { name: 'Move Plant up' });
    if (await up.isDisabled()) break;
    await up.click();
  }
  await expect(page.getByRole('button', { name: 'Move Plant up' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(chooser).toBeHidden();
  await firstColumn(page).toHaveText(/^plant$/i);
  await expect(page.getByTestId(`quote-row-${quoteNumber}`).getByTestId('plant-cell')).toHaveText(
    'St. Louis',
  );

  // ── Save the view (filters and columns), clear it all, apply it: both come back ──
  await page.getByTestId('saved-views').click();
  await page.getByLabel('Save the current filters and columns as').fill('Plant first');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('View saved')).toBeVisible();
  await page.keyboard.press('Escape');

  // The order itself survives a reload (per person, in this browser) ...
  await page.reload();
  await firstColumn(page).toHaveText(/^plant$/i);
  // ... and a saved view puts filters and columns back after another choice of columns.
  await page.goto('/quotes');
  await page.getByTestId('column-chooser').click();
  await page.getByRole('button', { name: 'Reset to default' }).click();
  await page.keyboard.press('Escape');
  await firstColumn(page).not.toHaveText(/^plant$/i);
  await page.getByTestId('saved-views').click();
  await page.getByRole('button', { name: 'Plant first', exact: true }).click();
  await expect(page).toHaveURL(/plant=ST_LOUIS/);
  await firstColumn(page).toHaveText(/^plant$/i);
  await expect(page.getByTestId(`quote-row-${quoteNumber}`)).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  // ── The same at 390 px, in the dark theme: reachable, no sideways page scroll ──
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.localStorage.setItem('ccq.theme', 'dark'));
  await page.reload();
  await page.getByTestId('column-chooser').click();
  await expect(page.getByRole('button', { name: 'Move Plant down' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('the timeline names a file as a link that opens it; a removed file stays plain text', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  const upload = async (name: string) => {
    const res = await request.post(`/api/v1/quotes/${quoteNumber}/attachments`, {
      headers: as('kam'),
      multipart: {
        kind: 'spec',
        size: String(PDF.length),
        file: { name, mimeType: 'application/pdf', buffer: PDF },
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    return ((await res.json()) as { item: { id: string } }).item.id;
  };
  await upload('timeline-spec.pdf');
  const goneId = await upload('timeline-gone.pdf');
  const removed = await request.delete(`/api/v1/attachments/${goneId}`, { headers: as('kam') });
  expect(removed.status()).toBe(204);

  await signInAs(page, 'kam');
  await page.goto(`/quotes/${quoteNumber}?tab=overview`);
  const timeline = page.getByTestId('quote-timeline');
  const link = timeline.getByRole('button', { name: 'timeline-spec.pdf' });
  await expect(link).toBeVisible();
  // The removed file's upload is still in the history, as text; "File removed" is text as well.
  await expect(timeline.getByText('timeline-gone.pdf').first()).toBeVisible();
  await expect(timeline.getByRole('button', { name: 'timeline-gone.pdf' })).toHaveCount(0);
  // A hand over the name (N18-16).
  expect(await link.evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer');
  // Clicking asks the audited download route for a link (the same read as the Attachments tab).
  const [response] = await Promise.all([
    page.waitForResponse((r) => /\/api\/v1\/attachments\/[^/]+\/download/.test(r.url())),
    link.click(),
  ]);
  expect(response.status()).toBe(200);
  expect(await seriousViolations(page)).toEqual([]);
});

test('the hand cursor, and the formats beside the engineering uploads', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const { quoteNumber } = await inEngineering(request, 'AURORA');
  await signInAs(page, 'engineer');
  await page.goto(`/quotes/${quoteNumber}?tab=engineering`);
  const eng = page.getByTestId('engineering-tab');

  // N17-24: the formats and size limit, in words, beside each upload (and the picker's `accept`).
  const bom = eng.getByTestId('equipment-bom');
  await expect(bom.getByTestId('upload-formats-equipment_bom')).toContainText(
    'Excel workbook (.xlsx)',
  );
  await expect(bom.getByTestId('upload-formats-equipment_bom')).toContainText('up to 100 MB');
  expect(await bom.getByTestId('upload-equipment_bom').getAttribute('accept')).toContain('.xlsx');
  // FB-30 (N19-28): the capacity analysis upload is on the Capacity tab.
  await page.getByRole('tab', { name: 'Capacity', exact: true }).click();
  const cap = page.getByTestId('capacity-tab');
  await expect(cap.getByTestId('upload-formats-capacity_analysis')).toContainText('up to 100 MB');
  expect(await cap.getByTestId('capacity-attach-input').getAttribute('accept')).toContain('.pdf');
  await page.getByRole('tab', { name: 'Engineering', exact: true }).click();

  // N18-16: enabled controls get the pointer, disabled ones "not allowed".
  const cursor = (loc: ReturnType<Page['locator']>) =>
    loc.evaluate((el) => getComputedStyle(el).cursor);
  expect(await cursor(bom.locator('button', { hasText: 'Upload the equipment BOM' }))).toBe(
    'pointer',
  );
  expect(await cursor(page.getByRole('tab', { name: 'Overview' }))).toBe('pointer');
  expect(await cursor(page.getByRole('tab', { name: 'Attachments' }))).toBe('pointer');
  await page.getByRole('tab', { name: 'Capacity', exact: true }).click();
  const csv = cap.getByTestId('capacity-csv'); // disabled until a row is saved
  await expect(csv).toBeDisabled();
  expect(await cursor(csv)).toBe('not-allowed');

  // The general Attachments panel says what the server accepts, from the same list.
  await page.getByRole('tab', { name: 'Attachments' }).click();
  const panel = page.getByTestId('attachments');
  await expect(panel.getByTestId('drop-zone')).toContainText('PDF (.pdf)');
  await expect(panel.getByTestId('drop-zone')).toContainText('Up to 100 MB each');
  expect(await seriousViolations(page)).toEqual([]);
});

test('Report an issue: says why Send waits, and Cancel, Esc and closing clear the form', async ({
  page,
}) => {
  await signInAs(page, 'kam');
  await page.goto('/board');
  const open = async () => {
    await page.getByTestId('report-issue-footer').click();
    const dialog = page.getByTestId('report-issue-dialog');
    await expect(dialog).toBeVisible();
    return dialog;
  };
  let dialog = await open();
  // Send is disabled, and the form says why under the box.
  await expect(dialog.getByTestId('feedback-submit')).toBeDisabled();
  await expect(dialog.getByTestId('feedback-send-reason')).toHaveText(
    'Describe the issue in at least 5 characters.',
  );
  // Pressing the waiting Send says why, in an alert, and puts the cursor in the box.
  await dialog.getByTestId('feedback-submit').evaluate((el) => (el as HTMLButtonElement).click());
  await expect(
    dialog.getByRole('alert').filter({ hasText: 'at least 5 characters' }),
  ).toBeVisible();
  await expect(dialog.getByTestId('feedback-description')).toBeFocused();
  await dialog.getByTestId('feedback-description').fill('abcd');
  await expect(dialog.getByTestId('feedback-send-reason')).toBeVisible();
  await dialog.getByTestId('feedback-description').fill('abcde');
  await expect(dialog.getByTestId('feedback-send-reason')).toHaveCount(0);
  await expect(dialog.getByTestId('feedback-submit')).toBeEnabled();

  // Cancel clears type, severity and text.
  await dialog.getByTestId('feedback-type').selectOption('confusing');
  await dialog.getByTestId('feedback-severity').selectOption('1');
  await dialog.getByTestId('feedback-cancel').click();
  await expect(dialog).toBeHidden();
  dialog = await open();
  await expect(dialog.getByTestId('feedback-description')).toHaveValue('');
  await expect(dialog.getByTestId('feedback-type')).toHaveValue('bug');
  await expect(dialog.getByTestId('feedback-severity')).toHaveValue('3');

  // Esc clears it too.
  await dialog.getByTestId('feedback-description').fill('half written, then Escape');
  await dialog.getByTestId('feedback-type').selectOption('idea');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  dialog = await open();
  await expect(dialog.getByTestId('feedback-description')).toHaveValue('');
  await expect(dialog.getByTestId('feedback-type')).toHaveValue('bug');

  // After a send: the thanks, and a blank form next time.
  await dialog
    .getByTestId('feedback-description')
    .fill(`E2E FB-27 ${Date.now()}: Cancel clears the form.`);
  await dialog.getByTestId('feedback-submit').click();
  await expect(page.getByText('Thanks: your report was sent')).toBeVisible();
  await expect(dialog).toBeHidden();
  dialog = await open();
  await expect(dialog.getByTestId('feedback-description')).toHaveValue('');
});

test('red for what stops the next step, yellow for a warning, and the key (gate and lead panels)', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  // An engineering lead assigned as the engineer, with nothing filled in yet: the decision waits.
  await request.get('/api/v1/me', { headers: as('eng-lead-engineer') });
  const { quoteNumber, call, userId } = await inEngineering(request, null, 'eng-lead-engineer');
  await signInAs(page, 'eng-lead-engineer', 'light');
  await page.goto(`/quotes/${quoteNumber}?tab=engineering`);
  const decision = page.locator('#decision');
  await expect(decision).toBeVisible();
  const needed = decision.getByTestId('decide-needed');
  await expect(needed).toHaveAttribute('data-tone', 'blocking');
  await expect(decision.getByTestId('flag-key-red')).toBeVisible();
  await expect(decision.getByTestId('flag-key-yellow')).toHaveCount(0);
  // AA contrast in both themes (axe checks the colour of the red box's text).
  expect(await seriousViolations(page)).toEqual([]);
  await page.evaluate(() => window.localStorage.setItem('ccq.theme', 'dark'));
  await page.reload();
  await expect(page.locator('#decision').getByTestId('decide-needed')).toHaveAttribute(
    'data-tone',
    'blocking',
  );
  expect(await seriousViolations(page)).toEqual([]);

  // Fill the work in: the red list goes, and so does the key.
  await call('put', 'eng-review', 'eng-lead-engineer', SOLUTION('AURORA'));
  await call('put', 'capacity-evidence', 'eng-lead-engineer', {
    rows: [
      {
        site: 'AURORA',
        lineAsset: 'Line 4',
        assumedEffectivenessPct: 70,
        cycleTimeS: 14.5,
        utilizationBeforePct: 60,
        analysisDate: '2026-11-19',
        analystId: userId,
      },
    ],
  });
  await page.evaluate(() => window.localStorage.setItem('ccq.theme', 'light'));
  await page.reload();
  await expect(page.locator('#decision').getByTestId('decide-needed')).toHaveCount(0);
  await expect(page.locator('#decision').getByTestId('flag-key')).toHaveCount(0);

  // N17-11: the header's "Decide feasibility" lands on the decision (focused), not on a dialog.
  await page.goto(`/quotes/${quoteNumber}?tab=overview`);
  await page.getByTestId('header-decide').click();
  await expect(page).toHaveURL(/tab=engineering/);
  await expect(page.locator('#decision')).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The decision button on the panel opens the dialog, whose completeness line is the quiet one.
  await page.locator('#decision').getByTestId('decide-gate').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('completeness')).not.toHaveAttribute('data-tone', 'blocking');
  await expect(dialog.getByTestId('flag-key')).toHaveCount(0);
});
