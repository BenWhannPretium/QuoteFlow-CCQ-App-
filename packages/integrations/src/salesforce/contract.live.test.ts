import { SfOpportunity } from '@ccq/contracts';
import { describe, expect, it } from 'vitest';

import { JsforceSalesforceReader, jwtApiFactory } from './jsforce';
import { LOGIN_URLS } from './jwt';

/**
 * Live contract test against the Salesforce UAT org. Read-only (SOQL, describe). Skipped unless
 * `SF_LIVE_TEST=1`, with the connected-app credentials in the environment:
 *
 *   SF_LIVE_TEST=1 SF_CLIENT_ID=… SF_USERNAME=integration@pretiumpkg.com.uat \
 *   SF_PRIVATE_KEY="$(cat sf-uat.key)" pnpm --filter @ccq/integrations test
 *
 * It asserts every field in fieldMap.ts resolves in the org: run it after the M3 crosswalk changes.
 * It prints counts and field names only, never record contents.
 */
const live = process.env.SF_LIVE_TEST === '1';

describe.skipIf(!live)('Salesforce UAT contract (SF_LIVE_TEST=1)', () => {
  const reader = () =>
    new JsforceSalesforceReader(
      jwtApiFactory({
        clientId: process.env.SF_CLIENT_ID ?? '',
        username: process.env.SF_USERNAME ?? 'integration@pretiumpkg.com.uat',
        privateKey: process.env.SF_PRIVATE_KEY ?? '',
        loginUrl: process.env.SF_LOGIN_URL ?? LOGIN_URLS.uat,
      }),
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
