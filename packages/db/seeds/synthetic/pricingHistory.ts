import { mapExportRow, syntheticPricingExport, type PricingHistoryRow } from '@ccq/integrations';

import type { DbOrTx } from '../../src/client';
import { upsertPricingHistory } from '../../src/repos/index';

/**
 * B-15 (revised): synthetic pricing-app history (ERF, BPR, SPR) through the same mapper as the real
 * import, so local dev and tests have history for the seeded customers. Idempotent (upsert by kind +
 * request id). Synthetic only; the real export is imported by an Admin in the app.
 */
export async function seedPricingHistory(db: DbOrTx): Promise<number> {
  const x = syntheticPricingExport();
  const rows: PricingHistoryRow[] = [];
  for (const kind of ['erf', 'bpr', 'spr'] as const) {
    for (const raw of x[kind]) {
      const { row } = mapExportRow(kind, raw);
      if (row) rows.push(row);
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    await upsertPricingHistory(db, rows.slice(i, i + 500));
  }
  return rows.length;
}
