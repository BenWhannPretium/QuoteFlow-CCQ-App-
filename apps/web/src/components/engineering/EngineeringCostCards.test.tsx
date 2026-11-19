import type { EngineeringDetail } from '@ccq/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CostEstimateSummary, CostTotalsGrid } from './EngineeringCostCards';

/**
 * FB-23 (N18-03, N18-06, D5): the Final Review summary (lead time and totals per item) and the totals grid.
 * Rendered to static markup; the Engineering and Quoting cards are covered by `e2e/fb23.spec.ts`.
 */
const totals = {
  projectTotalUsd: 271_000,
  customerFundedUsd: 259_000,
  netCostUsd: 12_000,
  customerToolingPriceUsd: 297_850,
  markupPct: 15,
  markupNoted: true,
};
const review = (over: Partial<EngineeringDetail['review']>) =>
  ({ moldLeadTime: null, costTotals: null, ...over }) as EngineeringDetail['review'];
const eng = (items: { name: string; review: EngineeringDetail['review'] }[]) =>
  ({
    review: items[0]?.review ?? review({}),
    items: items.map((i, n) => ({ id: `item-${n + 1}`, ...i })),
  }) as unknown as EngineeringDetail;

describe('CostEstimateSummary (Final Review)', () => {
  it('shows each item’s lead time and totals, naming the items on a multi-item quote', () => {
    const html = renderToStaticMarkup(
      <CostEstimateSummary
        engineering={eng([
          {
            name: 'Item 1 (16 oz bottle)',
            review: review({ moldLeadTime: '16-18 weeks', costTotals: totals }),
          },
          { name: 'Item 2 (24 oz bottle)', review: review({ moldLeadTime: '12 weeks' }) },
        ])}
      />,
    );
    expect(html).toContain('Item 1 (16 oz bottle)');
    expect(html).toContain('16-18 weeks');
    expect(html).toContain('$259,000.00');
    expect(html).toContain('$12,000.00');
    expect(html).toContain('$271,000.00');
    expect(html).toContain('$297,850.00 (+ 15 % markup)');
    expect(html).toContain('12 weeks');
  });

  it('shows nothing when no item has a lead time or a cost line', () => {
    expect(
      renderToStaticMarkup(
        <CostEstimateSummary engineering={eng([{ name: 'Item 1', review: review({}) }])} />,
      ),
    ).toBe('');
  });
});

describe('CostTotalsGrid', () => {
  it('no markup noted: the price is customer funded, with no markup words (D5)', () => {
    const html = renderToStaticMarkup(
      <CostTotalsGrid
        totals={{ ...totals, markupPct: 0, markupNoted: false, customerToolingPriceUsd: 259_000 }}
      />,
    );
    expect(html).not.toContain('markup');
    expect(html.match(/\$259,000\.00/g)).toHaveLength(2);
  });
});
