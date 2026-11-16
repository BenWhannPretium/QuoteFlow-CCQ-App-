import type { QuoteItemSummary } from '@ccq/contracts';
import type { DbOrTx } from '@ccq/db';
import { listEngReviews, listQuoteItems, listValueList, type Quote } from '@ccq/db/repos';
import { canSeeCommercialFields, itemName, type Actor } from '@ccq/domain';

/**
 * FB-19 (W13-32): the quote's items as Quoting, Final Review, the hand-off and the quote page list them:
 * each item's key product facts, its volume and need-by, and the plant and machine Engineering chose for
 * it. A one-item quote is its item (the quote mirrors item 1), so its facts are read from the quote as
 * they always were. A quote with no item row yet (written before FB-19 by a path that made none) is
 * listed as one item from its own columns.
 */
export async function quoteItemSummaries(
  db: DbOrTx,
  actor: Actor,
  q: Quote,
): Promise<QuoteItemSummary[]> {
  const [items, reviews, families, resins, plants, machines] = await Promise.all([
    listQuoteItems(db, q.id),
    listEngReviews(db, q.id),
    listValueList(db, 'product_family', { activeOnly: false }),
    listValueList(db, 'resin', { activeOnly: false }),
    listValueList(db, 'plant', { activeOnly: false }),
    listValueList(db, 'machine_type', { activeOnly: false }),
  ]);
  const label = (list: { code: string; label: string }[], code: string | null | undefined) =>
    code ? (list.find((v) => v.code === code)?.label ?? code) : null;
  const commercial = canSeeCommercialFields(actor);
  const structured = (q.structuredDescription ?? {}) as { size?: string; standard?: string };
  const single = items.length <= 1;
  const rows = items.length > 0 ? items : [null];
  return rows.map((item, index) => {
    const review = item ? reviews.find((r) => r.quoteItemId === item.id) : reviews[0];
    const productFamily = single ? q.productFamily : item!.productFamily;
    const resin = single ? q.resin : item!.resin;
    const itemNo = item?.itemNo ?? index + 1;
    return {
      id: item?.id ?? null,
      itemNo,
      label: item?.label ?? null,
      name: itemName(itemNo, item?.label),
      productFamily,
      productFamilyLabel: label(families, productFamily),
      resin,
      resinLabel: label(resins, resin),
      containerSize: single
        ? (structured.size ?? item?.containerSize ?? null)
        : item!.containerSize,
      standardDescription: single
        ? (structured.standard ?? item?.standardDescription ?? null)
        : item!.standardDescription,
      estAnnualVolume: single ? q.estAnnualVolume : item!.estAnnualVolume,
      productNeededBy: single ? q.productNeededBy : item!.productNeededBy,
      plantCode: review?.plantCode ?? null,
      plantLabel: label(plants, review?.plantCode),
      machineType: review?.machineType ?? null,
      machineTypeLabel: label(machines, review?.machineType),
      cavitation: review?.cavitation ?? null,
      ...(commercial ? { prelimCapitalUsd: review?.prelimCapitalUsd ?? null } : {}),
    };
  });
}
