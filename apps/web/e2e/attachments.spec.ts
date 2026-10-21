import { readFile } from 'node:fs/promises';

import { expect, test, type APIRequestContext } from '@playwright/test';

import { seriousViolations } from './axe';
import { signInAs } from './personas';
import { asKam, freeOpportunities, submitQuote } from './quotes';

// B-16 (F-13): drawings and documents on a quote and on an intake draft, stored by the API's
// FILESTORE_MODE (local in e2e; SharePoint in Azure). Drawings are requested, never required.

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n', 'latin1');
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
  Buffer.from('JFIF'),
  Buffer.alloc(256, 7),
]);

/** A ready-to-submit draft on step 4 (through the API), without a drawing yet. */
async function readyDraft(request: APIRequestContext): Promise<string> {
  for (const id of await freeOpportunities(request, 1)) {
    const sf = (await (
      await request.get(`/api/v1/salesforce/opportunities/${id}`, { headers: asKam })
    ).json()) as { opportunity: { name: string; accountId: string; accountName: string } };
    const shipTo = {
      line1: '1 Test Way',
      city: 'St. Louis',
      state: 'MO',
      postal: '63101',
      country: 'US',
    };
    const res = await request.post('/api/v1/quotes/drafts', {
      headers: asKam,
      data: {
        step: 4,
        data: {
          sfOpportunityId: id,
          sfOpportunityName: sf.opportunity.name,
          customer: {
            status: 'existing',
            sfAccountId: sf.opportunity.accountId,
            name: sf.opportunity.accountName,
          },
          shipTo,
          shipToDefault: shipTo,
          requestClass: 'CCQ',
          productFamily: 'BOTTLE',
          components: ['CONTAINER'],
          market: 'FOOD',
          resin: 'HDPE',
          packagingType: 'BULK',
          estAnnualVolume: 750_000,
          drawingStatus: 'COMING',
        },
      },
    });
    if (res.status() === 201) return ((await res.json()) as { id: string }).id;
  }
  throw new Error('no free Salesforce opportunity for the attachments spec');
}

test.describe('Attachments', () => {
  test('quote page: upload a drawing (status set), refuse a wrong type, download, remove', async ({
    page,
    request,
  }) => {
    const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1), {
      drawingStatus: 'COMING',
    });
    await signInAs(page, 'kam');
    await page.goto(`/quotes/${quoteNumber}?tab=attachments`);
    const panel = page.getByTestId('attachments');
    await expect(panel.getByText('No files yet')).toBeVisible();

    await panel.getByLabel('Note (optional)').fill('Rev C from the customer');
    await panel.getByTestId('attachment-input').setInputFiles({
      name: 'Bottle drawing rev C.pdf',
      mimeType: 'application/pdf',
      buffer: PDF,
    });
    const row = panel.getByTestId('attachment-row').filter({ hasText: 'Bottle drawing rev C.pdf' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Bottle drawing');
    await expect(row).toContainText('Rev C from the customer');
    await expect(page.getByText('Drawing attached')).toBeVisible();

    // A type the API refuses is explained before anything is sent.
    await panel.getByTestId('attachment-input').setInputFiles({
      name: 'installer.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('MZ'),
    });
    await expect(panel.getByTestId('upload-error')).toContainText('This file type is not accepted');
    // Content that doesn't match its extension is refused by the server, with a clear message.
    await panel.getByRole('button', { name: 'Dismiss' }).click();
    await panel.getByTestId('attachment-input').setInputFiles({
      name: 'drawing.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('<html>not a pdf</html>'),
    });
    await expect(panel.getByTestId('upload-error')).toContainText('not a PDF');
    await panel.getByRole('button', { name: 'Dismiss' }).click();
    expect(await seriousViolations(page)).toEqual([]);

    // Download goes through the audited route to a short-lived link.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      row.getByRole('button', { name: /^Download/ }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('Bottle drawing rev C.pdf');
    expect(await readFile(await download.path())).toEqual(PDF);

    // The overview shows the drawing status the upload set, and the timeline the upload.
    await page.getByRole('tab', { name: 'Overview' }).click();
    await expect(page.getByText('File uploaded: Bottle drawing rev C.pdf')).toBeVisible();

    // The uploader may remove it (within 24 h); it leaves the list.
    await page.getByRole('tab', { name: 'Attachments' }).click();
    await row.getByRole('button', { name: /^Remove/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
    await expect(panel.getByText('No files yet')).toBeVisible();
  });

  test('an Approver sees and downloads files but cannot upload', async ({ page, request }) => {
    const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
    const res = await request.post(`/api/v1/quotes/${quoteNumber}/attachments`, {
      headers: asKam,
      multipart: {
        kind: 'spec',
        size: String(PDF.length),
        file: { name: 'spec.pdf', mimeType: 'application/pdf', buffer: PDF },
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    await signInAs(page, 'approver');
    await page.goto(`/quotes/${quoteNumber}?tab=attachments`);
    const panel = page.getByTestId('attachments');
    await expect(panel.getByTestId('attachment-row')).toContainText('spec.pdf');
    await expect(panel.getByTestId('drop-zone')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  });

  test('intake draft: attach the drawing in step 4, then submit; the file is on the quote', async ({
    page,
    request,
  }) => {
    const draftId = await readyDraft(request);
    await signInAs(page, 'kam');
    await page.goto(`/intake/new?draft=${draftId}`);
    await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '4');
    await expect(page.locator('#intake-drawing-status')).toHaveValue('COMING');

    await page.getByTestId('attachment-input').setInputFiles({
      name: 'drawing.pdf',
      mimeType: 'application/pdf',
      buffer: PDF,
    });
    await expect(page.getByTestId('attachment-row')).toContainText('drawing.pdf');
    // The wizard mirrors the drawing status the upload set.
    await expect(page.locator('#intake-drawing-status')).toHaveValue('HAVE_DRAWING');
    expect(await seriousViolations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Submit to CCQ' }).click();
    await expect(page.getByTestId('submitted')).toBeVisible();
    const quoteNumber = (await page.getByTestId('quote-number').textContent())!.trim();
    await page.goto(`/quotes/${quoteNumber}?tab=attachments`);
    await expect(page.getByTestId('attachment-row')).toContainText('drawing.pdf');
  });
});

test.describe('Attachments at 390 × 844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a phone can add a photo of the sample and upload it', async ({ page, request }) => {
    const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
    await signInAs(page, 'kam');
    await page.goto(`/quotes/${quoteNumber}?tab=attachments`);
    const camera = page.getByTestId('attachment-camera');
    await expect(camera).toHaveAttribute('capture', 'environment');
    await expect(camera).toHaveAttribute('accept', 'image/*');
    await expect(page.getByText('Add photo')).toBeVisible();
    await camera.setInputFiles({ name: 'IMG_0042.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    const row = page.getByTestId('attachment-row');
    await expect(row).toContainText('IMG_0042.jpg');
    await expect(row).toContainText('Sample photo');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
