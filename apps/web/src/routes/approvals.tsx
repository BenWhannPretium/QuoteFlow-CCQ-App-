import type { QuoteSummary } from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { InboxIcon } from 'lucide-react';
import { Tabs } from 'radix-ui';
import { useCallback, useState } from 'react';

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
import {
  FINAL_REVIEW_SORTS,
  FinalReviewQueue,
  type FinalReviewSearch,
  type FinalReviewSort,
} from '@/components/final-review/FinalReviewQueue';
import { Button } from '@/components/ui/button';
import { usePublicConfig } from '@/config/public-config';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

const TABS = ['final-review', 'to-qualify', 'overrides'] as const;
type ApprovalsTab = (typeof TABS)[number];

interface ApprovalsSearch extends FinalReviewSearch {
  /** The open tab (B-12). Without it: the first tab the caller can use. */
  tab?: ApprovalsTab;
  /**
   * A gate key. `?gate=G1` is the "To qualify" tab and `?gate=G4` the "Final Review" tab (the links
   * B-08 and the nav use); any other gate shows its generic queue (B-08).
   */
  gate?: string;
}

export const Route = createFileRoute('/approvals')({
  validateSearch: (search: Record<string, unknown>): ApprovalsSearch => ({
    ...(TABS.includes(search.tab as ApprovalsTab) ? { tab: search.tab as ApprovalsTab } : {}),
    ...(typeof search.gate === 'string' && search.gate.trim() ? { gate: search.gate.trim() } : {}),
    // B-14: the Final Review tab's filters and sort, in the URL like the pipeline views.
    ...Object.fromEntries(
      (['q', 'tier', 'g2', 'capital'] as const)
        .filter((k) => typeof search[k] === 'string' && search[k].trim())
        .map((k) => [k, (search[k] as string).trim().slice(0, 200)]),
    ),
    ...(FINAL_REVIEW_SORTS.includes(search.sort as FinalReviewSort)
      ? { sort: search.sort as FinalReviewSort }
      : {}),
  }),
  component: ApprovalsPage,
});

function ApprovalsPage() {
  const { gate, tab } = Route.useSearch();
  if (gate && gate !== 'G1' && gate !== 'G4') return <GateQueuePage gateKey={gate} />;
  return (
    <ApprovalsHome
      tab={tab ?? (gate === 'G1' ? 'to-qualify' : gate === 'G4' ? 'final-review' : undefined)}
    />
  );
}

function FinalReviewTab() {
  const { q, tier, g2, capital, sort } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const onChange = useCallback(
    (next: FinalReviewSearch) =>
      void navigate({
        search: (prev) => ({
          ...(prev.tab ? { tab: prev.tab } : {}),
          ...(prev.gate ? { gate: prev.gate } : {}),
          q: next.q,
          tier: next.tier,
          g2: next.g2,
          capital: next.capital,
          sort: next.sort,
        }),
        replace: true,
      }),
    [navigate],
  );
  return <FinalReviewQueue value={{ q, tier, g2, capital, sort }} onChange={onChange} />;
}

const TAB_INFO: Record<ApprovalsTab, { label: string; title: string; description: string }> = {
  'final-review': {
    label: 'Final Review',
    title: 'Final Review',
    description:
      'Quotes Pricing has submitted, highest tier first. Approving releases the proposition to Customer Decision; declining closes it as Declined. Only the customer’s answer awards or loses a quote.',
  },
  'to-qualify': {
    label: 'To qualify',
    title: 'To qualify',
    description:
      'Submitted intakes, highest priority first. The score is advisory: it orders the list; you decide.',
  },
  overrides: {
    label: 'Overrides',
    title: 'Override requests',
    description: 'Requests to change a priority tier that you may approve or reject.',
  },
};

/**
 * Approvals (B-09, B-12): the Final Review queue (G4) for approvers, the "To qualify" queue (G1) for
 * the qualifying role and the override requests an approver decides. Each tab shows only for the
 * permission it needs; the API checks every call again.
 */
function ApprovalsHome({ tab }: { tab: ApprovalsTab | undefined }) {
  const { data: config } = usePublicConfig();
  const navigate = useNavigate({ from: Route.fullPath });
  const canReadFinal = useCan('finalReview.read');
  const canDecideFinal = useCan('gate.G4.decide');
  const canDecideG1 = useCan('gate.G1.decide');
  const canOverride = useCan('override.approve');
  const canFinal = canReadFinal || canDecideFinal;
  const canQualify = canDecideG1 && (config?.gates.find((g) => g.key === 'G1')?.enabled ?? true);
  const visible = TABS.filter((t) =>
    t === 'final-review' ? canFinal : t === 'to-qualify' ? canQualify : canOverride,
  );
  // Default to the work an approver is here for: Final Review, then overrides, then qualifying.
  const fallback = (['final-review', 'overrides', 'to-qualify'] as const).find((t) =>
    visible.includes(t),
  );
  const active = tab && visible.includes(tab) ? tab : fallback;
  const info = active ? TAB_INFO[active] : undefined;
  useDocumentTitle(info?.title ?? 'Approvals');
  if (!active || !info) return <ForbiddenPage />;

  return (
    <div className="grid gap-6" data-testid="page" data-page-title="Approvals">
      <PageHeader
        className="mb-0"
        title={info.title}
        eyebrow="Approvals"
        description={info.description}
      />
      <Tabs.Root
        value={active}
        onValueChange={(next) =>
          void navigate({ search: { tab: next as ApprovalsTab }, replace: true })
        }
        className="grid gap-6"
      >
        <Tabs.List aria-label="Approvals" className="flex gap-1 overflow-x-auto border-b">
          {visible.map((t) => (
            <Tabs.Trigger
              key={t}
              value={t}
              data-testid={`approvals-tab-${t}`}
              className="text-foreground-2 data-[state=active]:border-action data-[state=active]:text-foreground hover:text-foreground -mb-px min-h-11 shrink-0 border-b-2 border-transparent px-4 text-sm font-medium transition-colors"
            >
              {TAB_INFO[t].label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="final-review">
          <FinalReviewTab />
        </Tabs.Content>
        <Tabs.Content value="to-qualify">
          <GateQueue gateKey="G1" />
        </Tabs.Content>
        <Tabs.Content value="overrides">
          <OverrideInbox />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

export const gateQueueQueryKey = (gateKey: string) => ['gate-queue', gateKey] as const;

/** The standalone queue for any gate other than G1 / G4 (B-08's generic `?gate=` page). */
function GateQueuePage({ gateKey }: { gateKey: string }) {
  const queue = useGateQueue(gateKey);
  const title = queue.data?.gate.label ?? gateKey;
  useDocumentTitle(title);
  return (
    <div data-testid="gate-queue" data-gate={gateKey}>
      <PageHeader
        title={title}
        eyebrow={gateKey}
        description="Quotes waiting for this gate, highest priority first."
      />
      <GateQueueBody gateKey={gateKey} queue={queue} />
    </div>
  );
}

function useGateQueue(gateKey: string) {
  return useQuery({ queryKey: gateQueueQueryKey(gateKey), queryFn: () => api.gateQueue(gateKey) });
}

/** The "To qualify" (G1) tab body. */
function GateQueue({ gateKey }: { gateKey: string }) {
  const queue = useGateQueue(gateKey);
  return (
    <div data-testid="gate-queue" data-gate={gateKey}>
      <GateQueueBody gateKey={gateKey} queue={queue} />
    </div>
  );
}

function GateQueueBody({
  gateKey,
  queue,
}: {
  gateKey: string;
  queue: ReturnType<typeof useGateQueue>;
}) {
  const [deciding, setDeciding] = useState<string | null>(null);
  return (
    <>
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
        <ol className="grid gap-3" aria-label={queue.data.gate.label}>
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
    </>
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
