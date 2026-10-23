import type { PricingContext, PricingErf, QuotingDetail } from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { HistoryIcon, PlusIcon, SearchIcon, TriangleAlertIcon, UnplugIcon } from 'lucide-react';

import { useCan } from '@/auth';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { cn } from '@/lib/utils';

import { Chip, ErfDetails, RecordHeading, RecordRow } from './history';
import { SkeletonRows } from '../Skeletons';

export const pricingContextQueryKey = (quoteNumber: string) =>
  ['pricing-context', quoteNumber] as const;

/** B-26: legacy ERF numbers only (BPR dropped). */
export type ReferenceKind = 'erf';

const matches = (pattern: string, value: string) => {
  try {
    return new RegExp(pattern).test(value.trim().toUpperCase());
  } catch {
    return true; // a bad setting is the server's to report
  }
};

interface UseRef {
  /** Adds the number as a Legacy ERF # on the current pricing record (Pricing, in Quoting). */
  onUse?: ((kind: ReferenceKind, value: string) => void) | undefined;
  pending?: string | null | undefined;
  formats?: QuotingDetail['refFormats'] | undefined;
}

function UseButton({
  value,
  context,
  use,
}: {
  value: string;
  context: PricingContext;
  use: UseRef;
}) {
  if (!context.canUseAsReference || !use.onUse) return null;
  if (context.refs.erfRefs.some((r) => r.toUpperCase() === value.toUpperCase())) {
    return <Chip>Referenced</Chip>;
  }
  const format = use.formats?.erf;
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
          : `Not in the ${format.label} format (e.g. ${format.example}): type it instead`
      }
      onClick={() => use.onUse!('erf', value)}
      data-testid={`use-erf-${value}`}
    >
      <PlusIcon className="size-3.5" aria-hidden="true" />
      Use as reference
    </Button>
  );
}

function ReferencedErf({
  erf,
  context,
  use,
}: {
  erf: PricingErf;
  context: PricingContext;
  use: UseRef;
}) {
  const quoteErf = context.refs.quoteErfNumber?.toUpperCase() === erf.requestNumber.toUpperCase();
  return (
    <article className="grid gap-3 rounded-md border p-3" data-testid="pricing-context-erf">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <RecordHeading record={erf} extra={quoteErf ? <Chip>Quote ERF</Chip> : undefined} />
        <UseButton value={erf.requestNumber} context={context} use={use} />
      </div>
      <ErfDetails erf={erf} />
    </article>
  );
}

/** No history to show: not imported yet, or it could not be loaded. Manual entry keeps working. */
export function PricingHistoryUnavailable({ notImported }: { notImported?: boolean }) {
  return (
    <p
      role="status"
      className="bg-secondary flex items-start gap-2 rounded-md px-3 py-2 text-sm"
      data-testid={notImported ? 'pricing-context-not-imported' : 'pricing-context-unavailable'}
    >
      <UnplugIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {notImported ? (
        <span>
          <span className="font-medium">Pricing history not imported yet.</span> An Admin imports
          the pricing-app export from Admin → Integrations. You can still type a Legacy ERF #.
        </span>
      ) : (
        <span className="font-medium">
          Pricing history could not be loaded; you can still type a Legacy ERF #.
        </span>
      )}
    </p>
  );
}

/**
 * B-15 (F-11), revised: the quote's **pricing history**, from the retired pricing app's export
 * (imported into CCQ; no live connection). The referenced legacy ERFs in full (estimates of 0 or
 * blank shown as "Unknown", decision, milestones, elapsed days, the legacy free text), the customer's
 * other ERFs (Pricing can "Use as reference" while the quote is in Quoting) and SPR history
 * (collapsed). No BPR on a quote (B-26): BPRs are on the Pricing history page.
 *
 * Rendered only for roles with `quote.read.commercialFields`; the API answers 403 to anyone else, so
 * hiding it is cosmetic, not the control.
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
          <span className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <HistoryIcon className="size-4" aria-hidden="true" />
              Pricing history
            </h2>
            <Link
              to="/pricing-history"
              search={{
                kind: 'erf',
                ...(context?.customerMatch ? { customer: context.customerMatch } : {}),
              }}
              className={cn(buttonVariants({ variant: 'link', size: 'sm' }), 'px-0')}
              data-testid="pricing-history-link"
            >
              <SearchIcon className="size-3.5" aria-hidden="true" />
              Search all pricing history
            </Link>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {query.isPending ? (
          <SkeletonRows rows={3} />
        ) : query.isError ? (
          <PricingHistoryUnavailable />
        ) : !context!.source.imported ? (
          <PricingHistoryUnavailable notImported />
        ) : (
          <Body context={context!} use={use} />
        )}
      </CardContent>
    </Card>
  );
}

function Body({ context, use }: { context: PricingContext; use: UseRef }) {
  const noRefs = context.erfRecords.length === 0 && context.notFound.erf.length === 0;
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
      {noRefs && (
        <p className="text-muted-foreground text-sm" data-testid="pricing-context-empty">
          No Legacy ERF # on this quote. That is fine: it is optional during the transition and no
          gate needs it.
        </p>
      )}
      {context.erfRecords.map((erf) => (
        <ReferencedErf key={erf.requestNumber} erf={erf} context={context} use={use} />
      ))}
      {context.notFound.erf.length > 0 && (
        <p className="text-muted-foreground text-sm" data-testid="pricing-context-not-found">
          Not in the pricing history: {context.notFound.erf.join(', ')}
        </p>
      )}

      {context.customerMatch && (
        <section className="grid gap-2" aria-labelledby="pricing-context-customer-erfs">
          <h3 id="pricing-context-customer-erfs" className="text-sm font-semibold">
            Other ERFs for {context.customerMatch} ({context.customerErfs.length})
          </h3>
          {context.customerErfs.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No other ERF under this customer name. The export has no Salesforce id, so a customer
              spelled differently in the old app won&apos;t match: search the pricing history.
            </p>
          ) : (
            <ul className="grid gap-2" data-testid="pricing-context-customer-erfs">
              {context.customerErfs.map((erf) => (
                <RecordRow
                  key={`${erf.requestNumber}-${erf.submittedOn ?? ''}`}
                  record={erf}
                  action={<UseButton value={erf.requestNumber} context={context} use={use} />}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      <details className="rounded-md border px-3 py-2" data-testid="pricing-context-spr">
        <summary className="cursor-pointer text-sm font-semibold">
          Historical (SPR retired Nov 2025) · {context.sprHistory.length}
        </summary>
        {context.sprHistory.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">No SPR history for this customer.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {context.sprHistory.map((s) => (
              <RecordRow key={`${s.requestNumber}-${s.submittedOn ?? ''}`} record={s} />
            ))}
          </ul>
        )}
      </details>

      <p className="text-muted-foreground text-xs">
        Read-only history from the retired pricing app
        {context.source.importedAt ? `, imported ${absoluteTime(context.source.importedAt)}` : ''}.
        Matched on the customer name; nothing here can be edited in CCQ.
      </p>
    </>
  );
}
