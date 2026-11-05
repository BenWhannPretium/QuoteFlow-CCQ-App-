import type { PublicConfigResponse, QuoteIntakeFacts } from '@ccq/contracts';
import { neckSummary } from '@ccq/domain';

import type { KeyValueItem } from '@/components/KeyValueGrid';

type Lists = PublicConfigResponse['valueLists'] | undefined;

const entry = (lists: Lists, list: string, code: string | null) =>
  code ? lists?.[list]?.find((v) => v.code === code) : undefined;

/** A code's label; a "Custom" (meta freeText) value shows its description instead. */
export function factLabel(
  lists: Lists,
  list: string,
  code: string | null,
  custom?: string | null,
): string | null {
  if (!code) return null;
  const e = entry(lists, list, code);
  if (e?.meta.freeText === true) return custom ?? e.label;
  return e?.label ?? code;
}

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
      value: f.resinCustomerSpecified ? (
        <span data-testid="fact-resin-grade">{f.resinGrade ?? 'Yes'}</span>
      ) : (
        'No'
      ),
    },
    { id: 'pcr', label: 'PCR %', value: factLabel(lists, 'pcr_level', f.pcrLevel) },
    {
      id: 'color',
      label: 'Color',
      value: factLabel(lists, 'color_type', f.colorType, f.colorDescription),
    },
    { id: 'additives', label: 'Additives', value: f.additives },
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
  items.push(
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
  );
  return items;
}
