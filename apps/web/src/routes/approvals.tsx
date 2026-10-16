import type { QuoteSummary } from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ConstructionIcon, InboxIcon } from 'lucide-react';
import { useState } from 'react';

import { ForbiddenPage, useCan } from '@/auth';
import {
  EmptyState,
  ErrorState,
  GateDecisionDialog,
  OverrideInbox,
  PageHeader,
  PriorityBadge,
  QualificationWarnings,
  SkeletonRows,
} from '@/components';
import { Button } from '@/components/ui/button';
import { usePublicConfig } from '@/config/public-config';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

interface ApprovalsSearch {
  /** A gate key: `?gate=G1` is the "To qualify" queue (B-08). Without it: Final Review approvals (B-12). */
  gate?: string;
}

export const Route = createFileRoute('/approvals')({
  validateSearch: (search: Record<string, unknown>): ApprovalsSearch =>
    typeof search.gate === 'string' && search.gate.trim() ? { gate: search.gate.trim() } : {},
  component: ApprovalsPage,
});

function ApprovalsPage() {
  const { gate } = Route.useSearch();
  if (gate) return <GateQueuePage gateKey={gate} />;
  return <ApprovalsHome />;
}

/**
 * Approvals: override requests for approvers (B-09) and the Final Review queue (B-12). Each section
 * shows only for the permission it needs; the API checks every call again.
 */
function ApprovalsHome() {
  useDocumentTitle('Approvals');
  const canOverride = useCan('override.approve');
  const canFinal = useCan('gate.G4.decide');
  if (!canOverride && !canFinal) return <ForbiddenPage />;
  return (
    <div className="grid gap-8" data-testid="page" data-page-title="Approvals">
      <PageHeader
        className="mb-0"
        title="Approvals"
        eyebrow="Decisions waiting on you"
        description="Override requests and, for Final Review approvers, submitted quotes."
      />
      {canOverride && <OverrideInbox />}
      {canFinal && (
        <section className="grid gap-3" aria-labelledby="final-review-heading">
          <h2 id="final-review-heading" className="text-base font-semibold">
            Final review
          </h2>
          <EmptyState
            icon={ConstructionIcon}
            title="Coming soon"
            description="Submitted quotes waiting for a Final Review decision arrive in B-12."
          />
        </section>
      )}
    </div>
  );
}

export const gateQueueQueryKey = (gateKey: string) => ['gate-queue', gateKey] as const;

/** Queue titles; any other gate uses its configured label. */
const QUEUE_TITLES: Record<string, { title: string; eyebrow: string; description: string }> = {
  G1: {
    title: 'To qualify',
    eyebrow: 'G1 · Qualify & prioritize',
    description:
      'Submitted intakes, highest priority first. The score is advisory: it orders the list; you decide.',
  },
};

function GateQueuePage({ gateKey }: { gateKey: string }) {
  const queue = useQuery({
    queryKey: gateQueueQueryKey(gateKey),
    queryFn: () => api.gateQueue(gateKey),
  });
  const [deciding, setDeciding] = useState<string | null>(null);
  const titles = QUEUE_TITLES[gateKey] ?? {
    title: queue.data?.gate.label ?? gateKey,
    eyebrow: gateKey,
    description: 'Quotes waiting for this gate, highest priority first.',
  };
  useDocumentTitle(titles.title);

  return (
    <div data-testid="gate-queue" data-gate={gateKey}>
      <PageHeader title={titles.title} eyebrow={titles.eyebrow} description={titles.description} />
      {queue.isPending && <SkeletonRows rows={4} />}
      {queue.error && <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />}
      {queue.data && !queue.data.gate.enabled && (
        <EmptyState
          icon={InboxIcon}
          title={`${queue.data.gate.label} is switched off`}
          description="Submitted intakes go straight to the engineering queue (g1_enabled = false)."
        />
      )}
      {queue.data?.gate.enabled && queue.data.items.length === 0 && (
        <EmptyState
          icon={InboxIcon}
          title="Nothing to qualify"
          description="New intakes appear here when a KAM submits them."
        />
      )}
      {queue.data?.gate.enabled && queue.data.items.length > 0 && (
        <ol className="grid gap-3" aria-label={titles.title}>
          {queue.data.items.map((q, i) => (
            <QueueCard
              key={q.id}
              quote={q}
              rank={i + 1}
              canDecide={queue.data.canDecide}
              onDecide={() => setDeciding(q.quoteNumber)}
            />
          ))}
        </ol>
      )}
      {deciding && (
        <GateDecisionDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeciding(null);
          }}
          gateKey={gateKey}
          quoteNumber={deciding}
        />
      )}
    </div>
  );
}

function QueueCard({
  quote,
  rank,
  canDecide,
  onDecide,
}: {
  quote: QuoteSummary;
  rank: number;
  canDecide: boolean;
  onDecide: () => void;
}) {
  const { data: config } = usePublicConfig();
  const label = (list: string, code: string | null) =>
    code ? (config?.valueLists[list]?.find((v) => v.code === code)?.label ?? code) : null;
  const defaultClass = config?.settings.intake_default_request_class;
  const otherClass = quote.requestClass && quote.requestClass !== defaultClass;
  const product = [label('product_family', quote.productFamily), label('resin', quote.resin)]
    .filter(Boolean)
    .join(' · ');

  return (
    <li
      className="bg-card rounded-card grid gap-3 border p-4 sm:grid-cols-[auto_1fr_auto] sm:items-start"
      data-testid="queue-item"
      data-quote={quote.quoteNumber}
    >
      <span className="text-muted-foreground text-sm tabular-nums" aria-label={`Rank ${rank}`}>
        {rank}
      </span>
      <div className="grid min-w-0 gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            to="/quotes/$quoteNumber"
            params={{ quoteNumber: quote.quoteNumber }}
            className="text-emphasis font-semibold underline-offset-4 hover:underline"
          >
            {quote.quoteNumber}
          </Link>
          <PriorityBadge priority={quote.priority} quoteNumber={quote.quoteNumber} />
          {quote.status === 'on_hold' && (
            <span className="text-muted-foreground text-xs">
              On hold{quote.reviewDate ? ` until ${quote.reviewDate}` : ''}
            </span>
          )}
        </div>
        <p className="min-w-0 text-sm break-words">
          {quote.customerName ?? 'Unknown customer'}
          {quote.opportunityName ? ` · ${quote.opportunityName}` : ''}
        </p>
        <p className="text-muted-foreground text-xs">
          {[
            product,
            quote.estAnnualVolume != null &&
              `${quote.estAnnualVolume.toLocaleString('en-US')} units/yr`,
            quote.estAnnualRevenue != null &&
              `$${quote.estAnnualRevenue.toLocaleString('en-US')}/yr`,
            quote.kamName && `KAM ${quote.kamName}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p className="text-xs">
          <span className="text-muted-foreground">Request class: </span>
          <span className={otherClass ? 'font-semibold' : undefined} data-testid="request-class">
            {label('request_class', quote.requestClass) ?? '–'}
          </span>
          {otherClass && (
            <span className="text-muted-foreground">
              {' '}
              (may be a redirect: stock, inquiry or other capital)
            </span>
          )}
        </p>
        <QualificationWarnings warnings={quote.warnings} />
      </div>
      {canDecide && (
        <Button size="sm" onClick={onDecide} aria-label={`Decide ${quote.quoteNumber}`}>
          Decide
        </Button>
      )}
    </li>
  );
}
