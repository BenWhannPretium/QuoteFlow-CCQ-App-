import type { DbOrTx } from '@ccq/db';
import { listValueList } from '@ccq/db/repos';
import { marketPath } from '@ccq/domain';

/**
 * FB-12: "Market › Sub-market" for a quote, from the value lists, retired entries included. A code that is
 * no longer offered keeps its label with "(no longer offered)" (as FB-03 does for the EBM wheel); a code
 * that is not on the list at all shows as stored. Null when the quote has neither.
 */
export async function marketPathLabel(
  db: DbOrTx,
  market: string | null,
  subMarket: string | null,
): Promise<string | null> {
  if (!market && !subMarket) return null;
  const label = async (list: 'market' | 'sub_market', code: string | null) => {
    if (!code) return null;
    const entry = (await listValueList(db, list, { activeOnly: false })).find(
      (v) => v.code === code,
    );
    if (!entry) return code;
    return entry.active ? entry.label : `${entry.label} (no longer offered)`;
  };
  return marketPath(await label('market', market), await label('sub_market', subMarket));
}
