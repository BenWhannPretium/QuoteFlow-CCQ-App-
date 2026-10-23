import { SfOpportunity } from '@ccq/contracts';
import { describe, expect, it } from 'vitest';

import { JsforceSalesforceReader, sfApiFactory } from './jsforce';
import { LOGIN_URLS } from './jwt';

/**
 * Live contract test against a Salesforce org. Read-only (SOQL, describe). Skipped unless
 * `SF_LIVE_TEST=1`, with the External Client App credentials in the environment. JWT bearer:
 *
 *   SF_LIVE_TEST=1 SF_CLIENT_ID=… SF_USERNAME=integration@pretiumpkg.com.uat \
 *   SF_PRIVATE_KEY="$(cat sf-uat.key)" pnpm --filter @ccq/integrations test
 *
 * Client credentials (the production setup):
 *
 *   SF_LIVE_TEST=1 SF_AUTH_FLOW=client_credentials SF_CLIENT_ID=… SF_CLIENT_SECRET=… \
 *   SF_LOGIN_URL=https://pretiumpkg.my.salesforce.com pnpm --filter @ccq/integrations test
 *
 * It asserts every field in fieldMap.ts resolves in the org: run it after the M3 crosswalk changes.
 * It prints counts and field names only, never record contents.
 */
const live = process.env.SF_LIVE_TEST === '1';

describe.skipIf(!live)('Salesforce contract (SF_LIVE_TEST=1)', () => {
  const reader = () =>
    new JsforceSalesforceReader(
      sfApiFactory(
        process.env.SF_AUTH_FLOW === 'client_credentials'
          ? {
              flow: 'client_credentials',
              clientId: process.env.SF_CLIENT_ID ?? '',
              clientSecret: process.env.SF_CLIENT_SECRET ?? '',
              loginUrl: process.env.SF_LOGIN_URL ?? '',
            }
          : {
              clientId: process.env.SF_CLIENT_ID ?? '',
              username: process.env.SF_USERNAME ?? 'integration@pretiumpkg.com.uat',
              privateKey: process.env.SF_PRIVATE_KEY ?? '',
              loginUrl: process.env.SF_LOGIN_URL ?? LOGIN_URLS.uat,
            },
      ),
    );

  it('every mapped object and field resolves (fieldMap.ts)', async () => {
    expect(await reader().unresolvedFields()).toEqual([]);
  }, 60_000);

  it('search returns opportunities in the DTO shape', async () => {
    const results = await reader().searchOpportunities({ q: '', openOnly: true, limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    for (const o of results) SfOpportunity.parse(o);
  }, 60_000);

  it('the delta query pages and maps', async () => {
    const since = new Date(Date.now() - 7 * 86_400_000);
    let count = 0;
    for await (const page of reader().listChangedOpportunities(since)) count += page.length;
    expect(count).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
