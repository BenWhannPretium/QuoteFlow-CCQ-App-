import { expect, type APIRequestContext } from '@playwright/test';

// Quotes created through the API as the KAM persona, for specs that start from a submitted quote
// (the intake UI has its own spec). The e2e database is config-seeded only.

export const DEV_USER_HEADER = 'x-dev-user';
export const asKam = { [DEV_USER_HEADER]: 'kam' };

export async function freeOpportunities(
  request: APIRequestContext,
  count: number,
): Promise<string[]> {
  const found = new Set<string>();
  for (const q of ['Bottle', 'Jar', 'Closure', 'Preform', 'Tub', 'Pack', 'Container']) {
    const res = await request.get(
      `/api/v1/salesforce/opportunities?q=${q}&mine=false&openOnly=true&limit=50`,
      { headers: asKam },
    );
    expect(res.ok(), await res.text()).toBe(true);
    const body = (await res.json()) as {
      items: { id: string; accountId: string | null; activeQuote: unknown }[];
    };
    for (const o of body.items) if (!o.activeQuote && o.accountId) found.add(o.id);
    if (found.size >= count + 5) break;
  }
  // Shuffle a little so parallel / repeated runs don't race for the same opportunity.
  return [...found].sort(() => Math.random() - 0.5).slice(0, count + 5);
}

/** Creates and submits an intake as the KAM; returns the quote number (waiting for G1). */
export async function submitQuote(
  request: APIRequestContext,
  candidates: string[],
  over: Record<string, unknown> = {},
): Promise<string> {
  while (candidates.length > 0) {
    const id = candidates.shift()!;
    const detail = await request.get(`/api/v1/salesforce/opportunities/${id}`, { headers: asKam });
    const sf = (await detail.json()) as {
      opportunity: {
        name: string;
        accountId: string;
        accountName: string;
        closeDate: string | null;
      };
      account: { id: string; name: string } | null;
    };
    const shipTo = {
      line1: '1 Test Way',
      city: 'St. Louis',
      state: 'MO',
      postal: '63101',
      country: 'US',
    };
    const draft = await request.post('/api/v1/quotes/drafts', {
      headers: asKam,
      data: {
        data: {
          sfOpportunityId: id,
          sfOpportunityName: sf.opportunity.name,
          customer: {
            status: 'existing',
            sfAccountId: sf.account?.id ?? sf.opportunity.accountId,
            name: sf.account?.name ?? sf.opportunity.accountName,
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
          estAnnualRevenue: 150_000,
          expectedCloseDate: sf.opportunity.closeDate,
          drawingStatus: 'HAVE_DRAWING',
          ...over,
        },
      },
    });
    expect(draft.status(), await draft.text()).toBe(201);
    const { id: draftId } = (await draft.json()) as { id: string };
    const submit = await request.post(`/api/v1/quotes/drafts/${draftId}/submit`, {
      headers: asKam,
    });
    if (submit.status() === 409) continue; // someone else took this opportunity
    expect(submit.status(), await submit.text()).toBe(201);
    return ((await submit.json()) as { quoteNumber: string }).quoteNumber;
  }
  throw new Error('no free Salesforce opportunity for the e2e spec');
}
