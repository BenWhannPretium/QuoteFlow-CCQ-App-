import { expect, test, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { SYNTHETIC_XLSX } from './models';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// B-10: the EngLead is alerted and assigns from the engineering queue; the Engineer accepts and
// completes the Engineering Review with capacity evidence (B-26: plus the Equipment BOM and Supply
// Chain view); the EngLead signs off capacity (B-26) and decides G2 Advance.
// The quote is created and qualified through the API (intake and G1 have their own specs).

test('EngLead assigns → Engineer completes the review with capacity evidence → Advance', async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  // Provision the EngLead (the e2e database is config-seeded only) so the arrival alert has a recipient.
  await request.get('/api/v1/me', { headers: { [DEV_USER_HEADER]: 'eng-lead' } });
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  const advance = await request.post(`/api/v1/quotes/${quoteNumber}/gates/G1/decisions`, {
    headers: { [DEV_USER_HEADER]: 'sales-leader' },
    data: { outcomeKey: 'advance', note: 'e2e: qualified' },
  });
  expect(advance.status(), await advance.text()).toBe(201);
  // Provision the engineer persona so the EngLead's picker lists them.
  const me = await request.get('/api/v1/me', { headers: { [DEV_USER_HEADER]: 'engineer' } });
  const engineerName = ((await me.json()) as { user: { displayName: string } }).user.displayName;

  const as = async (persona: string): Promise<Page> => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAs(page, persona);
    return page;
  };

  // ── EngLead: alerted, finds the quote in the queue, assigns it ──
  const lead = await as('eng-lead');
  await lead.goto('/');
  await expect(lead.getByTestId('notification-bell')).toHaveAccessibleName(/unread/);
  await lead.getByTestId('notification-bell').click();
  await expect(lead.getByTestId('notification-list')).toContainText(
    `${quoteNumber} is in the engineering queue`,
  );
  await lead.keyboard.press('Escape');

  await lead
    .getByRole('navigation', { name: 'Primary' })
    .locator('[data-nav="queue-engineering"]')
    .click();
  await expect(lead.getByRole('heading', { level: 1, name: 'Engineering queue' })).toBeVisible();
  await expect(lead.getByTestId('aging-chips')).toContainText('< 3 days');
  await lead.getByLabel('Search the queue').fill(quoteNumber);
  const row = lead.getByRole('row').filter({ hasText: quoteNumber });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('queue-status')).toHaveText('Unassigned');
  await expect(row.getByTestId('days-in-queue')).toHaveText('0 business days');
  expect(await seriousViolations(lead)).toEqual([]);

  // DR-engineering-07: by keyboard, Escape from the dialog returns focus to the row's Actions button.
  const actions = row.getByRole('button', { name: `Actions for ${quoteNumber}` });
  await actions.focus();
  await lead.keyboard.press('Enter');
  await lead.getByRole('menuitem', { name: 'Assign engineer' }).click();
  await expect(lead.getByRole('dialog')).toBeVisible();
  await lead.keyboard.press('Escape');
  await expect(lead.getByRole('dialog')).toHaveCount(0);
  await expect(actions).toBeFocused();

  await actions.click();
  await lead.getByRole('menuitem', { name: 'Assign engineer' }).click();
  const assign = lead.getByRole('dialog');
  await assign.getByRole('button', { name: 'Assign' }).click();
  await expect(assign.getByRole('alert')).toHaveText('Choose an engineer.');
  const picker = assign.getByLabel('Engineer');
  const option = picker.locator('option', { hasText: `${engineerName} (` });
  await expect(option).toContainText('open'); // the picker shows each engineer's open count
  await picker.selectOption(await option.getAttribute('value'));
  await assign.getByRole('button', { name: 'Assign' }).click();
  await expect(assign).toHaveCount(0);
  await expect(row.getByTestId('queue-status')).toHaveText('Not started');
  await expect(row).toContainText(engineerName);

  // ── Engineer: accepts and completes the review ──
  const eng = await as('engineer');
  await eng.goto('/queue/engineering');
  await expect(eng.getByRole('heading', { level: 1, name: 'My assignments' })).toBeVisible();
  const mine = eng.locator(`[data-testid="my-assignment"][data-quote="${quoteNumber}"]`);
  await expect(mine).toContainText('Not started');
  await mine.getByRole('link', { name: quoteNumber }).click();
  await expect(eng).toHaveURL(new RegExp(`/quotes/${quoteNumber}\\?tab=engineering`));
  const tab = eng.getByTestId('engineering-tab');
  await tab.getByRole('button', { name: 'Start review' }).click();
  await expect(tab).toContainText(/Review started.*by/);
  // 2026-10-30: the Engineer sees the commercial figures they enter.
  await expect(eng.getByTestId('commercial-hidden')).toHaveCount(0);

  const solution = eng.getByTestId('solution-form');
  await solution.getByLabel('Process type').selectOption({ label: 'EBM' });
  // FB-13 (F-057): Jim Zweifel's 14 machine types and 22 locations; the placeholders are gone.
  // Bailey Schmitt (2026-11-12): listed alphabetically.
  const machineOptions = solution.getByLabel('Machine type').locator('option');
  await expect(machineOptions).toHaveText([
    'Choose…',
    '12B',
    'DECO',
    'DIE CUTTING',
    'EBM',
    'IBM',
    'INJ - CAP',
    'INJ - OTHER',
    'INJ - PREFORM',
    'ISBM',
    'LAMINATION',
    'PAD PRINTING',
    'PRINTING',
    'RHB',
    'STAMPING',
  ]);
  const plantOptions = solution.getByLabel('Plant / site').locator('option');
  await expect(plantOptions).toHaveCount(23); // the blank choice + 22 locations
  await expect(plantOptions.filter({ hasText: 'Etten.Leur' })).toHaveCount(1);
  await expect(plantOptions.filter({ hasText: 'Lerma, Ediplast' })).toHaveCount(1);
  await expect(plantOptions.filter({ hasText: 'Placeholder' })).toHaveCount(0);
  await expect(
    solution.getByLabel('Machine type').locator('option', { hasText: 'shuttle' }),
  ).toHaveCount(0);
  await solution.getByLabel('Machine type').selectOption({ label: 'EBM' });
  await solution.getByLabel('Plant / site').selectOption({ label: 'Aurora' });
  // F-057: a whole number from 1 to 99.
  await expect(solution.getByLabel('Cavitation')).toHaveAttribute('max', '99');
  // F-064: budgetary, not a CER figure.
  await expect(solution.getByText('A rough estimate for quoting.')).toBeVisible();
  // F-057: the EBM wheel is no longer offered.
  await expect(
    solution.getByLabel('Machine type').locator('option', { hasText: 'EBM wheel' }),
  ).toHaveCount(0);
  // F-023: the intake's resin is in front of Engineering.
  await expect(eng.getByTestId('product-facts')).toContainText('Resin');
  await solution.getByLabel('Cavitation').fill('8');
  await solution.getByLabel('Cycle time (s)').fill('14.5');
  await solution.getByLabel('Budgetary capital estimate (USD)').fill('350000');
  // FB-06 (F-058): the two free-text equipment fields are gone; the BOM is an upload (below).
  await expect(solution.getByLabel('Downstream equipment')).toHaveCount(0);
  await expect(solution.getByLabel('Equipment BOM')).toHaveCount(0);
  await solution.getByLabel('Supply Chain').fill('Resin from the Midwest hub; freight OK');
  await solution.getByRole('button', { name: 'Save solution' }).click();
  await expect(eng.getByText('Engineering review saved')).toBeVisible();
  // 2026-10-30: the engineer reads back the capital they wrote.
  await expect(solution.getByLabel('Budgetary capital estimate (USD)')).toHaveValue('350000');

  // ── FB-06 (F-058): the equipment BOM is an upload of the one-page CSR BOM, versioned ──
  const bom = eng.getByTestId('equipment-bom');
  await expect(bom.getByTestId('bom-none')).toBeVisible();
  await expect(bom.getByTestId('bom-required')).toContainText('Capital required');
  await bom.getByTestId('upload-equipment_bom').setInputFiles({
    name: 'CSR BOM one-pager.synthetic.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: SYNTHETIC_XLSX,
  });
  await expect(eng.getByText('Equipment BOM version 1 uploaded')).toBeVisible();
  await expect(bom.getByTestId('bom-current')).toContainText('v1 · current');
  await expect(bom.getByTestId('bom-current')).toContainText('CSR BOM one-pager.synthetic.xlsx');
  await bom.getByTestId('upload-equipment_bom').setInputFiles({
    name: 'CSR BOM one-pager v2.synthetic.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: SYNTHETIC_XLSX,
  });
  await expect(bom.getByTestId('bom-current')).toContainText('v2 · current');
  await expect(bom.getByTestId('bom-history')).toContainText('Earlier versions (1)');

  // ── FB-06 (F-024, F-025): the two-step process and the pack-out, for Pricing ──
  const inputs = eng.getByTestId('pricing-inputs-form');
  await expect(inputs.getByTestId('two-step-details')).toHaveCount(0);
  await inputs.getByTestId('two-step').check();
  await inputs.getByLabel('Preform plant').selectOption({ index: 1 });
  await inputs.getByLabel('Blow plant').selectOption({ index: 2 });
  await inputs.getByLabel('Preform number').fill('PF-2210');
  await inputs.getByLabel('Freight between the plants').fill('Preforms ship by truck, weekly.');
  await inputs.getByTestId('pack-out-unitsPerCase').fill('600');
  await inputs.getByTestId('pack-out-unitsPerPallet').fill('14400');
  await inputs.getByRole('button', { name: 'Save process and pack-out' }).click();
  await expect(eng.getByText('Saved', { exact: true })).toBeVisible();
  await expect(inputs.getByLabel('Preform number')).toHaveValue('PF-2210');

  const capacity = eng.getByTestId('capacity-form');
  await capacity.getByRole('button', { name: 'Add capacity row' }).click();
  const capRow = capacity.getByTestId('capacity-row');
  await capRow.getByLabel('Line / asset').fill('Line 4');
  await capRow.getByLabel('Utilization before %').fill('62');
  await capacity.getByRole('button', { name: 'Save capacity evidence' }).click();
  // No OEE default: the effectiveness assumption must be stated.
  await expect(capRow.getByRole('alert')).toContainText('state the assumed effectiveness %');
  await expect(capRow).toContainText('Past quotes assumed 85%');
  // DR-engineering-02: 0% is refused (no capacity, so no utilization after), on the field.
  await capRow.getByLabel('Assumed effectiveness %').fill('0');
  await capacity.getByRole('button', { name: 'Save capacity evidence' }).click();
  await expect(capRow.getByRole('alert')).toContainText('above 0%');
  await capRow.getByLabel('Assumed effectiveness %').fill('70');
  await capacity.getByRole('button', { name: 'Save capacity evidence' }).click();
  await expect(eng.getByText('Capacity evidence saved')).toBeVisible();
  // F-059: utilization after is calculated (read-only), and "buffer" is gone.
  await expect(capRow.getByTestId('utilization-after')).toContainText('%');
  await expect(capRow.getByLabel('Buffer %')).toHaveCount(0);
  await expect(eng.getByTestId('capacity-basis')).toContainText(
    'Trailing 12 months actual, trending OEE (provisional, D-021)',
  );
  expect(await seriousViolations(eng)).toEqual([]);

  // ── EngLead: signs off capacity (B-26), then decides G2 Advance ──
  await lead.goto(`/quotes/${quoteNumber}?tab=engineering`);
  const leadTab = lead.getByTestId('engineering-tab');
  await expect(leadTab.getByLabel('Budgetary capital estimate (USD)')).toHaveValue('350000');
  const signoff = leadTab.getByTestId('capacity-signoff');
  await expect(signoff.getByTestId('capacity-signoff-status')).toContainText('Not signed off yet');
  await signoff.getByRole('button', { name: 'Approve capacity' }).click();
  await expect(signoff.getByTestId('capacity-signoff-status')).toContainText('Capacity approved');
  await leadTab.getByRole('button', { name: 'Decide feasibility' }).click();
  const g2 = lead.getByRole('dialog');
  await expect(g2.getByTestId('completeness')).toContainText('Nothing missing for this decision');
  await g2.getByRole('radio', { name: 'Advance', exact: true }).check();
  await g2.getByRole('button', { name: 'Record decision' }).click();
  await expect(g2).toHaveCount(0);
  await expect(lead.getByText(`${quoteNumber} is now in Quoting`)).toBeVisible();
  await expect(lead.getByTestId('quote-detail')).toHaveAttribute('data-stage', 'QUOTING');
  await expect(lead.getByTestId('stage-times')).toContainText('Engineering Review');

  // ── FB-06 (T-008): Pricing reads the BOM file, the two-step process and the pack-out ──
  const pricing = await as('pricing');
  await pricing.goto(`/quotes/${quoteNumber}?tab=quoting`);
  const fromEng = pricing.getByTestId('quoting-from-engineering');
  await expect(fromEng.getByTestId('bom-current')).toContainText('v2 · current');
  await expect(fromEng.getByTestId('bom-current')).toContainText(
    'CSR BOM one-pager v2.synthetic.xlsx',
  );
  await expect(fromEng).toContainText('Two-step process');
  await expect(fromEng).toContainText('PF-2210');
  await expect(fromEng).toContainText('Preforms ship by truck, weekly.');
  await expect(fromEng).toContainText('Units per case');
  await expect(fromEng).toContainText('600');
  await expect(fromEng).toContainText('14,400');
  // After G2 the Engineering section is locked: no upload is offered.
  await pricing.goto(`/quotes/${quoteNumber}?tab=engineering`);
  await expect(
    pricing.getByTestId('equipment-bom').getByTestId('upload-equipment_bom'),
  ).toHaveCount(0);

  await lead.goto('/queue/engineering');
  await lead.getByLabel('Search the queue').fill(quoteNumber);
  // Gone from the queue (the empty state's wording depends on what else is queued).
  await expect(lead.getByRole('heading', { name: /^Queue/ })).toBeVisible();
  await expect(lead.getByRole('link', { name: quoteNumber })).toHaveCount(0);
  await expect(lead.getByText(/The queue is empty|No quotes match these filters/)).toBeVisible();
});

test('the KAM sees the Engineering tab read-only, capital included', async ({ page, request }) => {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  await request.post(`/api/v1/quotes/${quoteNumber}/gates/G1/decisions`, {
    headers: { [DEV_USER_HEADER]: 'sales-leader' },
    data: { outcomeKey: 'advance' },
  });
  await request.put(`/api/v1/quotes/${quoteNumber}/eng-review`, {
    headers: { [DEV_USER_HEADER]: 'eng-lead' },
    data: { processType: 'EBM', prelimCapitalUsd: 125000 },
  });
  await signInAs(page, 'kam');
  await page.goto(`/quotes/${quoteNumber}`);
  await page.getByRole('tab', { name: 'Engineering' }).click();
  const tab = page.getByTestId('engineering-tab');
  await expect(tab).not.toContainText('Hidden (commercial)');
  await expect(tab).toContainText('125,000');
  await expect(tab.getByTestId('solution-form')).toHaveCount(0);
  await expect(tab.getByRole('button', { name: /Assign|Accept|Decide/ })).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);
});

// DR-engineering-03, DR-cross-cutting-07: the G2 dialog lists what is missing in plain words (no rule
// keys), and "Record decision" is off, with the reason, while the outcome cannot be recorded.
// Bailey Schmitt (2026-11-12): no button moves a quote forward until the work it needs is filled in. The
// tab says what is still needed, in words; holding, sending back and stopping stay available.
test('an unfinished review shows what is still needed in words and offers no button to move it forward', async ({
  page,
  request,
}) => {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  await request.post(`/api/v1/quotes/${quoteNumber}/gates/G1/decisions`, {
    headers: { [DEV_USER_HEADER]: 'sales-leader' },
    data: { outcomeKey: 'advance' },
  });
  await signInAs(page, 'eng-lead');
  await page.goto(`/quotes/${quoteNumber}?tab=engineering`);
  const tab = page.getByTestId('engineering-tab');
  const needed = tab.getByTestId('decide-needed');
  await expect(needed).toContainText('Still needed before this quote can move forward');
  await expect(needed).not.toContainText('process_type');
  await expect(needed).not.toContainText('must equal');
  await expect(page.getByRole('button', { name: 'Decide feasibility' })).toHaveCount(0);
  // The fields the quote needs say so.
  await expect(tab.getByLabel('Cavitation (required)')).toBeVisible();
  // Hold needs nothing from the quote: it is offered, and Advance is not.
  await tab.getByTestId('decide-other').click();
  const g2 = page.getByRole('dialog');
  await expect(g2.getByRole('heading', { name: 'Hold, send back or stop' })).toBeVisible();
  await expect(g2.getByRole('radio', { name: 'Advance', exact: true })).toHaveCount(0);
  await g2.getByRole('radio', { name: 'Hold', exact: true }).check();
  await expect(g2.getByRole('button', { name: 'Record decision' })).toBeEnabled();
  expect(await seriousViolations(page)).toEqual([]);
});

// Lead review (2026-10-30): the engineer submits the finished review to the engineering lead, who
// finds it under "Ready for my review" and sends it back with a note; the engineer sees the note.
test('the engineer submits to the engineering lead, who sends it back with a note', async ({
  browser,
  request,
}) => {
  const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });
  const engineerId = (
    (await (await request.get('/api/v1/me', { headers: as('engineer') })).json()) as {
      user: { id: string };
    }
  ).user.id;
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  const call = async (method: 'post' | 'put', path: string, persona: string, data?: object) => {
    const res = await request[method](`/api/v1/quotes/${quoteNumber}/${path}`, {
      headers: as(persona),
      ...(data ? { data } : {}),
    });
    expect(res.status(), await res.text()).toBeLessThan(300);
  };
  await call('post', 'gates/G1/decisions', 'sales-leader', { outcomeKey: 'advance' });
  await call('post', 'assignment', 'eng-lead', { engineerId });
  await call('post', 'eng-review/accept', 'engineer');
  await call('put', 'eng-review', 'engineer', {
    processType: 'EBM',
    machineType: 'EBM',
    plantCode: 'AURORA',
    cavitation: 8,
    cycleTimeS: 14.5,
  });
  await call('put', 'capacity-evidence', 'engineer', {
    rows: [
      {
        site: 'AURORA',
        assumedEffectivenessPct: 70,
        cycleTimeS: 14.5,
        utilizationBeforePct: 62,
        analysisDate: '2026-10-26',
        analystId: engineerId,
      },
    ],
  });

  const open = async (persona: string): Promise<Page> => {
    const page = await (await browser.newContext()).newPage();
    await signInAs(page, persona);
    return page;
  };

  // ── The engineer submits ──
  const eng = await open('engineer');
  await eng.goto(`/quotes/${quoteNumber}?tab=engineering`);
  // The submit button is the last thing on the tab, after the work.
  await eng
    .getByTestId('lead-review-actions')
    .getByRole('button', { name: 'Submit to engineering lead' })
    .click();
  await expect(eng.getByTestId('lead-review-submitted')).toContainText(
    'Submitted to the engineering lead',
  );
  await expect(eng.getByTestId('solution-form')).toHaveCount(0); // locked for the engineer

  // ── The lead finds it under "Ready for my review" and sends it back ──
  const lead = await open('eng-lead');
  await lead.goto('/queue/engineering');
  await lead.getByTestId('review-tab-ready').click();
  await expect(lead.getByRole('link', { name: quoteNumber })).toBeVisible();
  await lead.goto(`/quotes/${quoteNumber}?tab=engineering`);
  await lead.getByRole('button', { name: 'Send back to engineer' }).click();
  const dialog = lead.getByRole('dialog');
  await dialog
    .getByLabel('What should change?')
    .fill('Check the cavitation against the press size.');
  await dialog.getByRole('button', { name: 'Send back', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await seriousViolations(lead)).toEqual([]);

  // ── The engineer sees the note and can edit and resubmit ──
  await eng.reload();
  await expect(eng.getByTestId('lead-review-returned')).toContainText(
    'Check the cavitation against the press size.',
  );
  await expect(eng.getByTestId('solution-form')).toBeVisible();
  await expect(
    eng
      .getByTestId('lead-review-actions')
      .getByRole('button', { name: 'Submit to engineering lead' }),
  ).toBeVisible();
  expect(await seriousViolations(eng)).toEqual([]);
});

// FB-03 (F-059, F-061; T-023, T-030): one quote runs on two lines. The engineer enters both, sees
// utilization before and after on each row (after is calculated, red over 100%), is warned (not blocked)
// when the volumes do not add up to the quote's, and downloads the evidence as a CSV.
test('the engineer enters two lines, sees before and after, and downloads the CSV', async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });
  const engineerId = (
    (await (await request.get('/api/v1/me', { headers: as('engineer') })).json()) as {
      user: { id: string };
    }
  ).user.id;
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  const call = async (method: 'post' | 'put', path: string, persona: string, data?: object) => {
    const res = await request[method](`/api/v1/quotes/${quoteNumber}/${path}`, {
      headers: as(persona),
      ...(data ? { data } : {}),
    });
    expect(res.status(), await res.text()).toBeLessThan(300);
  };
  await call('post', 'gates/G1/decisions', 'sales-leader', { outcomeKey: 'advance' });
  await call('post', 'assignment', 'eng-lead', { engineerId });
  await call('post', 'eng-review/accept', 'engineer');
  // 10 s x 4 cavities x 80 % x 350 days = 9,676,800 units a year; the quote is 750,000 units a year.
  await call('put', 'eng-review', 'engineer', { cavitation: 4 });

  const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
  await signInAs(page, 'engineer');
  await page.goto(`/quotes/${quoteNumber}?tab=engineering`);
  const capacity = page.getByTestId('capacity-form');
  await expect(page.getByTestId('capacity-basis')).toContainText('A line runs 350 days a year');

  const fill = async (
    index: number,
    values: { line: string; volume: string; before: string; effectiveness: string; cycle: string },
  ) => {
    await capacity.getByRole('button', { name: 'Add capacity row' }).click();
    const row = capacity.getByTestId('capacity-row').nth(index);
    await row.getByLabel('Site').selectOption({ index: 1 });
    await row.getByLabel('Line / asset').fill(values.line);
    await row.getByLabel('Assumed effectiveness %').fill(values.effectiveness);
    await row.getByLabel('Cycle time (s)').fill(values.cycle);
    await row.getByLabel('Utilization before %').fill(values.before);
    if (values.volume) await row.getByLabel('Allocated annual volume (units)').fill(values.volume);
    return row;
  };

  // Line 1 takes 450,000 of the 750,000 units: 40 % + 450,000 / 9,676,800 = 44.7 %.
  const line1 = await fill(0, {
    line: 'Line 1',
    volume: '450000',
    before: '40',
    effectiveness: '80',
    cycle: '10',
  });
  await expect(line1.getByTestId('utilization-after')).toHaveText('44.7%');
  // After is read-only: there is no input for it.
  await expect(line1.getByLabel('Utilization after %')).toHaveCount(0);

  // Line 2 takes 200,000: the rows add up to 650,000, not 750,000 → a warning, not a block.
  const line2 = await fill(1, {
    line: 'Line 2',
    volume: '200000',
    before: '90',
    effectiveness: '80',
    cycle: '10',
  });
  // 90 % + 200,000 / 9,676,800 = 92.1 %: amber.
  await expect(line2.getByTestId('utilization-after')).toHaveText('92.1% · above 85%');
  await expect(line2.getByTestId('utilization-after')).toHaveAttribute('data-level', 'warn');
  await expect(page.getByTestId('allocation-warning')).toContainText('100,000 fewer than');

  // A third line that is over capacity shows red, with the reason.
  const line3 = await fill(2, {
    line: 'Line 3',
    volume: '9700000',
    before: '30',
    effectiveness: '80',
    cycle: '10',
  });
  await expect(line3.getByTestId('utilization-after')).toContainText('exceeds line capacity');
  await expect(line3.getByTestId('utilization-after')).toHaveAttribute('data-level', 'over');
  await capacity.getByRole('button', { name: 'Remove row 3' }).click();

  // Add the missing 100,000 back to line 2: the warning clears.
  await line2.getByLabel('Allocated annual volume (units)').fill('300000');
  await expect(page.getByTestId('allocation-warning')).toHaveCount(0);
  await capacity.getByRole('button', { name: 'Save capacity evidence' }).click();
  await expect(page.getByText('Capacity evidence saved')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  // Download CSV.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('capacity-csv').click(),
  ]);
  expect(download.suggestedFilename()).toBe(`${quoteNumber}-capacity-evidence.csv`);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  const lines = Buffer.concat(chunks).toString('utf8').trim().split('\r\n');
  expect(lines).toHaveLength(3);
  expect(lines[1]).toContain(`"${quoteNumber}"`);
  expect(lines[1]).toContain('"Trailing 12 months actual, trending OEE (provisional, D-021)"');
  expect(lines[1]).toContain('"Line 1"');
  expect(lines[1]).toContain('"40","44.7"');
  expect(lines[2]).toContain('"90","93.1"');
});
