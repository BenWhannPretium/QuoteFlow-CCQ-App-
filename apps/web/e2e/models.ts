import { expect, type APIRequestContext } from '@playwright/test';

import { DEV_USER_HEADER } from './quotes';

/**
 * FB-07 (D-001): the Quoting models, uploaded through the API for specs that start after costing.
 * A synthetic workbook: the zip header the .xlsx content check reads, then padding (never a real model).
 */
export const SYNTHETIC_XLSX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.alloc(512, 7),
]);

export type ModelKind = 'cost_model' | 'roi_model' | 'price_table';

export async function uploadModel(
  request: APIRequestContext,
  quoteNumber: string,
  kind: ModelKind,
  persona: string,
  name = `${kind}.synthetic.xlsx`,
) {
  const url =
    kind === 'roi_model'
      ? `/api/v1/quotes/${quoteNumber}/roi-model`
      : `/api/v1/quotes/${quoteNumber}/attachments`;
  const res = await request.post(url, {
    headers: { [DEV_USER_HEADER]: persona },
    // The text fields first (the server streams the file to the store and needs the size up front).
    multipart: {
      kind,
      size: String(SYNTHETIC_XLSX.length),
      file: {
        name,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: SYNTHETIC_XLSX,
      },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return res;
}

/** Before costing is attested: the costing model, and the ROI model when the quote needs one. */
export async function prepareModels(request: APIRequestContext, quoteNumber: string) {
  await uploadModel(request, quoteNumber, 'cost_model', 'pricing');
  const res = await request.get(`/api/v1/quotes/${quoteNumber}`, {
    headers: { [DEV_USER_HEADER]: 'pricing' },
  });
  const quote = (await res.json()) as { quoting: { steps: { roi: { required: boolean } } } };
  if (quote.quoting.steps.roi.required) {
    await request.get('/api/v1/me', { headers: { [DEV_USER_HEADER]: 'finance' } });
    await uploadModel(request, quoteNumber, 'roi_model', 'finance');
  }
}

/**
 * FB-06 (F-058): Engineering's equipment BOM, uploaded through the API by specs that decide G2
 * "Capital required" without going through the Engineering tab. The EngLead (or the assigned engineer)
 * uploads it; the server needs one on file for that outcome.
 */
export async function uploadBom(
  request: APIRequestContext,
  quoteNumber: string,
  persona = 'eng-lead',
  name = 'CSR BOM one-pager.synthetic.xlsx',
) {
  const res = await request.post(`/api/v1/quotes/${quoteNumber}/attachments`, {
    headers: { [DEV_USER_HEADER]: persona },
    multipart: {
      kind: 'equipment_bom',
      size: String(SYNTHETIC_XLSX.length),
      file: {
        name,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: SYNTHETIC_XLSX,
      },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return res;
}
