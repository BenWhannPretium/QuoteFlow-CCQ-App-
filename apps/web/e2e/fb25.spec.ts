import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { as, ok } from './customer-decision';
import { prepareModels } from './models';
import { signInAs } from './personas';
import { freeOpportunities, submitQuote } from './quotes';

// FB-25 (N17-18, N17-25 to N17-29, N18-17, N18-18; Nov 17 and 18 feedback): the quote page and Final
// Review. Synthetic data only; the quotes are created through the API.

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const userId = async (request: APIRequestContext, persona: string) =>
  (
    (await (await request.get('/api/v1/me', { headers: as(persona) })).json()) as {
      user: { id: string };
    }
  ).user.id;

/** A quote in Final Review: priced and submitted, its terms at Net 30, the tooling commitment unanswered. */
async function inFinalReview(request: APIRequestContext): Promise<string> {
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
    toolingNotes: 'Two-cavity pilot mold first',
  });
  await put('capacity-evidence', 'eng-lead', {
    rows: [
      {
        site: 'AURORA',
        assumedEffectivenessPct: 70,
        cycleTimeS: 14.5,
        utilizationBeforePct: 62,
        analysisDate: '2026-10-26',
        analystId: await userId(request, 'engineer'),
        notes: 'Line 3 has room after the summer changeover',
      },
    ],
  });
  await put('capacity-signoff', 'eng-lead', { status: 'approved' });
  await post('gates/G2/decisions', 'eng-lead', { outcomeKey: 'proceed' });
  await prepareModels(request, qn);
  await put('pricing-record', 'pricing', {
    approvedBy: await userId(request, 'pricing'),
    costingCompleted: true,
  });
  await put('capital-readiness', 'pricing', { capitalReadiness: 'not_required' });
  await post('gates/G3/decisions', 'pricing-lead', { outcomeKey: 'submit' });
  await put('terms', 'kam', { termsPaymentTermsCode: 'NET_30' });
  return qn;
}

test('N18-17: a sales leader opens the to-qualify notice on its card, expands the cards and advances', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const candidates = await freeOpportunities(request, 2);
  const qn = await submitQuote(request, candidates);
  const other = await submitQuote(request, candidates);

  await signInAs(page, 'sales-leader');
  await page.goto('/notifications');
  const notice = page
    .getByTestId('notification-page-list')
    .getByRole('link', { name: new RegExp(`${qn} is waiting to qualify`) });
  await notice.click();
  // To qualify, not the quote's Overview, with this quote's card open and in view.
  await expect(page).toHaveURL(new RegExp(`/approvals\\?tab=to-qualify&quote=${qn}$`));
  const card = page.locator(`[data-testid="queue-item"][data-quote="${qn}"]`);
  const toggle = card.getByTestId('queue-details-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAccessibleName(`Hide details of ${qn}`);
  await expect(card).toBeInViewport();
  const details = card.getByTestId('queue-details');
  // What the KAM entered, read-only: the request, the product facts, the volume, the files.
  await expect(details).toContainText('Customer');
  await expect(details).toContainText('Annual volume');
  await expect(details.getByTestId('queue-details-files')).toBeVisible();
  await expect(details.locator('input, select, textarea')).toHaveCount(0);
  const otherCard = page.locator(`[data-testid="queue-item"][data-quote="${other}"]`);
  await expect(otherCard.getByTestId('queue-details')).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);

  // Expand all / Collapse all, and one card by the keyboard.
  await page.getByTestId('expand-all').click();
  await expect(otherCard.getByTestId('queue-details')).toBeVisible();
  await page.getByTestId('collapse-all').click();
  await expect(page.getByTestId('queue-details')).toHaveCount(0);
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(details).toBeVisible();

  // Advance from the card.
  await card.getByRole('button', { name: `Decide ${qn}` }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Advance' }).check();
  await dialog.getByRole('button', { name: 'Record decision' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card).toHaveCount(0);
});

test('N18-18: Commercial terms has its own tab; the Overview is a read-only summary; the bar stays in view', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const qn = await inFinalReview(request);
  await signInAs(page, 'kam');
  await page.setViewportSize({ width: 1366, height: 768 });
  // The terms wait on the KAM (the tooling commitment is not answered): the quote opens on them,
  // with the dot on the tab.
  await page.goto(`/quotes/${qn}`);
  await expect(page).toHaveURL(new RegExp(`/quotes/${qn}\\?tab=commercial$`));
  const tabs = page.getByRole('tablist', { name: 'Quote sections' });
  await expect(tabs.getByRole('tab')).toHaveText([
    'Overview',
    'Engineering',
    // FB-30 (N19-28): Capacity has its own tab, beside Engineering.
    'Capacity',
    'Quoting',
    'Commercial terms',
    'Attachments',
  ]);
  await expect(page.getByTestId('quote-tab-commercial').getByTestId('tab-work-dot')).toBeVisible();
  await expect(page.getByTestId('quote-tab-commercial')).toHaveAccessibleDescription(
    'Work is waiting for you on this tab.',
  );
  // N17-28: at Net 30 the non-standard box is not offered.
  const panel = page.getByTestId('commercial-panel');
  await expect(panel.getByLabel('Payment terms', { exact: true })).toHaveValue('NET_30');
  await expect(panel.getByTestId('nonstandard-box')).toHaveCount(0);
  await panel.getByLabel('Payment terms', { exact: true }).selectOption({ label: 'Net 60' });
  await expect(panel.getByTestId('nonstandard-box').getByRole('checkbox')).toBeChecked();
  await expect(panel.getByTestId('nonstandard-box').getByRole('checkbox')).toBeDisabled();
  await panel.getByLabel('Payment terms', { exact: true }).selectOption({ label: 'Net 30' });
  await expect(panel.getByTestId('nonstandard-box')).toHaveCount(0);
  // N17-26: the KAM answers the tooling commitment here.
  await panel.getByLabel('Customer tooling commitment').selectOption('no');
  await panel.getByRole('button', { name: 'Save terms' }).click();
  await expect(panel.getByRole('button', { name: 'Save terms' })).toBeDisabled();
  await expect(page.getByTestId('quote-tab-commercial').getByTestId('tab-work-dot')).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);

  // The Overview: "At a glance", read-only, rows with no value left out.
  await page.getByRole('tab', { name: 'Overview' }).click();
  const glance = page.getByTestId('at-a-glance');
  await expect(glance.getByRole('heading', { name: 'At a glance' })).toBeVisible();
  await expect(glance.locator('input, select, textarea')).toHaveCount(0);
  const eng = glance.getByTestId('glance-engineering');
  await expect(eng).toContainText('Two-cavity pilot mold first');
  await expect(eng).toContainText('Feasibility decided');
  await expect(eng).not.toContainText('Technical concept');
  // FB-30 (N19-28): capacity has its own card, with the sign-off; its notes moved there.
  const cap = glance.getByTestId('glance-capacity');
  await expect(cap).toContainText('Line 3 has room after the summer changeover');
  await expect(cap).toContainText('Capacity is signed off');
  await expect(eng).not.toContainText('Line 3 has room after the summer changeover');
  await expect(glance.getByTestId('glance-pricing')).toContainText('Price approval');
  const terms = glance.getByTestId('glance-terms');
  await expect(terms).toContainText('Net 30');
  await expect(terms.getByTestId('glance-terms-edit')).toHaveAttribute(
    'href',
    `/quotes/${qn}?tab=commercial`,
  );
  await expect(page.getByTestId('quote-timeline')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  // N17-18: the tab bar stays in view under the header while the page scrolls.
  await page.mouse.wheel(0, 3000);
  await expect(tabs).toBeInViewport({ ratio: 1 });

  // 390 px: no sideways page scroll; the bar is still there.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(tabs).toBeVisible();
  expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
});

test('N17-25 to N17-27: the approver sees what is required and uses "Decide final review" under the terms', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const qn = await inFinalReview(request);
  // Everything but mold ownership pre-filled (not confirmed).
  await ok(
    request.put(`/api/v1/quotes/${qn}/terms/capital`, {
      headers: as('approver'),
      data: {
        toolingFundingModel: 'COMPANY_FUNDED',
        termsAmortized: false,
        termsMinSupply: 'None',
        termsAgreementInPlace: false,
      },
    }),
  );
  await page.setViewportSize({ width: 1366, height: 768 });
  await signInAs(page, 'approver', 'dark');
  await page.goto(`/quotes/${qn}/review`);
  const terms = page.getByTestId('review-terms-legal');
  await expect(terms.getByTestId('required-key')).toBeVisible();
  // Mold ownership and the funding model are marked required here (and only here).
  await expect(
    terms.getByRole('combobox', { name: 'Mold ownership (required)', exact: true }),
  ).toBeVisible();
  await expect(
    terms.getByRole('combobox', { name: 'Funding model (required)', exact: true }),
  ).toBeVisible();
  await expect(terms.getByTestId('review-tooling-unanswered')).toBeVisible();

  // What blocks the release: the confirmation, the missing capital term, and the tooling commitment.
  const blockers = page.getByTestId('review-blockers');
  await expect(blockers).toContainText("The approver's confirmation of the capital terms");
  await expect(blockers).toContainText('Mold ownership (needed to confirm the capital terms)');
  await expect(blockers).toContainText('The customer tooling commitment answered');
  await expect(
    blockers.getByRole('link', { name: 'Answer it on the Commercial terms tab' }),
  ).toHaveAttribute('href', `/quotes/${qn}?tab=commercial#terms-tooling-commitment`);
  await expect(page.getByTestId('decision-bar-blockers')).toContainText(
    'The offer cannot be released yet',
  );
  // One decision button, not a row of outcomes.
  const bar = page.getByTestId('decision-bar');
  await expect(bar.getByRole('button')).toHaveText(['See what blocks it', 'Decide final review']);
  expect(await seriousViolations(page)).toEqual([]);

  // "Go to the field" focuses mold ownership; the approver fills it and confirms.
  await blockers
    .locator('li[data-blocker="capital_term:mold_ownership"]')
    .getByRole('button', { name: 'Go to the field' })
    .click();
  const mold = terms.getByRole('combobox', { name: 'Mold ownership (required)', exact: true });
  await expect(mold).toBeFocused();
  await mold.selectOption({ label: 'Pretium' });
  await terms.getByTestId('confirm-capital-terms').click();
  await expect(terms.getByTestId('capital-terms-confirmed')).toContainText('Confirmed by');

  // The KAM answers the tooling commitment (it is the terms owner's field).
  await ok(
    request.put(`/api/v1/quotes/${qn}/terms`, {
      headers: as('kam'),
      data: { termsToolingCommitment: false },
    }),
  );
  await page.reload();
  await expect(page.getByTestId('review-blockers')).toHaveCount(0);
  await expect(page.getByTestId('decision-bar-ready')).toBeVisible();

  // "Decide final review" again under the terms: the dialog offers the outcomes, none chosen.
  const below = page.getByTestId('decide-below-terms');
  await below.scrollIntoViewIfNeeded();
  await below.getByRole('button', { name: 'Decide final review' }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('radio', { name: 'Advance (release the offer)', exact: true }),
  ).not.toBeChecked();
  await dialog.getByRole('radio', { name: 'Advance (release the offer)', exact: true }).check();
  await dialog.getByRole('button', { name: 'Record decision' }).click();
  await expect(page).toHaveURL(/\/approvals\?tab=final-review/);
  const after = (await (
    await request.get(`/api/v1/quotes/${qn}`, { headers: as('approver') })
  ).json()) as { stageKey: string };
  expect(after.stageKey).toBe('CUSTOMER_DECISION');
});

test('N17-29: the funding help stays on screen and scrolls, at 1366, 390 and 320 px, in both themes', async ({
  browser,
  request,
}) => {
  test.setTimeout(150_000);
  const qn = await inFinalReview(request);
  const sizes = [
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 640 },
  ];
  const places: { persona: string; path: string; within?: string }[] = [
    // The Commercial terms tab (Engineering's funding model).
    { persona: 'eng-lead', path: `/quotes/${qn}?tab=commercial` },
    // Final Review's capital terms.
    { persona: 'approver', path: `/quotes/${qn}/review`, within: 'review-capital-terms' },
    // The intake uses the same component (its wizard is FB-24's, changing in parallel): checked by
    // hand at the three widths, not walked here.
  ];
  for (const theme of ['light', 'dark'] as const) {
    for (const place of places) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await signInAs(page, place.persona, theme);
      for (const size of sizes) {
        await page.setViewportSize(size);
        await page.goto(place.path);
        const scope = place.within ? page.getByTestId(place.within) : page;
        const trigger = scope.getByTestId('funding-help').first();
        await trigger.scrollIntoViewIfNeeded();
        await trigger.click();
        const help = page.getByTestId('funding-help-content');
        await expect(help).toBeVisible();
        const box = (await help.boundingBox())!;
        const label = `${place.persona} ${theme} ${size.width}`;
        expect(box.y, label).toBeGreaterThanOrEqual(0);
        expect(box.x, label).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height, label).toBeLessThanOrEqual(size.height + 1);
        expect(box.x + box.width, label).toBeLessThanOrEqual(size.width + 1);
        // Its own scroll when the text is taller than the room left.
        expect(await help.evaluate((el) => getComputedStyle(el).overflowY), label).toBe('auto');
        expect(await noSidewaysScroll(page), label).toBeLessThanOrEqual(0);
        if (size.width === 1366) expect(await seriousViolations(page), label).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(help).toHaveCount(0);
      }
      await context.close();
    }
  }
});
