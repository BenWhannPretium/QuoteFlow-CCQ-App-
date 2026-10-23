import { PricingHistoryKind } from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { HistoryIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';

import { ForbiddenPage, useCan } from '@/auth';
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '@/components';
import { RecordRow } from '@/components/pricing/history';
import { PricingHistoryUnavailable } from '@/components/pricing/PricingContextPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

const Search = z.object({
  kind: PricingHistoryKind.catch('erf'),
  customer: z.string().optional().catch(undefined),
  q: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/pricing-history')({
  validateSearch: Search,
  component: PricingHistoryPage,
});

const KINDS = [
  { key: 'erf', label: 'ERF', hint: 'Engineering request forms' },
  { key: 'bpr', label: 'BPR', hint: 'Price implementations' },
  { key: 'spr', label: 'SPR', hint: 'Stock pricing (retired Nov 2025)' },
] as const;

/**
 * B-15 (F-11), revised: search the retired pricing app's history (ERF, BPR, SPR), imported into CCQ
 * from its export. For the commercial roles; the API enforces it (403) and RLS limits the table. BPRs
 * appear only here, never on a quote (B-26). Read-only.
 */
function PricingHistoryPage() {
  const canRead = useCan('quote.read.commercialFields');
  useDocumentTitle('Pricing history');
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/pricing-history' });
  const [customer, setCustomer] = useState(search.customer ?? '');
  const [q, setQ] = useState(search.q ?? '');
  const ready = (search.customer?.trim().length ?? 0) >= 2 || (search.q?.trim().length ?? 0) >= 2;
  const results = useQuery({
    queryKey: ['pricing-history', search],
    queryFn: () =>
      api.pricingHistory({
        kind: search.kind,
        ...(search.customer?.trim() ? { customer: search.customer.trim() } : {}),
        ...(search.q?.trim() ? { q: search.q.trim() } : {}),
        limit: 50,
      }),
    enabled: canRead && ready,
    placeholderData: (prev) => prev,
  });

  if (!canRead) return <ForbiddenPage />;
  const go = (next: Partial<z.infer<typeof Search>>) =>
    void navigate({ search: (s) => ({ ...s, ...next }), replace: true });
  const source = results.data?.source;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Pricing history"
        description="ERFs, BPRs and SPRs from the retired pricing app, imported from its export. Read-only."
      />
      <form
        className="grid gap-3"
        role="search"
        aria-label="Search the pricing history"
        onSubmit={(e) => {
          e.preventDefault();
          go({ customer: customer.trim() || undefined, q: q.trim() || undefined });
        }}
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label="Record type">
          {KINDS.map((k) => (
            <Button
              key={k.key}
              type="button"
              size="sm"
              variant={search.kind === k.key ? 'primary' : 'outline'}
              aria-pressed={search.kind === k.key}
              title={k.hint}
              onClick={() => go({ kind: k.key })}
              data-testid={`history-kind-${k.key}`}
            >
              {k.label}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Customer</span>
            <Input
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="Customer name contains…"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Number, product or item</span>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. ERF25-123" />
          </label>
          <Button type="submit" className="self-end">
            <SearchIcon className="size-4" aria-hidden="true" />
            Search
          </Button>
        </div>
      </form>

      {!ready ? (
        <EmptyState
          icon={HistoryIcon}
          title="Search the pricing history"
          description="Give a customer or a number, product or item (at least 2 characters)."
        />
      ) : results.isPending ? (
        <SkeletonRows rows={5} />
      ) : results.isError ? (
        <ErrorState error={results.error} onRetry={() => void results.refetch()} />
      ) : !source?.imported ? (
        <PricingHistoryUnavailable notImported />
      ) : results.data.historyRecords.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title="Nothing found"
          description="The export has no Salesforce id: try part of the customer name, or another spelling."
        />
      ) : (
        <section className="grid gap-2" aria-label="Results">
          <p className={cn('text-muted-foreground text-sm')} data-testid="history-count">
            {results.data.historyRecords.length}
            {results.data.truncated ? '+ (narrow the search to see more)' : ''} result
            {results.data.historyRecords.length === 1 ? '' : 's'}, newest first
          </p>
          <ul className="grid gap-2" data-testid="history-results">
            {results.data.historyRecords.map((r) => (
              <RecordRow key={`${r.kind}-${r.requestNumber}-${r.submittedOn ?? ''}`} record={r} />
            ))}
          </ul>
        </section>
      )}
      {source?.imported && (
        <p className="text-muted-foreground text-xs">
          {source.counts.erf.toLocaleString()} ERFs, {source.counts.bpr.toLocaleString()} BPRs and{' '}
          {source.counts.spr.toLocaleString()} SPRs
          {source.importedAt ? `, imported ${absoluteTime(source.importedAt)}` : ''}. Estimates and
          prices the old app left blank (or wrote as 0) show as Unknown.
        </p>
      )}
    </div>
  );
}
