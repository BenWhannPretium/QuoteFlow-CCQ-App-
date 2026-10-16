import type { QuoteDetail } from '@ccq/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { RotateCcwIcon } from 'lucide-react';
import { useState } from 'react';

import { useCurrentUser } from '@/auth';
import {
  ErrorState,
  GateDecisionDialog,
  KeyValueGrid,
  PageHeader,
  PriorityBadge,
  QualificationWarnings,
  quoteQueryKey,
  ScoreBreakdownTable,
  SkeletonCard,
  StageBadge,
} from '@/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { stageLabel, usePublicConfig } from '@/config/public-config';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export const Route = createFileRoute('/quotes/$quoteNumber')({
  component: QuotePage,
});

function QuotePage() {
  const { quoteNumber } = Route.useParams();
  useDocumentTitle(quoteNumber);
  const quote = useQuery({
    queryKey: quoteQueryKey(quoteNumber),
    queryFn: () => api.quote(quoteNumber),
  });
  const [deciding, setDeciding] = useState<string | null>(null);

  if (quote.isPending) {
    return (
      <div className="grid gap-4">
        <PageHeader title={quoteNumber} eyebrow="Quote" />
        <SkeletonCard />
      </div>
    );
  }
  if (quote.error) {
    return (
      <div>
        <PageHeader title={quoteNumber} eyebrow="Quote" />
        <ErrorState error={quote.error} onRetry={() => void quote.refetch()} />
      </div>
    );
  }
  const q = quote.data;
  const gates = [...new Set(q.availableActions.map((a) => a.gateKey))];

  return (
    <div className="grid gap-6" data-testid="quote-detail" data-stage={q.stageKey}>
      <PageHeader
        className="mb-0"
        title={q.quoteNumber}
        eyebrow="Quote"
        description={[q.customerName, q.opportunityName].filter(Boolean).join(' · ') || undefined}
        actions={gates.map((g) => (
          <Button key={g} onClick={() => setDeciding(g)}>
            {q.availableActions.find((a) => a.gateKey === g)?.gateLabel ?? g}
          </Button>
        ))}
      />
      <div className="flex flex-wrap items-center gap-3">
        <StageBadge stageKey={q.stageKey} />
        {q.status !== 'active' && (
          <span className="text-muted-foreground text-sm" data-testid="quote-status">
            {q.status === 'on_hold'
              ? `On hold${q.reviewDate ? ` until ${q.reviewDate}` : ''}`
              : `Closed${q.outcome ? ` (${q.outcome})` : ''}`}
          </span>
        )}
        <PriorityBadge priority={q.priority} quoteNumber={q.quoteNumber} />
      </div>

      <ReworkBanner quote={q} />
      <QualificationWarnings warnings={q.warnings} />

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <IntakeCard quote={q} />
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="text-base font-semibold">Why this priority?</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScoreBreakdownTable priority={q.priority} />
            </CardContent>
          </Card>
          <DecisionsCard quote={q} />
        </div>
      </div>

      {deciding && (
        <GateDecisionDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeciding(null);
          }}
          gateKey={deciding}
          quoteNumber={q.quoteNumber}
        />
      )}
    </div>
  );
}

/** A quote returned for rework: what to fix, and (for its KAM) the way back into the wizard. */
function ReworkBanner({ quote }: { quote: QuoteDetail }) {
  const me = useCurrentUser();
  const navigate = useNavigate();
  const start = useMutation({
    mutationFn: () => api.startRework(quote.quoteNumber),
    onSuccess: (draft) => void navigate({ to: '/intake/new', search: { draft: draft.id } }),
    onError: () => toast.error({ title: 'Could not open the rework draft' }),
  });
  if (!quote.rework) return null;
  const isKam = me.user.id === quote.kamUserId;
  return (
    <section
      role="status"
      data-testid="rework-banner"
      className="bg-warning text-warning-foreground rounded-card grid gap-2 p-4"
    >
      <p className="flex items-center gap-2 font-semibold">
        <RotateCcwIcon className="size-4" aria-hidden="true" />
        Returned for rework at {quote.rework.gateKey}
        {quote.rework.reasonLabel ? `: ${quote.rework.reasonLabel}` : ''}
      </p>
      {quote.rework.note && <p className="text-sm">What to fix: {quote.rework.note}</p>}
      <p className="text-xs">
        {quote.rework.decidedByName ?? 'A reviewer'} ·{' '}
        {new Date(quote.rework.decidedAt).toLocaleString()}
      </p>
      {isKam && (
        <div>
          <Button
            size="sm"
            variant="primary"
            onClick={() => start.mutate()}
            disabled={start.isPending}
          >
            Fix and resubmit
          </Button>
        </div>
      )}
    </section>
  );
}

function IntakeCard({ quote }: { quote: QuoteDetail }) {
  const { data: config } = usePublicConfig();
  const label = (list: string, code: string | null) =>
    code ? (config?.valueLists[list]?.find((v) => v.code === code)?.label ?? code) : null;
  const ship = quote.shipTo;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Intake</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <KeyValueGrid
          items={[
            { label: 'Customer', value: quote.customerName },
            {
              label: 'Customer status',
              value:
                quote.customerStatus === 'not_yet_established' ? 'Not yet established' : 'Existing',
            },
            { label: 'Opportunity', value: quote.opportunityName },
            { label: 'KAM', value: quote.kamName },
            { label: 'Request class', value: label('request_class', quote.requestClass) },
            { label: 'Market', value: label('market', quote.market) },
            { label: 'Product family', value: label('product_family', quote.productFamily) },
            { label: 'Resin', value: label('resin', quote.resin) },
            {
              label: 'Components',
              value: quote.components.map((c) => label('component', c)).join(', '),
            },
            { label: 'Neck finish', value: label('neck_finish', quote.neckFinish) },
            {
              label: 'Annual volume',
              value: quote.estAnnualVolume?.toLocaleString('en-US'),
            },
            {
              label: 'Annual revenue',
              value:
                quote.estAnnualRevenue != null
                  ? `$${quote.estAnnualRevenue.toLocaleString('en-US')}`
                  : null,
            },
            { label: 'Expected close', value: quote.expectedCloseDate },
            { label: 'Drawing', value: label('drawing_status', quote.drawingStatus) },
            { label: 'Packaging', value: label('packaging_type', quote.packagingType) },
            {
              label: 'Ship-to',
              value: ship
                ? [ship.line1, ship.city, ship.state, ship.postal].filter(Boolean).join(', ')
                : null,
            },
            {
              id: 'desc',
              label: 'Description',
              value: quote.standardDescription ?? quote.description,
            },
            { label: 'Comments for Engineering', value: quote.commentsForEngineering },
            {
              label: 'Submitted',
              value: quote.submittedAt
                ? new Date(quote.submittedAt).toLocaleString()
                : 'Not submitted',
            },
            { label: 'Stage', value: stageLabel(config, quote.stageKey) },
          ]}
        />
      </CardContent>
    </Card>
  );
}

function DecisionsCard({ quote }: { quote: QuoteDetail }) {
  const { data: config } = usePublicConfig();
  const outcomeLabel = (gate: string, key: string) =>
    config?.outcomes.find((o) => o.gateKey === gate && o.key === key)?.label ?? key;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Gate decisions</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {quote.decisions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No decisions yet.</p>
        ) : (
          <ol className="grid gap-3" data-testid="decisions">
            {quote.decisions.map((d) => (
              <li key={d.id} className="grid gap-0.5 text-sm">
                <span className="font-medium">
                  {d.gateKey} · {outcomeLabel(d.gateKey, d.outcomeKey)}
                  {d.reasonCode ? ` (${d.reasonCode})` : ''}
                </span>
                {d.note && <span className="text-foreground-2">{d.note}</span>}
                <span className="text-muted-foreground text-xs">
                  {d.decidedByName ?? 'Unknown'} · {new Date(d.decidedAt).toLocaleString()} · v
                  {d.quoteVersion}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
