import type {
  PricingContext,
  PricingContextBpr,
  PricingErf,
  PricingErfStatus,
  QuotingDetail,
} from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';
import { DatabaseIcon, PlusIcon, TriangleAlertIcon, UnplugIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { useCan } from '@/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

import { KeyValueGrid } from '../KeyValueGrid';
import { SkeletonRows } from '../Skeletons';

export const pricingContextQueryKey = (quoteNumber: string) =>
  ['pricing-context', quoteNumber] as const;

export type ReferenceKind = 'erf' | 'bpr';

/** YYYY-MM-DD as a short local date (the pricing app's dates carry no time). */
const day = (d: string | null) =>
  d
    ? new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

/** A pricing-app figure: blank in the pricing app is "Unknown", never 0. */
function Figure({ value, money }: { value: number | null; money?: boolean }) {
  if (value === null) {
    return (
      <span className="text-muted-foreground" title="Blank in the pricing app">
        Unknown
      </span>
    );
  }
  return <>{`${money ? '$' : ''}${value.toLocaleString('en-US')}`}</>;
}

const days = (n: number | null) => (n === null ? null : `${n} day${n === 1 ? '' : 's'}`);

const STATUS_LABEL: Record<PricingErfStatus, string> = {
  open: 'Open',
  accepted: 'Accepted',
  rejected: 'Rejected',
  abandoned: 'Abandoned',
};

function Chip({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' }) {
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

const matches = (pattern: string, value: string) => {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return true; // a bad setting is the server's to report
  }
};

interface UseRef {
  /** Adds the number to the current pricing record's references (Pricing, in Quoting). */
  onUse?: ((kind: ReferenceKind, value: string) => void) | undefined;
  pending?: string | null | undefined;
  formats?: QuotingDetail['refFormats'] | undefined;
}

function UseButton({
  kind,
  value,
  context,
  use,
}: {
  kind: ReferenceKind;
  value: string;
  context: PricingContext;
  use: UseRef;
}) {
  if (!context.canUseAsReference || !use.onUse) return null;
  const refs = kind === 'erf' ? context.refs.erfRefs : context.refs.bprRefs;
  if (refs.some((r) => r.toLowerCase() === value.toLowerCase())) {
    return <Chip>Referenced</Chip>;
  }
  const format = use.formats?.[kind];
  const valid = !format || matches(format.pattern, value);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={!valid || use.pending === value}
      title={
        valid
          ? undefined
          : `Not in the ${format.label} format (e.g. ${format.example}): type the reference instead`
      }
      onClick={() => use.onUse!(kind, value)}
      data-testid={`use-${kind}-${value}`}
    >
      <PlusIcon className="size-3.5" aria-hidden="true" />
      Use as reference
    </Button>
  );
}

function ErfCard({ erf, context, use }: { erf: PricingErf; context: PricingContext; use: UseRef }) {
  const isQuoteErf =
    context.refs.quoteErfNumber?.replace(/\D/g, '') === erf.erfNumber.replace(/\D/g, '');
  return (
    <article
      className="grid gap-3 rounded-md border p-3"
      aria-labelledby={`erf-${erf.erfNumber}`}
      data-testid="pricing-context-erf"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`erf-${erf.erfNumber}`} className="flex flex-wrap items-center gap-2 font-medium">
          ERF {erf.erfNumber}
          <Chip>{STATUS_LABEL[erf.status]}</Chip>
          {isQuoteErf && <Chip>Quote ERF</Chip>}
        </h3>
        <UseButton kind="erf" value={erf.erfNumber} context={context} use={use} />
      </div>
      <p className="text-foreground-2 text-sm">
        {[erf.customerName, erf.title].filter(Boolean).join(' · ') || '–'}
      </p>
      <KeyValueGrid
        columns={3}
        items={[
          { label: 'Submitted', value: day(erf.submittedOn) },
          { label: 'Priority', value: erf.priority },
          { label: 'Product class', value: erf.productClass },
          { label: 'Channel', value: erf.channel },
          { label: 'Plant', value: erf.plant },
          { label: 'Machine', value: erf.machine },
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
          { label: 'Attachments', value: erf.attachmentCount?.toString() },
          { label: 'To engineer assigned', value: days(erf.elapsedDays.engineerAssigned) },
          { label: 'To ECE approved', value: days(erf.elapsedDays.eceApproved) },
          { label: 'To price confirmed', value: days(erf.elapsedDays.priceConfirmed) },
        ]}
      />
    </article>
  );
}

function BprList({
  bprs,
  context,
  use,
}: {
  bprs: PricingContextBpr[];
  context: PricingContext;
  use: UseRef;
}) {
  return (
    <section className="grid gap-2" aria-labelledby="pricing-context-bprs">
      <h3 id="pricing-context-bprs" className="text-sm font-semibold">
        Linked BPRs ({bprs.length})
      </h3>
      {bprs.length === 0 ? (
        <p className="text-muted-foreground text-sm">No BPR in the pricing app for these ERFs.</p>
      ) : (
        <ul className="grid gap-2" data-testid="pricing-context-bprs">
          {bprs.map((b) => (
            <li
              key={b.bprNumber}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <span className="grid gap-0.5">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {b.bprNumber}
                  {b.status && <Chip>{b.status}</Chip>}
                  <span className="text-muted-foreground text-xs font-normal">
                    {b.via === 'reference' ? 'on the pricing record' : `follows ERF ${b.erfNumber}`}
                  </span>
                </span>
                <span className="text-foreground-2">
                  {[
                    b.itemDescription,
                    b.requestedOn && `requested ${day(b.requestedOn)}`,
                    b.effectiveOn && `effective ${day(b.effectiveOn)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '–'}
                </span>
              </span>
              <UseButton kind="bpr" value={b.bprNumber} context={context} use={use} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SprHistory({ context }: { context: PricingContext }) {
  return (
    <details className="rounded-md border px-3 py-2" data-testid="pricing-context-spr">
      <summary className="cursor-pointer text-sm font-semibold">
        Historical (SPR retired Nov 2025) · {context.sprHistory.length}
      </summary>
      {context.sprHistory.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">No SPR history for this customer.</p>
      ) : (
        <ul className="mt-2 grid gap-1 text-sm">
          {context.sprHistory.map((s) => (
            <li key={s.sprNumber} className="text-foreground-2">
              <span className="text-foreground font-medium">{s.sprNumber}</span>
              {[s.itemDescription, s.status, day(s.requestedOn)]
                .filter(Boolean)
                .map((part) => ` · ${part}`)
                .join('')}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** Shown when the pricing app can't be read: the manual references keep working. */
export function PricingAppUnavailable({ detail }: { detail?: string | null | undefined }) {
  return (
    <p
      role="status"
      className="bg-secondary flex items-start gap-2 rounded-md px-3 py-2 text-sm"
      data-testid="pricing-context-unavailable"
    >
      <UnplugIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        <span className="font-medium">Pricing app unavailable; enter references manually.</span>
        {detail ? <span className="text-muted-foreground"> ({detail})</span> : null}
      </span>
    </p>
  );
}

/**
 * B-15 (F-11): the quote's read-only "Pricing context" from the legacy pricing app: the ERF summary
 * (dates, decision, elapsed days, estimated figures with blanks as "Unknown"), the BPRs that follow it,
 * and the customer's SPR history (collapsed: SPR retired Nov 2025). Pricing, in Quoting, can add an
 * ERF/BPR to the pricing record with "Use as reference". Nothing here edits a pricing-app figure.
 *
 * Rendered only for roles with `quote.read.commercialFields`; the API answers 403 to anyone else, so
 * hiding it is cosmetic, not the control. Any failure shows the manual-reference fallback.
 */
export function PricingContextPanel({
  quoteNumber,
  onUseReference,
  pendingReference,
  refFormats,
}: {
  quoteNumber: string;
  onUseReference?: (kind: ReferenceKind, value: string) => void;
  pendingReference?: string | null;
  refFormats?: QuotingDetail['refFormats'];
}) {
  const canRead = useCan('quote.read.commercialFields');
  const query = useQuery({
    queryKey: pricingContextQueryKey(quoteNumber),
    queryFn: () => api.pricingContext(quoteNumber),
    enabled: canRead,
    retry: false,
    staleTime: 60_000,
  });
  if (!canRead) return null;
  const context = query.data;
  const use: UseRef = { onUse: onUseReference, pending: pendingReference, formats: refFormats };

  return (
    <Card data-testid="pricing-context">
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <DatabaseIcon className="size-4" aria-hidden="true" />
            Pricing context
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {query.isPending ? (
          <SkeletonRows rows={3} />
        ) : query.isError ? (
          <PricingAppUnavailable />
        ) : !context!.source.available ? (
          <PricingAppUnavailable detail={context!.source.error} />
        ) : (
          <Body context={context!} use={use} />
        )}
        {context && !context.source.available && <ReferenceSummary context={context} />}
      </CardContent>
    </Card>
  );
}

/** The references CCQ holds, shown even when the pricing app is down. */
function ReferenceSummary({ context }: { context: PricingContext }) {
  return (
    <KeyValueGrid
      columns={3}
      items={[
        { label: 'Quote ERF', value: context.refs.quoteErfNumber },
        { label: 'SF ERF', value: context.refs.sfErfNumber },
        {
          label: 'Record references',
          value: [...context.refs.erfRefs, ...context.refs.bprRefs].join(', '),
        },
      ]}
    />
  );
}

function Body({ context, use }: { context: PricingContext; use: UseRef }) {
  const nothing =
    context.erfRecords.length === 0 &&
    context.bprRecords.length === 0 &&
    context.notFound.erf.length === 0 &&
    context.notFound.bpr.length === 0;
  return (
    <>
      {context.linkage.mismatch && (
        <p
          role="alert"
          className="bg-warning text-warning-foreground flex items-start gap-2 rounded-md px-3 py-2 text-sm"
          data-testid="pricing-context-mismatch"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          The ERF number on the Salesforce opportunity ({context.refs.sfErfNumber}) differs from the
          quote&apos;s ({context.refs.quoteErfNumber}). Check which one is right; CCQ never writes
          to Salesforce.
        </p>
      )}
      {nothing && (
        <p className="text-muted-foreground text-sm" data-testid="pricing-context-empty">
          No ERF or BPR reference yet. Record one on the price approval below, or note that the
          pricing app has no record yet.
        </p>
      )}
      {context.erfRecords.map((erf) => (
        <ErfCard key={erf.erfNumber} erf={erf} context={context} use={use} />
      ))}
      {(context.notFound.erf.length > 0 || context.notFound.bpr.length > 0) && (
        <p className="text-muted-foreground text-sm" data-testid="pricing-context-not-found">
          Not in the pricing app:{' '}
          {[
            ...context.notFound.erf.map((n) => `ERF ${n}`),
            ...context.notFound.bpr.map((n) => `BPR ${n}`),
          ].join(', ')}
        </p>
      )}
      {(context.erfRecords.length > 0 || context.bprRecords.length > 0) && (
        <BprList bprs={context.bprRecords} context={context} use={use} />
      )}
      <SprHistory context={context} />
      <p className="text-muted-foreground text-xs">
        Read-only from the pricing app
        {context.source.readAt ? `, read ${relativeTime(context.source.readAt)}` : ''}
        {context.source.mode === 'fake' ? ' (synthetic data)' : ''}. Figures are edited in the
        pricing app, never in CCQ.
      </p>
    </>
  );
}
