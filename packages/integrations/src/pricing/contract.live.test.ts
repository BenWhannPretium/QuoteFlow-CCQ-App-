import { PricingBpr, PricingErf, PricingSpr } from '@ccq/contracts';
import { describe, expect, it } from 'vitest';

import { createPricingReader, type PricingReaderConfig } from './create';
import type { SqlPricingReader } from './sql';

/**
 * Live contract test against the pricing app (Route A) or its Fabric copy (Route B). Read-only
 * (SELECT and INFORMATION_SCHEMA). Skipped unless `PRICING_LIVE_TEST=1`:
 *
 *   PRICING_LIVE_TEST=1 PRICING_MODE=sqlserver PRICING_SQL_SERVER=… PRICING_SQL_DATABASE=… \
 *   PRICING_SQL_USER=ccq_reader PRICING_SQL_PASSWORD=… PRICING_LIVE_ERF=26367 \
 *   pnpm --filter @ccq/integrations test
 *
 * (Route B: PRICING_MODE=fabric, PRICING_SQL_SERVER=<endpoint>, PRICING_SQL_DATABASE=<lakehouse>,
 * signed in with `az login` or a managed identity.) It asserts every column in columnMap.ts resolves:
 * run it after the M5 column confirmations. It prints counts and column names only, never rows.
 */
const live = process.env.PRICING_LIVE_TEST === '1';

function config(): PricingReaderConfig {
  const env = process.env;
  const base = { server: env.PRICING_SQL_SERVER ?? '', database: env.PRICING_SQL_DATABASE ?? '' };
  return env.PRICING_MODE === 'fabric'
    ? { mode: 'fabric', ...base, managedIdentityClientId: env.PRICING_SQL_MI_CLIENT_ID }
    : {
        mode: 'sqlserver',
        ...base,
        port: env.PRICING_SQL_PORT ? Number(env.PRICING_SQL_PORT) : undefined,
        user: env.PRICING_SQL_USER ?? '',
        password: env.PRICING_SQL_PASSWORD ?? '',
      };
}

describe.skipIf(!live)('pricing app contract (PRICING_LIVE_TEST=1)', () => {
  const reader = () => createPricingReader(config()) as SqlPricingReader;

  it('every mapped view and column resolves (columnMap.ts)', async () => {
    const r = reader();
    try {
      expect(await r.unresolvedColumns()).toEqual([]);
    } finally {
      await r.close();
    }
  }, 60_000);

  it('a known ERF maps to the DTO, with its BPRs', async () => {
    const erfNumber = process.env.PRICING_LIVE_ERF;
    if (!erfNumber) return;
    const r = reader();
    try {
      const erf = await r.getErf(erfNumber);
      expect(erf).not.toBeNull();
      PricingErf.parse(erf);
      for (const b of await r.findBprsForErf(erfNumber)) PricingBpr.parse(b);
      if (erf?.customerName) {
        for (const s of await r.getSprHistory({ customerName: erf.customerName }))
          PricingSpr.parse(s);
      }
    } finally {
      await r.close();
    }
  }, 60_000);
});
