import type { PublicConfigResponse, QuoteDetail, QuoteIntakeFacts } from '@ccq/contracts';
import { isNonStandardPaymentTerms } from '@ccq/domain';

import { usePublicConfig } from '@/config/public-config';

import { factLabel, type Lists } from './factLabel';
import { KeyValueGrid, type KeyValueItem } from '../KeyValueGrid';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

/** The copy shown for a non-standard request (FB-11, F-080, D-032). */
export const NON_STANDARD_TERMS_TEXT = 'Non-standard: Pricing will review';

/** The `standard_payment_terms` setting as a code list (empty while config loads). */
export const standardTermsFrom = (config: PublicConfigResponse | undefined): string[] => {
  const v = config?.settings.standard_payment_terms;
  return Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string') : [];
};

export function NonStandardTermsBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      data-testid="payment-terms-nonstandard"
      className="bg-warning text-warning-foreground rounded-pill ml-2 inline-flex items-center px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
    >
      {NON_STANDARD_TERMS_TEXT}
    </span>
  );
}

/**
 * FB-15 (W13-09, provisional): "Customer 40%, Pretium 60%" while funding is Shared (a funding code whose
 * list meta says `customerShare`) and a share was given; null otherwise. Pretium covers the rest.
 */
export function customerShareText(
  lists: Lists,
  fundingCode: string | null | undefined,
  pct: number | null | undefined,
): string | null {
  if (pct == null || !fundingCode) return null;
  const entry = lists?.tooling_funding_model?.find((v) => v.code === fundingCode);
  if (entry?.meta.customerShare !== true) return null;
  const rest = Math.round((100 - pct) * 10) / 10;
  return `Customer ${pct}%, Pretium ${rest}%`;
}

/** "Net 60", with an "Other" request shown as its description. */
export const requestedTermsText = (lists: Lists, f: QuoteIntakeFacts): string | null =>
  factLabel(
    lists,
    'requested_payment_terms',
    f.requestedPaymentTerms,
    f.requestedPaymentTermsOther,
  );

/**
 * FB-11 (D-032): the commercial inputs the KAM gave at intake as label/value rows, for every role that
 * reads the quote (rule 2). The payment terms carry the non-standard flag, judged from the
 * `standard_payment_terms` setting.
 */
export function commercialFactItems(
  lists: Lists,
  f: QuoteIntakeFacts,
  standardPaymentTerms: readonly string[],
): KeyValueItem[] {
  const terms = requestedTermsText(lists, f);
  const nonStandard = isNonStandardPaymentTerms(f.requestedPaymentTerms, standardPaymentTerms);
  const delivered = f.priceBasis
    ? lists?.price_basis?.find((v) => v.code === f.priceBasis)?.meta.delivered === true
    : false;
  return [
    {
      id: 'bid-reference',
      label: 'Customer bid / RFP reference',
      value: f.bidReference ? <span data-testid="fact-bid-reference">{f.bidReference}</span> : null,
    },
    {
      id: 'requested-payment-terms',
      label: 'Payment terms requested',
      value: terms ? (
        <span data-testid="fact-payment-terms">
          {terms}
          <NonStandardTermsBadge show={nonStandard} />
        </span>
      ) : null,
    },
    {
      id: 'customer-funding',
      label: 'Customer funds any tooling',
      value: f.toolingFundingModel ? (
        <span data-testid="fact-funding">
          {factLabel(lists, 'tooling_funding_model', f.toolingFundingModel)}
        </span>
      ) : null,
    },
    {
      id: 'customer-share',
      label: 'Customer share',
      value: customerShareText(lists, f.toolingFundingModel, f.customerSharePct) ? (
        <span data-testid="fact-customer-share">
          {customerShareText(lists, f.toolingFundingModel, f.customerSharePct)}
        </span>
      ) : null,
    },
    {
      id: 'dunnage',
      label: 'Dunnage',
      value: (
        <span data-testid="fact-dunnage">
          {f.returnableDunnage ? 'Returnable (multi-trip)' : 'Single-trip'}
        </span>
      ),
    },
    {
      id: 'price-basis',
      label: 'Delivered or FOB',
      value: f.priceBasis ? (
        <span data-testid="fact-price-basis">{factLabel(lists, 'price_basis', f.priceBasis)}</span>
      ) : null,
    },
    ...(delivered
      ? [
          {
            id: 'freight-type',
            label: 'Freight type',
            value: f.freightType ? (
              <span data-testid="fact-freight-type">
                {factLabel(lists, 'freight_type', f.freightType)}
              </span>
            ) : null,
          },
          {
            id: 'freight-special',
            label: 'Special freight arrangements',
            value: f.freightSpecialArrangements ? (
              <span className="whitespace-pre-line" data-testid="fact-freight-special">
                {f.freightSpecialArrangements}
              </span>
            ) : null,
          },
        ]
      : []),
  ];
}

/** The Quoting tab's "From intake" card: what the KAM told Pricing before costing starts. */
export function IntakeCommercialCard({ quote }: { quote: QuoteDetail }) {
  const { data: config } = usePublicConfig();
  return (
    <Card data-testid="quoting-from-intake">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">From intake</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <KeyValueGrid
          items={commercialFactItems(
            config?.valueLists,
            quote.intakeFacts,
            standardTermsFrom(config),
          )}
        />
        <p className="text-muted-foreground text-xs">
          Payment terms are for awareness and negotiation; they do not change the costing.
        </p>
      </CardContent>
    </Card>
  );
}

/** The Commercial panel's read-only "Customer requested" line (the editable terms record is FB-08's). */
export function CustomerRequested({ quote }: { quote: QuoteDetail }) {
  const { data: config } = usePublicConfig();
  const f = quote.intakeFacts;
  const terms = requestedTermsText(config?.valueLists, f);
  return (
    <p className="text-sm" data-testid="customer-requested-terms">
      <span className="font-medium">Customer requested:</span> {terms ?? 'Not given at intake'}
      <NonStandardTermsBadge
        show={isNonStandardPaymentTerms(f.requestedPaymentTerms, standardTermsFrom(config))}
      />
    </p>
  );
}
