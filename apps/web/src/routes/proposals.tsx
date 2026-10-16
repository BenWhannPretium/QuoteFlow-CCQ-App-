import type { OpenProposal } from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { FileClockIcon } from 'lucide-react';
import { useState } from 'react';

import { ForbiddenPage, useCan } from '@/auth';
import {
  EmptyState,
  ErrorState,
  GateDecisionDialog,
  PageHeader,
  PriorityBadge,
  SkeletonRows,
} from '@/components';
import { SfStageCompare, ValidityChip } from '@/components/outcome/CustomerDecision';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export const Route = createFileRoute('/proposals')({ component: MyProposalsPage });

/** Invalidated by the decision dialog after any gate decision. */
const myProposalsQueryKey = ['my-proposals'] as const;

/**
 * "My open proposals" (B-13): the KAM's quotes waiting for the customer, soonest validity end first,
 * with the countdown (amber ≤ 7 days, red once expired) and the Salesforce stage side by side. Each
 * card records the outcome (G5) in the generic decision dialog. The API scopes the list to the caller.
 */
function MyProposalsPage() {
  const canRecord = useCan('outcome.record');
  useDocumentTitle('My open proposals');
  const [deciding, setDeciding] = useState<string | null>(null);
  const list = useQuery({
    queryKey: myProposalsQueryKey,
    queryFn: () => api.myProposals(),
    enabled: canRecord,
  });

  if (!canRecord) return <ForbiddenPage />;
  const data = list.data;

  return (
    <div className="grid gap-6" data-testid="my-proposals">
      <PageHeader
        className="mb-0"
        title="My open proposals"
        eyebrow="Customer decision"
        description="Proposals waiting for the customer, the soonest to lapse first. Record the outcome as soon as you hear: an expired proposal is not a lost one."
      />
      {data && (
        <p
          className="text-foreground-2 flex flex-wrap gap-x-4 gap-y-1 text-sm"
          data-testid="proposal-counts"
        >
          <span>{data.counts.total} open</span>
          <span>{data.counts.expiring} expiring soon</span>
          <span>{data.counts.expired} past validity</span>
          <span>{data.counts.onHold} on hold</span>
          {data.counts.sfMismatch > 0 && <span>{data.counts.sfMismatch} SF mismatch</span>}
        </p>
      )}
      {list.isPending ? (
        <SkeletonRows rows={4} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : data!.items.length === 0 ? (
        <EmptyState
          icon={FileClockIcon}
          title="No open proposals"
          description="Quotes appear here once Final Review releases them to you."
        />
      ) : (
        <ul className="grid gap-3">
          {data!.items.map((p) => (
            <ProposalCard key={p.id} proposal={p} onRecord={() => setDeciding(p.quoteNumber)} />
          ))}
        </ul>
      )}
      {deciding && (
        <GateDecisionDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeciding(null);
          }}
          gateKey="G5"
          quoteNumber={deciding}
        />
      )}
    </div>
  );
}

function ProposalCard({ proposal: p, onRecord }: { proposal: OpenProposal; onRecord: () => void }) {
  return (
    <li data-testid="proposal-card" data-quote={p.quoteNumber}>
      <Card>
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="grid min-w-0 gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/quotes/$quoteNumber"
                params={{ quoteNumber: p.quoteNumber }}
                className="font-semibold underline-offset-4 hover:underline"
              >
                {p.quoteNumber}
              </Link>
              <ValidityChip validity={p.validity} />
              {p.status === 'on_hold' && (
                <span className="text-foreground-2 text-xs">
                  On hold{p.reviewDate ? ` until ${p.reviewDate}` : ''}
                </span>
              )}
              <PriorityBadge priority={p.priority} quoteNumber={p.quoteNumber} />
            </div>
            <p className="text-foreground-2 truncate text-sm">
              {[p.customerName, p.opportunityName].filter(Boolean).join(' · ')}
            </p>
            <p className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>
                Issued {p.proposalIssuedAt ? absoluteTime(p.proposalIssuedAt) : '–'}, valid until{' '}
                {p.validity.validityUntil ?? '–'}
              </span>
              <span className="inline-flex items-center gap-1">
                Salesforce: <SfStageCompare sf={p.sf} />
              </span>
            </p>
          </div>
          <Button onClick={onRecord} className="justify-self-start sm:justify-self-end">
            Record outcome
          </Button>
        </CardContent>
      </Card>
    </li>
  );
}
