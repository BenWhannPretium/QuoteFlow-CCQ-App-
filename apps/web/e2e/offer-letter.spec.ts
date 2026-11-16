import { readFile } from 'node:fs/promises';

import {
  buildOfferCostingWorkbook,
  offerCostingMap,
} from '@ccq/integrations/test/synthetic-workbooks';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { seriousViolations } from './axe';
import { as, ok } from './customer-decision';
import { prepareModels } from './models';
import { signInAs } from './personas';
import { freeOpportunities, isoDaysFromNow, submitQuote } from './quotes';

// FB-20 (F-070): the customer offer letter. A quote before Final Review says "Not available yet"; a KAM
// opens an approved three-item quote, types the Attention line and Part #s, sees the prices read from
// the (synthetic) costing workbook, ticks the warnings and downloads the Word document. Synthetic data
// only: the costing workbook is built in the test and read through a costing map that is switched on
// for this spec and removed afterwards (the real costing map is not built yet).

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const item = (n: number, over: Record<string, unknown> = {}) => ({
  key: `0193f2a0-0000-4000-8000-${String(900 + n).padStart(12, '0')}`,
  label: `${8 * n} oz bottle`,
  productFamily: 'BOTTLE',
  components: ['CONTAINER'],
  resin: 'HDPE',
  neckDiameter: '38',
  neckFinishType: '400',
  pcrLevel: '0',
  colorType: 'NATURAL',
  heightMm: 180,
  widthOrDiameterMm: 65,
  depthMm: 65,
  gramWeightG: 24,
  packagingType: 'BULK',
  estAnnualVolume: 250_000 * n,
  productNeededBy: isoDaysFromNow(120),
  containerSize: `${8 * n} oz`,
  standardDescription: `${8 * n} oz Bottle, HDPE`,
  drawingStatus: 'HAVE_DRAWING',
  ...over,
});

interface Setting {
  key: string;
  version: number;
  value: unknown;
}
const admin = as('admin');

async function setting(request: APIRequestContext, key: string): Promise<Setting> {
  const res = await ok(request.get('/api/v1/admin/config/settings', { headers: admin }));
  return ((await res.json()) as { items: Setting[] }).items.find((s) => s.key === key)!;
}

async function patchSetting(request: APIRequestContext, key: string, value: unknown, why: string) {
  const s = await setting(request, key);
  await ok(
    request.patch(`/api/v1/admin/config/settings/${key}`, {
      headers: admin,
      data: { version: s.version, changeReason: why, value },
    }),
  );
}

/** A three-item quote, engineered, costed (the synthetic offer workbook), priced and approved at G4. */
async function approvedThreeItemQuote(request: APIRequestContext): Promise<string> {
  const id = async (persona: string) =>
    (
      (await (await request.get('/api/v1/me', { headers: as(persona) })).json()) as {
        user: { id: string };
      }
    ).user.id;
  for (const p of ['kam', 'sales-leader', 'eng-lead', 'pricing', 'pricing-lead', 'approver']) {
    await request.get('/api/v1/me', { headers: as(p) });
  }
  const engineerId = await id('engineer');
  const pricingId = await id('pricing');
  const qn = await submitQuote(request, await freeOpportunities(request, 3), {
    items: [item(1), item(2), item(3)],
  });
  const post = (path: string, persona: string, data: unknown) =>
    ok(request.post(`/api/v1/quotes/${qn}/${path}`, { headers: as(persona), data }), 201);
  const put = (path: string, persona: string, data: unknown) =>
    ok(request.put(`/api/v1/quotes/${qn}/${path}`, { headers: as(persona), data }));

  await post('gates/G1/decisions', 'sales-leader', { outcomeKey: 'advance' });
  const detail = (await (
    await request.get(`/api/v1/quotes/${qn}`, { headers: as('eng-lead') })
  ).json()) as { engineering: { items: { id: string }[] } };
  const itemIds = detail.engineering.items.map((i) => i.id);
  expect(itemIds).toHaveLength(3);
  for (const itemId of itemIds) {
    await put('eng-review', 'eng-lead', {
      itemId,
      processType: 'EBM',
      machineType: 'EBM',
      plantCode: 'AURORA',
      cavitation: 8,
      cycleTimeS: 14.5,
      prelimCapitalUsd: 0,
    });
    await put('capacity-evidence', 'eng-lead', {
      itemId,
      rows: [
        {
          site: 'AURORA',
          assumedEffectivenessPct: 70,
          cycleTimeS: 14.5,
          utilizationBeforePct: 62,
          analysisDate: isoDaysFromNow(0),
          analystId: engineerId,
        },
      ],
    });
  }
  await put('capacity-signoff', 'eng-lead', { status: 'approved' });
  await post('gates/G2/decisions', 'eng-lead', { outcomeKey: 'proceed' });

  // Quoting: the models, then the synthetic costing workbook with a price per item (version 2).
  await prepareModels(request, qn);
  const workbook = await buildOfferCostingWorkbook([
    { piece: 0.0825, mold: 45_000 },
    { piece: 0.091 },
    { piece: 0.12, changeParts: 6_500 },
  ]);
  const upload = await request.post(`/api/v1/quotes/${qn}/attachments`, {
    headers: as('pricing'),
    multipart: {
      kind: 'cost_model',
      size: String(workbook.length),
      file: {
        name: 'Costing.synthetic.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: workbook,
      },
    },
  });
  expect(upload.status(), await upload.text()).toBe(201);
  await put('pricing-record', 'pricing', {
    approvedBy: pricingId,
    erfRefs: ['ERF26-213'],
    costingCompleted: true,
  });
  await put('capital-readiness', 'pricing', { capitalReadiness: 'pre_approved' });
  await post('gates/G3/decisions', 'pricing-lead', { outcomeKey: 'submit' });
  await put('terms', 'kam', {
    termsPaymentTermsCode: 'NET_30',
    termsToolingCommitment: false,
    checked: true,
  });
  await put('terms/capital', 'approver', {
    toolingFundingModel: 'COMPANY_FUNDED',
    termsMoldOwnership: 'PRETIUM',
    termsAmortized: false,
    termsMinSupply: 'None',
    termsAgreementInPlace: false,
    finalized: true,
  });
  await post('gates/G4/decisions', 'approver', { outcomeKey: 'approve' });
  return qn;
}

test('before Final Review approves the quote, the offer letter is not available yet', async ({
  page,
  request,
}) => {
  const qn = await submitQuote(request, await freeOpportunities(request, 3));
  await signInAs(page, 'kam');
  await page.goto(`/quotes/${qn}`);
  const card = page.getByTestId('offer-letter-card');
  await expect(card).toHaveAttribute('data-state', 'not-available');
  await expect(card).toContainText('Not available yet');
  await expect(card.getByRole('button', { name: 'Generate Word document' })).toHaveCount(0);
});

test('a KAM generates the offer letter for an approved three-item quote', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const templates = await setting(request, 'model_summary_templates');
  const original = templates.value as { templateId: string }[];
  await patchSetting(
    request,
    'model_summary_templates',
    [...original.filter((t) => t.templateId !== 'synthetic_offer_costing'), offerCostingMap(3)],
    'FB-20 e2e: a synthetic costing map, removed after the spec',
  );
  try {
    const qn = await approvedThreeItemQuote(request);

    // From My proposals to the quote's offer letter card.
    await signInAs(page, 'kam');
    await page.goto('/proposals');
    const proposal = page.locator(`[data-testid="proposal-card"][data-quote="${qn}"]`);
    await proposal.getByTestId('proposal-offer-letter').click();
    await expect(page).toHaveURL(new RegExp(`/quotes/${qn}#offer-letter$`));
    const card = page.getByTestId('offer-letter-card');
    await expect(card).toHaveAttribute('data-state', 'ready');
    await expect(card.getByTestId('offer-letter-draft-banner')).toContainText(
      'DRAFT: wording not yet approved by Legal',
    );

    // The prices are read-only: no field holds them, they come from the workbook.
    const preview = card.getByTestId('offer-letter-preview');
    await expect(preview.getByTestId('offer-item-1')).toContainText('$82.50');
    await expect(preview.getByTestId('offer-item-1')).toContainText('$45,000.00');
    await expect(preview.getByTestId('offer-item-2')).toContainText('$91.00');
    await expect(preview.getByTestId('offer-item-3')).toContainText('$120.00');
    await expect(preview.getByTestId('offer-item-3')).toContainText('$6,500.00');
    await expect(preview.getByRole('textbox')).toHaveCount(3); // the three Part # fields only
    await expect(card.getByTestId('offer-letter-source')).toContainText(
      'Figures come from the workbook and cannot be edited here.',
    );

    await card
      .getByRole('textbox', { name: 'Attention', exact: true })
      .fill('Alex Buyer, Procurement');
    await card.getByRole('textbox', { name: 'Part # for Item 1' }).fill('SYN-001');
    await card.getByRole('textbox', { name: 'Part # for Item 2' }).fill('SYN-002');
    const generate = card.getByRole('button', { name: 'Generate Word document' });
    // Item 3 has no Part #, and the wording is not approved: both must be ticked.
    const warnings = card.getByTestId('offer-letter-warnings');
    await expect(warnings.getByRole('checkbox')).toHaveCount(2);
    await expect(generate).toBeDisabled();
    for (const box of await warnings.getByRole('checkbox').all()) await box.check();
    await expect(generate).toBeEnabled();

    // Light and dark, desktop and phone: the card fits and is accessible.
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      for (const size of [
        { width: 1366, height: 768 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(size);
        expect(await noSideScroll(page), `${theme} ${size.width}`).toBe(true);
      }
      expect(await seriousViolations(page), theme).toEqual([]);
    }
    await page.setViewportSize({ width: 1366, height: 768 });

    const [download] = await Promise.all([page.waitForEvent('download'), generate.click()]);
    expect(download.suggestedFilename()).toBe(`${qn} Offer Letter 1.docx`);
    const bytes = await readFile(await download.path());
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
    const row = card.getByTestId('offer-letter-row');
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('data-letter', '1');
    await expect(row).toContainText('3 items');
  } finally {
    await patchSetting(
      request,
      'model_summary_templates',
      (
        (await setting(request, 'model_summary_templates')).value as { templateId: string }[]
      ).filter((t) => t.templateId !== 'synthetic_offer_costing'),
      'FB-20 e2e: remove the synthetic costing map',
    );
  }
});
