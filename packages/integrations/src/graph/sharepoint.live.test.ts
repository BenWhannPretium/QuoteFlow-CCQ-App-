import { describe, it } from 'vitest';

import { GraphClient, createGraphCredential } from './client';
import { describeFileStoreContract } from './contract';
import { SharePointFileStore } from './sharepoint';

/**
 * Live contract run against the **test** SharePoint site (after M7). Writes small files under
 * `CCQ-live-test/<timestamp>/` and soft-deletes some into its `_removed` folder; clear that folder
 * afterwards. Skipped unless `SP_LIVE_TEST=1`:
 *
 *   SP_LIVE_TEST=1 SP_DRIVE_ID=… GRAPH_TENANT_ID=… GRAPH_CLIENT_ID=… GRAPH_CLIENT_SECRET=… \
 *   pnpm --filter @ccq/integrations test
 *
 * The client secret is for the test site only (Sites.Selected, write); production uses the App
 * Service managed identity. Nothing is printed but pass/fail.
 */
const live = process.env.SP_LIVE_TEST === '1';

if (live) {
  const env = process.env;
  const graph = new GraphClient({
    credential: createGraphCredential({
      kind: 'client-secret',
      tenantId: env.GRAPH_TENANT_ID ?? '',
      clientId: env.GRAPH_CLIENT_ID ?? '',
      clientSecret: env.GRAPH_CLIENT_SECRET ?? '',
    }),
  });
  const store = new SharePointFileStore(graph, { driveId: env.SP_DRIVE_ID ?? '' });
  describeFileStoreContract(
    'SharePointFileStore (live test site)',
    () =>
      Promise.resolve({
        store,
        readBack: async (id: string) => {
          const link = await store.getDownloadUrl(id, { fileName: 'x' });
          return Buffer.from(await (await fetch(link.url)).arrayBuffer());
        },
      }),
    // A well-formed driveItem id that doesn't exist.
    { root: `CCQ-live-test/${Date.now()}`, missingId: '01AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
  );
} else {
  describe.skip('SharePointFileStore (live test site): set SP_LIVE_TEST=1', () => {
    it('is skipped', () => undefined);
  });
}
