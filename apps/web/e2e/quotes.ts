import { expect, type APIRequestContext, type Page } from '@playwright/test';

// Quotes created through the API as the KAM persona, for specs that start from a submitted quote
// (the intake UI has its own spec). The e2e database is config-seeded only.

export const DEV_USER_HEADER = 'x-dev-user';
export const asKam = { [DEV_USER_HEADER]: 'kam' };

/** YYYY-MM-DD `days` from today (UTC), for the intake's need-by dates. */
export const isoDaysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The opportunities the KAM persona has an open intake draft on. The wizard creates the draft the
 * moment a spec clicks "Use this opportunity", so these are taken even though they have no quote yet:
 * a second spec quoting one would make the first one's submit meet "already open" (FB-19).
 */
async function draftedOpportunities(request: APIRequestContext): Promise<Set<string>> {
  const res = await request.get('/api/v1/quotes/drafts', { headers: asKam });
  expect(res.ok(), await res.text()).toBe(true);
  const { items } = (await res.json()) as { items: { sfOpportunityId: string | null }[] };
  return new Set(items.flatMap((d) => (d.sfOpportunityId ? [d.sfOpportunityId] : [])));
}

const shuffled = <T>(xs: T[]) =>
  xs
    .map((x) => ({ x, k: Math.random() }))
    .sort((a, b) => a.k - b.k)
    .map(({ x }) => x);

/**
 * Opportunities handed out although they already have an active quote, because the free ones ran out.
 * The specs share 87 open synthetic opportunities; since the UX specs (2026-11-17) a full run asks for
 * more than that, and the specs that ran last failed with "no free Salesforce opportunity". A quote
 * built through the API does not need an opportunity of its own: the workflow setting
 * `opportunity_active_quotes` (seeded `warn`) lets a KAM put a separate quote on the same opportunity
 * after confirming, and `submitQuote` confirms for these.
 */
const sharedOpportunities = new Set<string>();

export async function freeOpportunities(
  request: APIRequestContext,
  count: number,
): Promise<string[]> {
  const drafted = await draftedOpportunities(request);
  const found = new Set<string>();
  const taken = new Set<string>();
  // A search returns at most 50 rows, ranked the same way every time, so a few broad words alone stop
  // reaching free opportunities once the specs have quoted the top 50. The synthetic names carry the
  // size ("16oz HDPE Boston Round"), so the sizes split the pool into small, reachable groups.
  const sizes = ['2oz', '4oz', '8oz', '12oz', '16oz', '24oz', '32oz', '64oz', '128oz'];
  for (const q of ['Bottle', 'Jar', 'Closure', 'Preform', 'Tub', 'Pack', 'Container', ...sizes]) {
    const res = await request.get(
      `/api/v1/salesforce/opportunities?q=${q}&mine=false&openOnly=true&limit=50`,
      { headers: asKam },
    );
    expect(res.ok(), await res.text()).toBe(true);
    const body = (await res.json()) as {
      items: { id: string; accountId: string | null; activeQuote: unknown }[];
    };
    for (const o of body.items) {
      if (!o.accountId) continue;
      if (!o.activeQuote && !drafted.has(o.id)) found.add(o.id);
      else if (o.activeQuote) taken.add(o.id);
    }
    if (found.size >= count + 5) break;
  }
  // Shuffle so parallel / repeated runs don't race for the same opportunity.
  const free = shuffled([...found]).slice(0, count + 5);
  if (free.length >= count) return free;
  // Not enough free ones left: make up the number with opportunities that already have a quote.
  const shared = shuffled([...taken]).slice(0, count + 5 - free.length);
  for (const id of shared) sharedOpportunities.add(id);
  return [...free, ...shared];
}

/**
 * Picks a free opportunity in the intake picker and starts its intake (step 2). It prefers one that
 * `word` finds, as a KAM would search; when every one of those already has a quote, it takes any free
 * opportunity. The specs share 87 open synthetic opportunities and create about 65 quotes a run, so one
 * word's handful (17 jars) can be used up by the API-built quotes before the spec that searches for it
 * runs. An opportunity another spec has an intake draft on counts as taken, and the word's matches
 * are shuffled so specs searching the same word don't reach for the same one. Each candidate is found
 * by its exact name and picked by its id; one that a parallel spec quoted a moment ago (no "Use"
 * button any more) is skipped.
 */
export async function pickOpportunity(
  page: Page,
  request: APIRequestContext,
  word: string,
): Promise<void> {
  const drafted = await draftedOpportunities(request);
  const res = await request.get(
    `/api/v1/salesforce/opportunities?q=${encodeURIComponent(word)}&mine=false&openOnly=true&limit=50`,
    { headers: asKam },
  );
  expect(res.ok(), await res.text()).toBe(true);
  const { items } = (await res.json()) as {
    items: { id: string; name: string; accountId: string | null; activeQuote: unknown }[];
  };
  const byWord = shuffled(items.filter((o) => !o.activeQuote && o.accountId && !drafted.has(o.id)));

  if (await pickFirstFree(page, byWord)) return;
  // Only when the word has nothing free left: any free opportunity (a few more requests).
  const anyFree = [];
  for (const id of await freeOpportunities(request, 5)) {
    const detail = await request.get(`/api/v1/salesforce/opportunities/${id}`, { headers: asKam });
    expect(detail.ok(), await detail.text()).toBe(true);
    const { opportunity } = (await detail.json()) as { opportunity: { name: string } };
    anyFree.push({ id, name: opportunity.name });
  }
  if (await pickFirstFree(page, anyFree)) return;
  throw new Error(`no free Salesforce opportunity for the intake picker (searched "${word}")`);
}

/**
 * In the intake picker (on /intake/new), picks the first of `candidates` that is still free and starts
 * its intake (step 2): each is found by its exact name and picked by its id, and one a parallel spec
 * quoted a moment ago (no "Use" button any more) is skipped. Returns the picked id, or null.
 */
export async function pickFirstFree(
  page: Page,
  candidates: readonly { id: string; name: string }[],
): Promise<string | null> {
  await page.getByRole('button', { name: 'All', exact: true }).click();
  for (const { id, name } of candidates) {
    await page.getByLabel('Find the Salesforce opportunity').fill(name);
    const card = page.locator(`[data-testid="opportunity-card"][data-opportunity-id="${id}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    const use = card.getByRole('button', { name: /^Use / });
    if (!(await use.isVisible())) continue;
    await use.click();
    await expect(page.getByTestId('intake-wizard')).toHaveAttribute('data-step', '2');
    return id;
  }
  return null;
}

/** Creates and submits an intake as the KAM; returns the quote number (waiting for G1). */
export async function submitQuote(
  request: APIRequestContext,
  candidates: string[],
  over: Record<string, unknown> = {},
  /** The persona who submits (and so becomes the quote's KAM): `kam` unless a spec needs another. */
  persona = 'kam',
): Promise<string> {
  const asSubmitter = { [DEV_USER_HEADER]: persona };
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
      headers: asSubmitter,
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
          subMarket: 'FOOD_SNACKS', // FB-15 (W13-02): required
          resin: 'HDPE',
          // FB-02 (F-010, F-055, F-023, F-016): the product facts and the minimum spec (no drawing file).
          neckDiameter: '28',
          neckFinishType: '410',
          pcrLevel: '0',
          colorType: 'NATURAL',
          heightMm: 180,
          widthOrDiameterMm: 65,
          depthMm: 65,
          gramWeightG: 24,
          packagingType: 'BULK',
          estAnnualVolume: 750_000,
          estAnnualRevenue: 150_000,
          // FB-02 (F-009): the need-by dates replace the close date (after today; product on or after).
          quoteNeededBy: isoDaysFromNow(30),
          productNeededBy: isoDaysFromNow(120),
          drawingStatus: 'HAVE_DRAWING',
          // An opportunity handed out although it has a quote: the KAM's "separate quote" confirmation.
          ...(sharedOpportunities.has(id) ? { separateQuoteConfirmed: true } : {}),
          ...over,
        },
      },
    });
    expect(draft.status(), await draft.text()).toBe(201);
    const { id: draftId } = (await draft.json()) as { id: string };
    const submit = await request.post(`/api/v1/quotes/drafts/${draftId}/submit`, {
      headers: asSubmitter,
    });
    if (submit.status() === 409) continue; // someone else took this opportunity
    expect(submit.status(), await submit.text()).toBe(201);
    return ((await submit.json()) as { quoteNumber: string }).quoteNumber;
  }
  throw new Error('no free Salesforce opportunity for the e2e spec');
}
