import type { QuoteItemSummary } from '@ccq/contracts';

import { calendarDate } from '@/lib/time';

/**
 * FB-19 (W13-32): "16 oz bottle + 2 more" beside a quote in a list. Nothing for a one-item quote (its
 * product is already in the row), so single-item lists read as they always did.
 */
export function ItemsBadge({
  itemCount,
  itemsSummary,
}: {
  itemCount?: number | undefined;
  itemsSummary?: string | null | undefined;
}) {
  if (!itemCount || itemCount <= 1) return null;
  return (
    <span
      className="bg-secondary text-secondary-foreground rounded-pill px-2 py-0.5 text-xs font-medium whitespace-nowrap"
      data-testid="items-summary"
      title={`${itemCount} items quoted together`}
    >
      {itemsSummary ?? `${itemCount} items`}
    </span>
  );
}

const volume = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('en-US')} / yr`);

/**
 * FB-19 (W13-32): every item of a quote with its key facts, the plant and machine Engineering chose,
 * its volume and need-by. Used on the quote page, the Quoting tab, Final Review and the hand-off.
 */
export function QuoteItemsList({
  items,
  title = 'Items',
  note,
  testId = 'quote-items',
}: {
  items: readonly QuoteItemSummary[];
  title?: string;
  note?: string;
  testId?: string;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="grid gap-2" data-testid={testId}>
      <h3 className="text-sm font-semibold">
        {title} <span className="text-muted-foreground font-normal">({items.length})</span>
      </h3>
      {note && <p className="text-muted-foreground text-xs">{note}</p>}
      <ol className="grid gap-2">
        {items.map((item) => (
          <li
            key={item.id ?? item.itemNo}
            className="grid gap-1 rounded-md border p-3 text-sm"
            data-testid="quote-item"
          >
            <p className="font-medium break-words">{item.name}</p>
            <dl className="text-muted-foreground grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {[
                [
                  'Product',
                  [item.productFamilyLabel, item.containerSize].filter(Boolean).join(' · '),
                ],
                ['Resin', item.resinLabel],
                ['Volume', volume(item.estAnnualVolume)],
                [
                  'Needed by',
                  item.productNeededBy ? calendarDate(item.productNeededBy, '—') : null,
                ],
                ['Plant', item.plantLabel],
                ['Machine', item.machineTypeLabel],
              ].map(([k, v]) => (
                <div key={k} className="flex min-w-0 gap-1">
                  <dt>{k}:</dt>
                  <dd className="text-foreground min-w-0 break-words">{v || '—'}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>
    </section>
  );
}
