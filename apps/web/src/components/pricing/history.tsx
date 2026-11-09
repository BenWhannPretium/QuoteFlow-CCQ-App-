import type {
  PricingBpr,
  PricingErf,
  PricingHistoryRecord,
  PricingHistoryStatus,
  PricingSpr,
} from '@ccq/contracts';
import { ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { KeyValueGrid } from '../KeyValueGrid';

/**
 * B-15 (revised): how a record from the imported legacy pricing history is shown. Read-only: nothing
 * here edits a pricing-app value. Estimates and prices of 0 arrive as null and read "Unknown".
 */

/** YYYY-MM-DD as a short local date (the export's dates carry no zone). */
export const day = (d: string | null) =>
  d
    ? new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

/** A figure from the export: null is "Unknown" (blank, or 0 written for blank), never $0. */
export function Figure({
  value,
  money,
  decimals,
}: {
  value: number | null;
  money?: boolean;
  decimals?: number;
}) {
  if (value === null) {
    return (
      <span className="text-muted-foreground" title="Blank (or 0) in the pricing-app export">
        Unknown
      </span>
    );
  }
  const text = value.toLocaleString('en-US', {
    maximumFractionDigits: decimals ?? (money && Math.abs(value) < 10 ? 4 : 0),
  });
  return <>{`${money ? '$' : ''}${text}`}</>;
}

const days = (n: number | null) => (n === null ? null : `${n} day${n === 1 ? '' : 's'}`);

export const STATUS_LABEL: Record<PricingHistoryStatus, string> = {
  open: 'Open',
  on_hold: 'On hold',
  accepted: 'Accepted',
  rejected: 'Rejected',
  abandoned: 'Abandoned',
  completed: 'Completed',
};

export function Chip({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'warn';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'warn' ? 'bg-warning text-warning-foreground' : 'bg-secondary',
      )}
    >
      {children}
    </span>
  );
}

/** Free text from the legacy app, kept for context. */
function Notes({ items }: { items: { label: string; text: string | null }[] }) {
  const present = items.filter((i) => i.text);
  if (present.length === 0) return null;
  return (
    <dl className="grid gap-2 text-sm" data-testid="history-notes">
      {present.map((i) => (
        <div key={i.label}>
          <dt className="text-muted-foreground text-xs font-medium">{i.label}</dt>
          <dd className="break-words whitespace-pre-line">{i.text}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Number, status and the one-line summary shared by every kind. */
export function RecordHeading({
  record,
  extra,
  as: Heading = 'h3',
}: {
  record: PricingHistoryRecord;
  extra?: ReactNode;
  as?: 'h3' | 'span';
}) {
  return (
    <span className="grid gap-0.5">
      <Heading className="flex flex-wrap items-center gap-2 font-medium">
        {record.requestNumber}
        <Chip>{STATUS_LABEL[record.status]}</Chip>
        <span className="text-muted-foreground text-xs font-normal">FY{record.fiscalYear}</span>
        {extra}
      </Heading>
      <span className="text-foreground-2 text-sm">
        {[record.customer, record.productDescription, day(record.submittedOn)]
          .filter(Boolean)
          .join(' · ') || '–'}
      </span>
    </span>
  );
}

export function ErfDetails({ erf }: { erf: PricingErf }) {
  return (
    <div className="grid gap-3">
      <KeyValueGrid
        columns={3}
        items={[
          { label: 'Legacy status', value: erf.displayStatus },
          { label: 'Submitted', value: day(erf.submittedOn) },
          { label: 'Sales person', value: erf.salesPerson },
          { label: 'Priority', value: erf.priority?.toString() },
          { label: 'Product class', value: erf.productClass },
          { label: 'Market', value: erf.market },
          { label: 'Process / resin', value: [erf.process, erf.resin].filter(Boolean).join(' · ') },
          { label: 'Plant', value: erf.plant },
          { label: 'Machine', value: erf.machine },
          { label: 'Lead engineer', value: erf.leadEngineer },
          { label: 'Est. revenue', value: <Figure value={erf.estRevenueUsd} money /> },
          { label: 'Est. volume', value: <Figure value={erf.estVolume} /> },
          { label: 'Est. net capital', value: <Figure value={erf.estNetCapitalUsd} money /> },
          {
            id: 'decision',
            label: 'Decision',
            value:
              [erf.decision.type, erf.decision.by, day(erf.decision.on)]
                .filter(Boolean)
                .join(' · ') || null,
          },
          { label: 'Decision reason', value: erf.decision.reason },
          { label: 'Price confirmed', value: day(erf.milestones.priceConfirmedOn) },
          { label: 'Proposal submitted', value: day(erf.milestones.proposalSubmittedOn) },
          { label: 'Contract finalized', value: day(erf.milestones.contractFinalizedOn) },
          { label: 'To engineer assigned', value: days(erf.elapsedDays.engineerAssigned) },
          { label: 'To ECE approved', value: days(erf.elapsedDays.eceApproved) },
          { label: 'To price confirmed', value: days(erf.elapsedDays.priceConfirmed) },
        ]}
      />
      <Notes
        items={[
          { label: 'Comments', text: erf.comments },
          { label: 'Engineering comments', text: erf.engineeringComments },
          { label: 'Price confirmation', text: erf.priceConfirmation },
        ]}
      />
    </div>
  );
}

export function BprDetails({ bpr }: { bpr: PricingBpr }) {
  return (
    <div className="grid gap-3">
      <KeyValueGrid
        columns={3}
        items={[
          { label: 'Legacy status', value: bpr.displayStatus },
          { label: 'Type', value: bpr.bprType },
          { label: 'Item', value: bpr.itemNumber },
          { label: 'Packout', value: bpr.packout },
          { label: 'Price agreed to', value: <Figure value={bpr.priceAgreedTo} money /> },
          { label: 'Est. revenue', value: <Figure value={bpr.estRevenueUsd} money /> },
          { label: 'Est. volume', value: <Figure value={bpr.estVolume} /> },
          { label: 'Price confirmed', value: day(bpr.priceConfirmedOn) },
          { label: 'Updated in Oracle', value: day(bpr.oracleUpdatedOn) },
          { label: 'Sales person', value: bpr.salesPerson },
          { label: 'Plant', value: bpr.plant },
          { label: 'To price confirmed', value: days(bpr.daysToPriceConfirmed) },
        ]}
      />
      <Notes
        items={[
          { label: 'Comments', text: bpr.comments },
          { label: 'CS setup', text: bpr.csSetupText },
          { label: 'Abandoned because', text: bpr.abandonedReason },
        ]}
      />
    </div>
  );
}

export function SprDetails({ spr }: { spr: PricingSpr }) {
  return (
    <div className="grid gap-3">
      <KeyValueGrid
        columns={3}
        items={[
          { label: 'Legacy status', value: spr.displayStatus },
          { label: 'Type', value: spr.sprType },
          { label: 'Item', value: spr.itemNumber },
          { label: 'Current price', value: <Figure value={spr.currentPrice} money /> },
          { label: 'Target price', value: <Figure value={spr.targetPrice} money /> },
          { label: 'Est. annual revenue', value: <Figure value={spr.estRevenueUsd} money /> },
          { label: 'Est. annual volume', value: <Figure value={spr.estVolume} /> },
          { label: 'Competitor', value: spr.competitorName },
          {
            id: 'decision',
            label: 'Decision',
            value:
              [spr.decision.type, spr.decision.by, day(spr.decision.on)]
                .filter(Boolean)
                .join(' · ') || null,
          },
          { label: 'Sales person', value: spr.salesPerson },
        ]}
      />
      <Notes
        items={[
          { label: 'Comments', text: spr.comments },
          { label: 'Competitive offer', text: spr.competitiveOffer },
          { label: 'Decision reason', text: spr.decision.reason },
        ]}
      />
    </div>
  );
}

export function RecordDetails({ record }: { record: PricingHistoryRecord }) {
  if (record.kind === 'erf') return <ErfDetails erf={record} />;
  if (record.kind === 'bpr') return <BprDetails bpr={record} />;
  return <SprDetails spr={record} />;
}

/**
 * A collapsed record: the heading as the summary, the details inside. The action (e.g. "Use as
 * reference") sits beside the summary, not in it: a button inside <summary> is nested interactive
 * content.
 */
export function RecordRow({
  record,
  action,
  open,
}: {
  record: PricingHistoryRecord;
  action?: ReactNode;
  open?: boolean;
}) {
  return (
    <li className="flex items-start gap-2 rounded-md border" data-testid={`history-${record.kind}`}>
      <details open={open} className="group min-w-0 flex-1">
        <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon
            className="text-muted-foreground mt-1 size-4 shrink-0 transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
          <RecordHeading record={record} as="span" />
        </summary>
        <div className="border-t px-3 py-3">
          <RecordDetails record={record} />
        </div>
      </details>
      {action && <div className="shrink-0 px-3 py-2">{action}</div>}
    </li>
  );
}
