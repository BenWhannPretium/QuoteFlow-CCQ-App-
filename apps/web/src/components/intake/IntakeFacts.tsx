import type { QuoteIntakeFacts } from '@ccq/contracts';
import { neckSummary } from '@ccq/domain';

import type { KeyValueItem } from '@/components/KeyValueGrid';

import { commercialFactItems } from './CommercialInputs';
import { factLabel, type Lists } from './factLabel';

export { factLabel };

/** FB-02 (F-010): "28 mm / 410 / Tamper Evident". */
export function neckText(lists: Lists, f: QuoteIntakeFacts): string | null {
  return (
    neckSummary({
      diameter: factLabel(lists, 'neck_diameter', f.neckDiameter, f.neckDiameterCustom),
      finish: factLabel(lists, 'neck_finish_type', f.neckFinishType, f.neckFinishTypeCustom),
      feature: factLabel(
        lists,
        'neck_special_feature',
        f.neckSpecialFeature,
        f.neckSpecialFeatureCustom,
      ),
    }) || null
  );
}

/**
 * FB-02: the intake's product facts as label/value rows, for every role that reads the quote
 * (Engineering and Pricing included, T-013). `legacyNeck` is the pre-FB-02 single neck finish.
 */
export function intakeFactItems(
  lists: Lists,
  f: QuoteIntakeFacts,
  legacyNeck?: string | null,
  standardPaymentTerms: readonly string[] = [],
): KeyValueItem[] {
  const items: KeyValueItem[] = [
    {
      id: 'neck',
      label: 'Neck',
      value:
        neckText(lists, f) ?? (legacyNeck ? factLabel(lists, 'neck_finish', legacyNeck) : null),
    },
    {
      id: 'resin-grade',
      label: 'Customer-specified resin',
      // FB-09: the grade is also kept when the resin is "Other" (the customer-specified resin / grade).
      value:
        f.resinCustomerSpecified || f.resinGrade ? (
          <span data-testid="fact-resin-grade">{f.resinGrade ?? 'Yes'}</span>
        ) : (
          'No'
        ),
    },
    {
      id: 'pcr',
      label: 'PCR %',
      value: factLabel(lists, 'pcr_level', f.pcrLevel, f.pcrLevelOther),
    },
    {
      id: 'color',
      label: 'Color',
      value: factLabel(lists, 'color_type', f.colorType, f.colorDescription),
    },
    {
      id: 'additives',
      label: 'Additives',
      // FB-09: the pick, plus the note (the customer-specified additive when the pick is Other).
      value:
        [
          ...new Set(
            [factLabel(lists, 'additive', f.additive, f.additives), f.additives].filter(Boolean),
          ),
        ].join(' · ') || null,
    },
  ];
  if (f.linerSpec) items.push({ id: 'liner', label: 'Liner spec', value: f.linerSpec });
  if (f.labelsPurchasedBy) {
    items.push({
      id: 'labels',
      label: 'Labels purchased by',
      value: factLabel(lists, 'labels_purchased_by', f.labelsPurchasedBy),
    });
  }
  if (f.decorationType) {
    items.push({
      id: 'decoration',
      label: 'Decoration',
      value: [
        factLabel(lists, 'decoration_type', f.decorationType),
        f.decorationPrintColors != null
          ? `${f.decorationPrintColors} color${f.decorationPrintColors === 1 ? '' : 's'}`
          : null,
      ]
        .filter(Boolean)
        .join(', '),
    });
  }
  const dims = [
    f.heightMm != null ? `H ${f.heightMm} mm` : null,
    f.widthOrDiameterMm != null ? `W/Ø ${f.widthOrDiameterMm} mm` : null,
    f.depthMm != null ? `D ${f.depthMm} mm` : null,
    f.gramWeightG != null ? `${f.gramWeightG} g` : null,
  ].filter(Boolean);
  items.push(
    { id: 'dimensions', label: 'Dimensions', value: dims.join(' · ') || null },
    {
      id: 'mold',
      label: 'Modify an existing mold',
      value: f.modifyExistingMold ? (
        <span data-testid="fact-mold">
          {[f.existingMoldRef, f.moldChangeDescription].filter(Boolean).join(': ') || 'Yes'}
        </span>
      ) : (
        'No'
      ),
    },
    {
      id: 'rfp',
      label: 'Customer RFP / portal',
      value: f.rfpLink ? (
        <a
          href={f.rfpLink}
          target="_blank"
          rel="noopener noreferrer"
          className="text-emphasis break-all underline underline-offset-4"
          data-testid="fact-rfp-link"
        >
          {f.rfpLink}
        </a>
      ) : null,
    },
    { id: 'quote-needed-by', label: 'Quote needed by', value: f.quoteNeededBy },
    { id: 'product-needed-by', label: 'Product needed by', value: f.productNeededBy },
    {
      id: 'variants',
      label: 'Quote variants requested',
      value: f.quoteVariantsNote ? (
        <span className="whitespace-pre-line" data-testid="fact-variants">
          {f.quoteVariantsNote}
        </span>
      ) : null,
    },
    // FB-11 (D-032, F-085): payment terms, customer funding, dunnage, delivery and freight, bid reference.
    ...commercialFactItems(lists, f, standardPaymentTerms),
  );
  return items;
}

/** FB-02 (F-015, T-012): the "Mold modification" chip on queues and headers. */
export function MoldModificationChip({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      data-testid="mold-modification-chip"
      className="rounded-pill bg-secondary text-secondary-foreground inline-flex w-fit items-center px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
    >
      Mold modification
    </span>
  );
}

/**
 * FB-02: what Engineering needs first from intake, above the review: the ship / fill destination
 * (F-017, D-012) and a mold modification (F-015). The product facts (resin, neck, PCR, colour, additives,
 * variants) are in the Engineering review's product-facts header, built by the server (F-023).
 */
export function IntakeFactsHeader({
  facts,
  shipTo,
}: {
  facts: QuoteIntakeFacts;
  shipTo: { city?: string | null | undefined; state?: string | null | undefined } | null;
}) {
  const destination = [shipTo?.city, shipTo?.state].filter(Boolean).join(', ');
  return (
    <section
      aria-label="From intake"
      data-testid="intake-facts-header"
      className="bg-card rounded-card grid gap-2 border p-4 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Ship / fill destination:</span>
        <span className="font-semibold" data-testid="header-destination">
          {destination || '–'}
        </span>
        <MoldModificationChip show={facts.modifyExistingMold} />
        {facts.bidReference && (
          <>
            <span className="text-muted-foreground">Bid / program:</span>
            <span className="font-semibold" data-testid="header-bid-reference">
              {facts.bidReference}
            </span>
          </>
        )}
      </div>
      {facts.modifyExistingMold && (
        <p>
          <span className="text-muted-foreground">Mold change: </span>
          {[facts.existingMoldRef, facts.moldChangeDescription].filter(Boolean).join(': ')}
        </p>
      )}
    </section>
  );
}
