import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';

import { prepareModels } from './models';
import { DEV_USER_HEADER, freeOpportunities, submitQuote } from './quotes';

// Shared by the outcome (B-13) and FB-04 specs: takes a quote through the API to Customer Decision.

export const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });

export async function ok(res: Promise<APIResponse>, status = 200) {
  const r = await res;
  expect(r.status(), await r.text()).toBe(status);
  return r;
}

/** Today on the US Central calendar (the server's validity and acceptance dates use it). */
export const centralToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/** Qualified, engineered, priced and released by Final Review: waiting for the customer. */
export async function quoteInCustomerDecision(
  request: APIRequestContext,
  engineerId: string,
  pricingId: string,
): Promise<string> {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  const post = (path: string, persona: string, data: unknown) =>
    ok(request.post(`/api/v1/quotes/${quoteNumber}/${path}`, { headers: as(persona), data }), 201);
  const put = (path: string, persona: string, data: unknown) =>
    ok(request.put(`/api/v1/quotes/${quoteNumber}/${path}`, { headers: as(persona), data }));
  await post('gates/G1/decisions', 'sales-leader', { outcomeKey: 'advance' });
  await put('eng-review', 'eng-lead', {
    processType: 'EBM',
    machineType: 'EBM_SHUTTLE',
    plantCode: 'PLANT_01',
    cavitation: 8,
    cycleTimeS: 14.5,
    prelimCapitalUsd: 180000,
  });
  await put('capacity-evidence', 'eng-lead', {
    rows: [
      {
        site: 'PLANT_01',
        assumedEffectivenessPct: 70,
        cycleTimeS: 14.5,
        utilizationBeforePct: 62,
        analysisDate: '2026-10-26',
        analystId: engineerId,
      },
    ],
  });
  await put('capacity-signoff', 'eng-lead', { status: 'approved' });
  await post('gates/G2/decisions', 'eng-lead', { outcomeKey: 'proceed' });
  // FB-07 (F-032): the costing model (and the ROI model when needed) before costing is attested.
  await prepareModels(request, quoteNumber);
  await put('pricing-record', 'pricing', {
    approvedBy: pricingId,
    erfRefs: ['ERF26-213'],
    costingCompleted: true,
  });
  await put('capital-readiness', 'pricing', { capitalReadiness: 'pre_approved' });
  // 2026-10-30: the pricing lead decides G3.
  await post('gates/G3/decisions', 'pricing-lead', { outcomeKey: 'submit' });
  await put('terms', 'kam', {
    termsPaymentTermsCode: 'NET_30',
    termsToolingCommitment: false,
    checked: true,
  });
  // FB-08 (F-068, T-031): the approver confirms the capital terms before releasing the offer.
  await put('terms/capital', 'approver', {
    toolingFundingModel: 'COMPANY_FUNDED',
    termsMoldOwnership: 'PRETIUM',
    termsAmortized: false,
    termsMinSupply: 'None',
    termsAgreementInPlace: false,
    finalized: true,
  });
  await post('gates/G4/decisions', 'approver', { outcomeKey: 'approve' });
  return quoteNumber;
}
