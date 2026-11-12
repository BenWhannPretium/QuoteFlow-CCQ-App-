import { DEV_USER_HEADER, QuoteDetail } from '@ccq/contracts';
import type { Role } from '@ccq/domain';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

import { personaFor } from './permissions/asRole';

/**
 * FB-07 (D-001) test helpers: upload a Quoting model (costing model, ROI model, price table) the way
 * the SPA does, and get a quote's models in place before its costing is attested and G3 is decided.
 * The workbook is a synthetic stand-in: a zip header (what the .xlsx content check reads) and padding.
 */
export const XLSX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(256, 7)]);

export type ModelKind = 'cost_model' | 'roi_model' | 'price_table';

function multipart(fields: Record<string, string>, file: { name: string; content: Buffer }) {
  const boundary = `----ccq${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    file.content,
    Buffer.from('\r\n'),
    Buffer.from(`--${boundary}--\r\n`),
  );
  return {
    payload: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/**
 * Upload one model. The ROI model goes to its own route (`roi.upload`); the costing model and the
 * price table to the quote's attachments route with their kind.
 */
export function uploadModel(
  app: FastifyInstance,
  quoteNumber: string,
  kind: ModelKind,
  role: Role,
  fileName = `${kind}.xlsx`,
  persona?: string,
): Promise<LightMyRequestResponse> {
  return uploadModelFile(app, quoteNumber, kind, role, fileName, XLSX, persona);
}

/** FB-14: upload a given workbook (a synthetic one from `@ccq/integrations/test/synthetic-workbooks`). */
export function uploadModelFile(
  app: FastifyInstance,
  quoteNumber: string,
  kind: ModelKind,
  role: Role,
  fileName: string,
  content: Buffer,
  persona?: string,
): Promise<LightMyRequestResponse> {
  const body = multipart({ kind, size: String(content.length) }, { name: fileName, content });
  const url =
    kind === 'roi_model'
      ? `/api/v1/quotes/${quoteNumber}/roi-model`
      : `/api/v1/quotes/${quoteNumber}/attachments`;
  return app.inject({
    method: 'POST',
    url,
    headers: {
      [DEV_USER_HEADER]: persona ?? personaFor(role),
      'content-type': body.contentType,
    },
    payload: body.payload,
  });
}

/**
 * Before a test attests costing and approves the price: Pricing uploads the costing model, and Finance
 * the ROI model when the quote needs one. Fails the test on any refusal.
 */
export async function prepareModels(app: FastifyInstance, quoteNumber: string): Promise<void> {
  const cost = await uploadModel(app, quoteNumber, 'cost_model', 'Pricing');
  if (cost.statusCode !== 201)
    throw new Error(`cost_model upload: ${cost.statusCode} ${cost.body}`);
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/quotes/${quoteNumber}`,
    headers: { [DEV_USER_HEADER]: personaFor('Pricing') },
  });
  const detail = QuoteDetail.parse(res.json());
  if (detail.quoting?.steps.roi.required) {
    const roi = await uploadModel(app, quoteNumber, 'roi_model', 'Finance');
    if (roi.statusCode !== 201) throw new Error(`roi_model upload: ${roi.statusCode} ${roi.body}`);
  }
}

/**
 * FB-06 (F-058): Engineering's equipment BOM, uploaded on the quote's attachments route with its kind
 * (versioned, like the models). G2 "Capital required" needs one on file.
 */
export function uploadBom(
  app: FastifyInstance,
  quoteNumber: string,
  role: Role = 'EngLead',
  fileName = 'CSR BOM one-pager.xlsx',
  persona?: string,
): Promise<LightMyRequestResponse> {
  const body = multipart(
    { kind: 'equipment_bom', size: String(XLSX.length) },
    { name: fileName, content: XLSX },
  );
  return app.inject({
    method: 'POST',
    url: `/api/v1/quotes/${quoteNumber}/attachments`,
    headers: {
      [DEV_USER_HEADER]: persona ?? personaFor(role),
      'content-type': body.contentType,
    },
    payload: body.payload,
  });
}

/** Before a test decides G2 "Capital required": the EngLead uploads the BOM. Fails the test on a refusal. */
export async function prepareBom(app: FastifyInstance, quoteNumber: string): Promise<void> {
  const res = await uploadBom(app, quoteNumber);
  if (res.statusCode !== 201)
    throw new Error(`equipment_bom upload: ${res.statusCode} ${res.body}`);
}

/**
 * FB-08 (F-068, T-031): the approver confirms the capital terms in Final Review, which G4 Advance
 * needs (`g4_required_checks` terms_finalized). Call it on a quote in Final Review before approving.
 */
export async function confirmCapitalTerms(
  app: FastifyInstance,
  quoteNumber: string,
  persona = personaFor('Approver'),
): Promise<void> {
  const res = await app.inject({
    method: 'PUT',
    url: `/api/v1/quotes/${quoteNumber}/terms/capital`,
    headers: { [DEV_USER_HEADER]: persona },
    payload: {
      toolingFundingModel: 'COMPANY_FUNDED',
      termsMoldOwnership: 'PRETIUM',
      termsAmortized: false,
      termsMinSupply: 'None',
      termsAgreementInPlace: false,
      finalized: true,
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`confirming the capital terms failed: ${res.statusCode} ${res.body}`);
  }
}
