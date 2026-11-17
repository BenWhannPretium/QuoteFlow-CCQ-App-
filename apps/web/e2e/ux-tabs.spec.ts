import { fileURLToPath } from 'node:url';

import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// The quote page's tabs (UX proposals approved 2026-11-17, docs/audit/03-ux-proposals.md).
// UX-001: values typed on the Engineering and Quoting tabs survive a look at another tab; "Submit to
// lead" waits for the save; leaving the page with unsaved changes asks first.
// UX-012: a quote opens on the tab of its current stage for a reader who works that stage, otherwise
// on Overview; the tab on screen is always in the address and an explicit ?tab= wins; the Offer letter
// card is not shown before Final Review approves the quote.
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

test('UX-001: a save by someone else is not your unsaved change, and your save does not undo it', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  // The engineer has the quote, with the solution and capacity saved. The drawing is still to come, so
  // the first drawing uploaded makes the page read the quote again (see below).
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1), {
    drawingStatus: 'COMING',
  });
  const call = caller(request, quoteNumber);
  const engineer = await userOf(request, 'engineer');
  await userOf(request, 'eng-lead');
  await call('post', 'gates/G1/decisions', 'sales-leader', { outcomeKey: 'advance' });
  await call('post', 'assignment', 'eng-lead', { engineerId: engineer.id });
  await call('post', 'eng-review/accept', 'engineer');
  await call('put', 'eng-review', 'engineer', SOLUTION);
  await call('put', 'capacity-evidence', 'engineer', { rows: [capacityRow(engineer.id)] });

  await signInAs(page, 'engineer');
  await page.goto(`/quotes/${quoteNumber}?tab=engineering`);
  const tab = page.getByTestId('engineering-tab');
  const solution = tab.getByTestId('solution-form');
  const submit = tab.getByRole('button', { name: 'Submit to engineering lead' });
  await expect(submit).toBeEnabled();

  // The engineer types one field and does not save.
  await solution.getByLabel(/^Cavitation/).fill('12');
  await expect(submit).toBeDisabled();

  // Meanwhile the lead, who may also edit, saves another field.
  const leadsConcept = 'Lead: shuttle with an in-mold label';
  await call('put', 'eng-review', 'eng-lead', { technicalConceptNotes: leadsConcept });

  // The page reads the quote again (here: the first drawing arrives).
  await page.getByRole('tab', { name: 'Attachments' }).click();
  await page
    .getByTestId('attachments')
    .getByTestId('attachment-input')
    .setInputFiles({
      name: 'Bottle drawing.synthetic.pdf',
      mimeType: 'application/pdf',
      buffer: PDF,
    });
  await expect(page.getByText('Drawing attached')).toBeVisible();
  await page.getByRole('tab', { name: 'Engineering' }).click();

  // The untouched field shows the lead's value; the typed field is still the engineer's.
  await expect(solution.getByLabel('Technical concept')).toHaveValue(leadsConcept);
  await expect(solution.getByLabel(/^Cavitation/)).toHaveValue('12');

  // Saving sends only what the engineer typed: the lead's value is still there afterwards.
  await solution.getByRole('button', { name: 'Save solution' }).click();
  await expect(page.getByText('Solution saved')).toBeVisible();
  await expect(submit).toBeEnabled();
  await expect(tab.getByTestId('save-first')).toHaveCount(0);
  expect(await asksBeforeUnload(page)).toBe(false);
  const stored = (await (
    await request.get(`/api/v1/quotes/${quoteNumber}`, { headers: as('engineer') })
  ).json()) as { engineering: { review: { technicalConceptNotes: string; cavitation: number } } };
  expect(stored.engineering.review).toMatchObject({
    technicalConceptNotes: leadsConcept,
    cavitation: 12,
  });

  // With nothing typed, a save by the lead leaves nothing "unsaved" here.
  await call('put', 'eng-review', 'eng-lead', { toolingNotes: 'Lead: two-cavity mold' });
  await page.reload();
  await expect(solution.getByLabel(/^Tooling notes/)).toHaveValue('Lead: two-cavity mold');
  await expect(submit).toBeEnabled();
  await expect(tab.getByTestId('save-first')).toHaveCount(0);
});

/** A new page in its own browser context, signed in as a persona. */
test('UX-001: a decision waits for the save, and a failed refresh keeps what is typed', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  // A quote the engineering lead can decide: the work is complete and capacity is approved. Its drawing
  // is still to come, so the first drawing uploaded changes the quote (see the refresh below).
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1), {
    drawingStatus: 'COMING',
  });
  const call = caller(request, quoteNumber);
  const engineer = await userOf(request, 'engineer');
  await userOf(request, 'eng-lead');
  await call('post', 'gates/G1/decisions', 'sales-leader', { outcomeKey: 'advance' });
  await call('put', 'eng-review', 'eng-lead', SOLUTION);
  await call('put', 'capacity-evidence', 'eng-lead', { rows: [capacityRow(engineer.id)] });
  await call('put', 'capacity-signoff', 'eng-lead', { status: 'approved' });

  await signInAs(page, 'eng-lead');
  await page.goto(`/quotes/${quoteNumber}?tab=engineering`);
  const tab = page.getByTestId('engineering-tab');
  const solution = tab.getByTestId('solution-form');
  const decide = tab.getByTestId('decide-gate');
  const headerDecide = page.getByTestId('header-decide');
  await expect(decide).toBeEnabled();
  await expect(headerDecide).toBeEnabled();
  await expect(page.getByTestId('header-save-first')).toHaveCount(0);

  // ── Type, do not save: both decision buttons wait, and say why ──
  const concept = 'Single-stage with a hot runner';
  await solution.getByLabel('Technical concept').fill(concept);
  await expect(decide).toBeDisabled();
  await expect(decide).toHaveAccessibleDescription('Save your changes first.');
  await expect(headerDecide).toBeDisabled();
  await expect(headerDecide).toHaveAccessibleDescription('Save your changes first.');
  await expect(page.getByTestId('header-save-first')).toHaveText('Save your changes first.');

  // ── A refresh of the quote fails in the background: the page stays, with what was typed ──
  let failing = true;
  await page.route(`**/api/v1/quotes/${quoteNumber}`, (route) =>
    failing && route.request().method() === 'GET'
      ? route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({ type: 'about:blank', title: 'Service unavailable', status: 503 }),
        })
      : route.fallback(),
  );
  // The first drawing on a quote changes its drawing status, so the page asks for the quote again.
  await page.getByRole('tab', { name: 'Attachments' }).click();
  await page.getByTestId('attachments').getByTestId('attachment-input').setInputFiles({
    name: 'Bottle drawing.synthetic.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  const stale = page.getByTestId('quote-stale');
  await expect(stale).toContainText('This quote could not be refreshed', { timeout: 20_000 });
  await expect(page.getByTestId('quote-not-found')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Engineering' }).click();
  await expect(solution.getByLabel('Technical concept')).toHaveValue(concept);

  // ── The server is back: the line goes, the typed value stays ──
  failing = false;
  await stale.getByRole('button', { name: 'Try again' }).click();
  await expect(stale).toHaveCount(0);
  await expect(solution.getByLabel('Technical concept')).toHaveValue(concept);

  // ── Save: the decision is offered again ──
  await solution.getByRole('button', { name: 'Save solution' }).click();
  await expect(page.getByText('Solution saved')).toBeVisible();
  await expect(decide).toBeEnabled();
  await expect(headerDecide).toBeEnabled();
  await expect(page.getByTestId('header-save-first')).toHaveCount(0);
});

async function openAs(browser: Browser, persona: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, persona);
  return page;
}

/** The tab that is selected on the quote page. */
const selectedTab = (page: Page) => page.getByRole('tab', { selected: true });

test("UX-012: a quote in Engineering opens on the reader's own work, and ?tab= is exact", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const { quoteNumber } = await readyForTheLead(request);
  const bare = `/quotes/${quoteNumber}`;
  const address = (tab: string) => new RegExp(`/quotes/${quoteNumber}\\?tab=${tab}$`);

  // ── The engineer works this stage: the quote opens on the Engineering tab ──
  const eng = await openAs(browser, 'engineer');
  await eng.goto(bare);
  await expect(selectedTab(eng)).toHaveText('Engineering');
  await expect(eng.getByTestId('engineering-tab').getByTestId('solution-form')).toBeVisible();
  // The tab on screen is written into the address, so a copied link is exact.
  await expect(eng).toHaveURL(address('engineering'));
  if (auditScreens) await eng.screenshot({ path: screenshotPath('UX-012') });
  // An explicit ?tab= wins over the default.
  await eng.goto(`${bare}?tab=overview`);
  await expect(selectedTab(eng)).toHaveText('Overview');
  await expect(eng.getByTestId('quote-timeline')).toBeVisible();
  await expect(eng).toHaveURL(address('overview'));
  // Choosing a tab by hand is kept in the address too, Overview included.
  await eng.getByRole('tab', { name: 'Attachments' }).click();
  await expect(eng).toHaveURL(address('attachments'));
  await eng.getByRole('tab', { name: 'Overview' }).click();
  await expect(eng).toHaveURL(address('overview'));
  // A link to a place on the Overview (the Commercial panel, the offer letter) opens the Overview.
  await eng.goto(`${bare}#commercial`);
  await expect(selectedTab(eng)).toHaveText('Overview');
  await expect(eng).toHaveURL(new RegExp(`/quotes/${quoteNumber}\\?tab=overview#commercial$`));

  // ── The engineering lead and the production scheduler work it too ──
  for (const persona of ['eng-lead', 'production-scheduler']) {
    const page = await openAs(browser, persona);
    await page.goto(bare);
    await expect(selectedTab(page), persona).toHaveText('Engineering');
    await expect(page, persona).toHaveURL(address('engineering'));
    await page.context().close();
  }

  // ── The KAM does not: Overview, as before ──
  const kam = await openAs(browser, 'kam');
  const offerLetter = kam.waitForResponse(
    (res) => res.url().endsWith(`/quotes/${quoteNumber}/offer-letter`) && res.ok(),
  );
  await kam.goto(bare);
  await expect(selectedTab(kam)).toHaveText('Overview');
  await expect(kam).toHaveURL(address('overview'));
  await expect(kam.getByTestId('engineering-tab')).toHaveCount(0);
  // The Offer letter card is not shown before Final Review approves the quote.
  expect(((await (await offerLetter).json()) as { available: boolean }).available).toBe(false);
  await expect(kam.getByTestId('quote-timeline')).toBeVisible();
  await expect(kam.getByTestId('offer-letter-card')).toHaveCount(0);
  await expect(kam.getByText('Not available yet')).toHaveCount(0);
  // The engineer's link opens on the Engineering tab for the KAM as well.
  await kam.goto(`${bare}?tab=engineering`);
  await expect(selectedTab(kam)).toHaveText('Engineering');
  await expect(kam.getByTestId('engineering-tab')).toBeVisible();
  await expect(kam).toHaveURL(address('engineering'));
  expect(await seriousViolations(kam)).toEqual([]);
});

test('UX-012: a quote in Quoting opens on the Quoting tab for Pricing and Finance only', async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const { quoteNumber } = await inQuoting(request);
  const bare = `/quotes/${quoteNumber}`;
  const address = (tab: string) => new RegExp(`/quotes/${quoteNumber}\\?tab=${tab}$`);

  for (const persona of ['pricing', 'pricing-lead', 'finance']) {
    const page = await openAs(browser, persona);
    await page.goto(bare);
    await expect(selectedTab(page), persona).toHaveText('Quoting');
    await expect(page.getByTestId('quoting-tab'), persona).toBeVisible();
    await expect(page, persona).toHaveURL(address('quoting'));
    await page.context().close();
  }
  // Engineering's stage is over: the engineer and the KAM open on Overview.
  for (const persona of ['engineer', 'kam']) {
    const page = await openAs(browser, persona);
    await page.goto(bare);
    await expect(selectedTab(page), persona).toHaveText('Overview');
    await expect(page, persona).toHaveURL(address('overview'));
    await page.context().close();
  }
});
