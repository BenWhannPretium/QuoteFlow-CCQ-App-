import { BUDGETARY_CAPITAL_LABEL, type QuoteDetail, type QuotingStepStatus } from '@ccq/contracts';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { useCapitalTermItems } from '@/components/commercial/CapitalTerms';
import { standardTermsFrom, NonStandardTermsBadge } from '@/components/intake/CommercialInputs';
import { intakeFactItems } from '@/components/intake/IntakeFacts';
import { KeyValueGrid, type KeyValueItem } from '@/components/KeyValueGrid';
import { FieldOverride } from '@/components/Overrides';
import { CapitalChip } from '@/components/pricing/CapitalChip';
import { QuoteItemsList } from '@/components/QuoteItems';
import { SalesforceLink } from '@/components/SalesforceLink';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { stageLabel, usePublicConfig, useValueList } from '@/config/public-config';
import { absoluteTime } from '@/lib/time';
import { marketText, valueListLabel } from '@/lib/value-label';

/**
 * FB-25 (N18-18; Ben Whann, Bailey Schmitt, 2026-11-18): the Overview is a read-only summary of
 * everything filled in so far. "At a glance": the intake, Engineering per item, Pricing and the
 * commercial terms. Rows with no value are left out, and nothing here is an input: the work is done on
 * the Engineering, Quoting and Commercial terms tabs.
 */

/** The rows that have a value (FB-25: an empty row is left out, not shown as a dash). */
export function withValues(items: KeyValueItem[]): KeyValueItem[] {
  return items.filter((i) => i.value !== null && i.value !== undefined && i.value !== '');
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? null : `$${n.toLocaleString('en-US')}`;
const yesNo = (v: boolean | null) => (v === null ? null : v ? 'Yes' : 'No');

function GlanceCard({
  title,
  testId,
  aside,
  children,
}: {
  title: string;
  testId: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold">{title}</h3>
          {aside}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

const Nothing = ({ children }: { children: ReactNode }) => (
  <p className="text-muted-foreground text-sm">{children}</p>
);

/**
 * What the KAM entered at intake, read-only. Used on the Overview and, expanded, on a To qualify card
 * (FB-25, N18-17). `readOnly` leaves out the ship-to override button (the queue card has no actions).
 */
export function IntakeSummary({
  quote,
  readOnly = false,
}: {
  quote: QuoteDetail;
  readOnly?: boolean;
}) {
  const { data: config } = usePublicConfig();
  const label = (list: string, code: string | null) => valueListLabel(config, list, code);
  const ship = quote.shipTo;
  const shipText = ship
    ? [ship.line1, ship.city, ship.state, ship.postal].filter(Boolean).join(', ')
    : '';
  return (
    <div className="grid gap-4">
      <KeyValueGrid
        items={withValues([
          { label: 'Customer', value: quote.customerName },
          {
            label: 'Customer status',
            value:
              quote.customerStatus === 'not_yet_established'
                ? 'Not yet a Pretium customer (no ERP account)'
                : 'Pretium customer',
          },
          { label: 'Opportunity', value: quote.opportunityName },
          // B-23: testers tie quotes out against Salesforce (U5) by this id.
          // FB-18 (W13-31): the id is the link once the Salesforce URL is set (the header says how).
          {
            label: 'SF opportunity ID',
            value: (
              <SalesforceLink
                quote={quote}
                hint={false}
                label={
                  <span className="font-mono" data-testid="sf-opportunity-id">
                    {quote.sfOpportunityId}
                  </span>
                }
              />
            ),
          },
          { label: 'KAM', value: quote.kamName },
          { label: 'Request class', value: label('request_class', quote.requestClass) },
          // FB-12 (F-073): the market and the sub-market that sets the strategic-fit score.
          { label: 'Market', value: marketText(config, quote.market, quote.subMarket) },
          { label: 'Product family', value: label('product_family', quote.productFamily) },
          { label: 'Resin', value: label('resin', quote.resin) },
          {
            label: 'Components',
            value: quote.components.map((c) => label('component', c)).join(', '),
          },
          // FB-02: the product facts (neck, resin grade, PCR, color, follow-ups, need-by dates…).
          ...intakeFactItems(
            config?.valueLists,
            quote.intakeFacts,
            quote.neckFinish,
            standardTermsFrom(config),
          ),
          { label: 'Annual volume', value: quote.estAnnualVolume?.toLocaleString('en-US') },
          { label: 'Annual revenue', value: money(quote.estAnnualRevenue) },
          // FB-02 (T-009): Salesforce's close date (latest sync), and the KAM's need-by dates.
          { label: 'Salesforce close date', value: quote.expectedCloseDate },
          { label: 'Drawing', value: label('drawing_status', quote.drawingStatus) },
          { label: 'Packaging', value: label('packaging_type', quote.packagingType) },
          shipText || !readOnly
            ? {
                id: 'ship-to',
                label: 'Ship / fill destination',
                value: (
                  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span data-testid="ship-to-value">{shipText || '–'}</span>
                    {!readOnly && <FieldOverride quote={quote} field="ship_to" />}
                  </span>
                ),
              }
            : { id: 'ship-to', label: 'Ship / fill destination', value: null },
          {
            id: 'desc',
            label: 'Description',
            value: quote.standardDescription ?? quote.description,
          },
          { label: 'Comments for Engineering', value: quote.commentsForEngineering },
          {
            label: 'Submitted',
            value: quote.submittedAt ? absoluteTime(quote.submittedAt) : 'Not submitted',
          },
          { label: 'Stage', value: stageLabel(config, quote.stageKey) },
          // The proposal dates and validity countdown are in the Customer decision header (B-13).
        ])}
      />
      {/* FB-19 (W13-32): every item, quoted together. */}
      {quote.items.length > 1 && <QuoteItemsList items={quote.items} />}
    </div>
  );
}

/** The intake as an Overview card. */
export function IntakeCard({ quote }: { quote: QuoteDetail }) {
  return (
    <GlanceCard title="Intake" testId="glance-intake">
      <IntakeSummary quote={quote} />
    </GlanceCard>
  );
}

/**
 * Engineering, per item: plant, process and machine, cavitation, cycle time, the budgetary capital, the
 * engineer's notes and the capacity notes, and who decided feasibility (G2). Faron (N17-18) could not
 * find these on a closed quote.
 */
export function EngineeringGlance({ quote }: { quote: QuoteDetail }) {
  const e = quote.engineering;
  const g2 = quote.quoting.g2;
  const items =
    e.items.length > 0
      ? e.items
      : [
          {
            id: 'quote',
            name: '',
            review: e.review,
            capacityEvidence: e.capacityEvidence,
            selectedLabels: e.selectedLabels,
          },
        ];
  const multi = items.length > 1;
  const rowsFor = (item: (typeof items)[number]): KeyValueItem[] => {
    const r = item.review;
    const capacityNotes = item.capacityEvidence
      .map((row) => row.notes?.trim())
      .filter(Boolean)
      .join(' · ');
    return withValues([
      { id: 'plant', label: 'Plant', value: item.selectedLabels.plantCode ?? r.plantCode },
      {
        id: 'process',
        label: 'Process and machine',
        value: [
          item.selectedLabels.processType ?? r.processType,
          item.selectedLabels.machineType ?? r.machineType,
        ]
          .filter(Boolean)
          .join(' · '),
      },
      { id: 'cavitation', label: 'Cavitation', value: r.cavitation },
      {
        id: 'cycle',
        label: 'Cycle time',
        value: r.cycleTimeS != null ? `${r.cycleTimeS} s` : null,
      },
      { id: 'capital', label: BUDGETARY_CAPITAL_LABEL, value: money(r.prelimCapitalUsd) },
      { id: 'tooling-notes', label: 'Engineer’s notes (tooling)', value: r.toolingNotes },
      // Kept for older quotes (FB-22 stops collecting it).
      { id: 'concept', label: 'Technical concept', value: r.technicalConceptNotes },
      { id: 'capacity-notes', label: 'Capacity notes', value: capacityNotes },
    ]);
  };
  const g2Text = g2
    ? `${g2.outcomeLabel}${g2.decidedByName ? ` · ${g2.decidedByName}` : ''} · ${absoluteTime(g2.decidedAt)}`
    : null;
  const anything = items.some((i) => rowsFor(i).length > 0) || g2 || e.assignedEngineerName;
  return (
    <GlanceCard title="Engineering" testId="glance-engineering">
      {!anything ? (
        <Nothing>Engineering has not recorded anything yet.</Nothing>
      ) : (
        <>
          <KeyValueGrid
            items={withValues([
              { id: 'engineer', label: 'Engineer', value: e.assignedEngineerName },
              { id: 'scheduler', label: 'Production scheduler', value: e.assignedSchedulerName },
              { id: 'g2', label: 'Feasibility decided', value: g2Text },
            ])}
          />
          {g2?.note && <p className="text-foreground-2 text-sm whitespace-pre-line">{g2.note}</p>}
          {items.map((item) => {
            const rows = rowsFor(item);
            if (rows.length === 0) return null;
            return (
              <section
                key={item.id}
                aria-label={multi ? item.name : 'Solution'}
                className="grid gap-2"
                data-testid="glance-engineering-item"
              >
                {multi && <h4 className="text-sm font-semibold">{item.name}</h4>}
                <KeyValueGrid items={rows} />
              </section>
            );
          })}
        </>
      )}
    </GlanceCard>
  );
}

const STEP_TEXT: Record<QuotingStepStatus, string> = {
  done: 'Done',
  waiting: 'In progress',
  blocked: 'Not started',
  not_requested: 'Not requested',
};

/** Pricing: costing, payback and price approval, and capital readiness. */
export function PricingGlance({ quote }: { quote: QuoteDetail }) {
  const qd = quote.quoting;
  const steps = qd.steps;
  const record = qd.pricingRecord;
  const started =
    qd.inQuoting ||
    qd.approval.approved ||
    !!record ||
    !!qd.assignedPricerName ||
    steps.costing.status !== 'blocked';
  return (
    <GlanceCard title="Pricing" testId="glance-pricing">
      {!started ? (
        <Nothing>Pricing has not started yet.</Nothing>
      ) : (
        <KeyValueGrid
          items={withValues([
            { id: 'pricer', label: 'Pricer', value: qd.assignedPricerName },
            {
              id: 'costing',
              label: 'Costing',
              value: steps.costing.attested
                ? `Done${steps.costing.attestedByName ? `, ${steps.costing.attestedByName}` : ''}`
                : STEP_TEXT[steps.costing.status],
            },
            { id: 'payback', label: 'Payback model', value: STEP_TEXT[steps.roi.status] },
            {
              id: 'price',
              label: 'Price approval',
              value: qd.approval.approved
                ? `Approved${qd.approval.approvedByName ? ` by ${qd.approval.approvedByName}` : ''}${qd.approval.approvedAt ? `, ${absoluteTime(qd.approval.approvedAt)}` : ''}`
                : STEP_TEXT[steps.price.status],
            },
            {
              id: 'capital',
              label: 'Capital readiness',
              value: record?.capitalReadiness ? (
                <CapitalChip value={record.capitalReadiness} />
              ) : null,
            },
          ])}
        />
      )}
    </GlanceCard>
  );
}

/**
 * The agreed commercial terms, read-only, with "Edit on the Commercial terms tab" for those who may
 * change them (the server decides; this only offers the way there).
 */
export function TermsGlance({ quote }: { quote: QuoteDetail }) {
  const t = quote.commercial.terms;
  const legal = quote.commercial.legal;
  const paymentTerms = useValueList('requested_payment_terms');
  const toolingPayments = useValueList('tooling_payment_terms');
  const capital = useCapitalTermItems(t.capital);
  const label = (list: { code: string; label: string }[], code: string | null) =>
    code ? (list.find((m) => m.code === code)?.label ?? code) : null;
  const payment = t.termsPaymentTermsCode
    ? paymentTerms.find((p) => p.code === t.termsPaymentTermsCode)?.meta.freeText === true
      ? t.termsPaymentTerms
      : label(paymentTerms, t.termsPaymentTermsCode)
    : t.termsPaymentTerms;
  const canEdit = t.canEdit || t.canEditEngineering || t.capital.canFinalize;
  const rows = withValues([
    {
      id: 'payment',
      label: 'Payment terms',
      value: payment ? (
        <>
          {payment}
          <NonStandardTermsBadge show={t.paymentTermsNonstandard} />
        </>
      ) : null,
    },
    {
      id: 'tooling-payment',
      label: 'Tooling payment',
      value: label(toolingPayments, t.termsToolingPayment),
    },
    { id: 'milestone', label: 'Milestone note', value: t.termsMilestoneNote },
    { id: 'tooling', label: 'Customer tooling commitment', value: yesNo(t.termsToolingCommitment) },
    { id: 'moq', label: 'MOQ', value: t.termsMoq },
    // The capital terms, without "Confirmed by the approver: Not confirmed" while nothing is set.
    ...capital.filter((i) => i.id !== 'cap-finalized' || t.capital.finalizedAt),
    {
      id: 'checked',
      label: 'Terms checked',
      value: t.checkedAt ? `${t.checkedByName ?? 'Someone'}, ${absoluteTime(t.checkedAt)}` : null,
    },
    {
      id: 'legal',
      label: 'Legal review',
      value: legal.reviewedOn
        ? `${legal.reviewedOn}${legal.reviewerName ? ` by ${legal.reviewerName}` : ''}`
        : legal.required
          ? `Triggered (${legal.reasons.map((r) => r.label).join(', ')}), not recorded`
          : null,
    },
    { id: 'notes', label: 'Terms notes', value: t.termsNotes },
  ]);
  return (
    <GlanceCard
      title="Commercial terms"
      testId="glance-terms"
      aside={
        canEdit ? (
          <Link
            to="/quotes/$quoteNumber"
            params={{ quoteNumber: quote.quoteNumber }}
            search={{ tab: 'commercial' }}
            className="text-emphasis inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline sm:min-h-0"
            data-testid="glance-terms-edit"
          >
            Edit on the Commercial terms tab
          </Link>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <Nothing>No terms are recorded yet.</Nothing>
      ) : (
        <KeyValueGrid items={rows} />
      )}
    </GlanceCard>
  );
}
