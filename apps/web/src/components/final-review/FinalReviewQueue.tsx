import type { FinalReviewItem, FinalReviewQueueResponse } from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CheckIcon, InboxIcon, SearchIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { CapitalChip } from '@/components/pricing/CapitalChip';
import { CAPITAL_LABELS } from '@/components/pricing/QuotingTab';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePublicConfig } from '@/config/public-config';
import { api, type FinalReviewQueueParams } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { cn } from '@/lib/utils';

import { EmptyState } from '../EmptyState';
import { formatDuration } from '../engineering/format';
import { ErrorState } from '../ErrorState';
import {
  activeFilterCount,
  FiltersPopover,
  type FilterGroup,
  type FilterValue,
} from '../FiltersPopover';
import { PriorityBadge } from '../Priority';
import { SkeletonRows } from '../Skeletons';
import { finalReviewQueueKey } from './keys';

/**
 * Approvals → Final Review (B-12, G4): every quote waiting for the internal release decision, highest
 * tier first, then the longest waiting. A card per quote so an approver can work it from a phone (F-14);
 * the decision itself happens on the review screen, from its sticky decision bar. The API says per
 * quote whether the caller may decide it (segregation, approver tier) and why not.
 */
export function FinalReviewQueue() {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterValue>({});
  const params: FinalReviewQueueParams = {
    ...(filters.tier?.length ? { tier: filters.tier.join(',') } : {}),
    ...(filters.g2?.length ? { g2: filters.g2.join(',') } : {}),
    ...(filters.capital?.length ? { capital: filters.capital.join(',') } : {}),
    ...(search.trim() ? { q: search.trim() } : {}),
  };
  const queue = useQuery({
    queryKey: [...finalReviewQueueKey, params],
    queryFn: () => api.finalReviewQueue(params),
    placeholderData: (prev) => prev,
  });
  const data = queue.data;

  return (
    <section
      className="grid gap-4"
      aria-labelledby="final-review-heading"
      data-testid="final-review-queue"
    >
      <h2 id="final-review-heading" className="sr-only">
        Quotes waiting for Final Review
      </h2>
      {queue.isPending && <SkeletonRows rows={4} />}
      {queue.error && <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />}
      {data && (
        <>
          <Counts data={data} />
          <Toolbar
            data={data}
            search={search}
            onSearch={setSearch}
            filters={filters}
            onFilters={setFilters}
          />
          {data.items.length === 0 ? (
            <EmptyState
              icon={InboxIcon}
              title={
                data.total === 0
                  ? 'Nothing waiting for Final Review'
                  : 'No quotes match these filters'
              }
              description={
                data.total === 0
                  ? 'Quotes arrive here when Pricing submits them at G3. Approvers are notified.'
                  : 'Clear a filter or the search to see more.'
              }
            />
          ) : (
            <ol className="grid gap-3 lg:grid-cols-2" aria-label="Final Review queue">
              {data.items.map((item) => (
                <ApprovalCard key={item.id} item={item} canDecide={data.canDecide} />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

function Counts({ data }: { data: FinalReviewQueueResponse }) {
  const chips = [
    { key: 'waiting', label: 'Waiting', n: data.total },
    { key: 'flagged', label: 'Capital required / with risk (G2)', n: data.counts.flagged },
    { key: 'capital', label: 'Capital pending', n: data.counts.capitalPending },
    ...(data.canDecide
      ? [{ key: 'decidable', label: 'You can decide', n: data.counts.decidable }]
      : []),
  ];
  return (
    <ul className="flex flex-wrap gap-2" data-testid="final-review-counts">
      {chips.map((c) => (
        <li
          key={c.key}
          className="bg-secondary text-secondary-foreground rounded-pill inline-flex min-h-9 items-center gap-2 px-3 text-sm"
        >
          {c.label}
          <span className="font-semibold tabular-nums">{c.n}</span>
        </li>
      ))}
    </ul>
  );
}

function Toolbar({
  data,
  search,
  onSearch,
  filters,
  onFilters,
}: {
  data: FinalReviewQueueResponse;
  search: string;
  onSearch: (v: string) => void;
  filters: FilterValue;
  onFilters: (v: FilterValue) => void;
}) {
  const { data: config } = usePublicConfig();
  const searchId = useId();
  const groups: FilterGroup[] = [
    {
      key: 'tier',
      label: 'Tier',
      options: (config?.tiers ?? []).map((t) => ({ value: t.tier, label: t.label })),
    },
    {
      key: 'g2',
      label: 'Engineering outcome (G2)',
      options: data.g2Outcomes.map((o) => ({ value: o.key, label: o.label })),
    },
    {
      key: 'capital',
      label: 'Capital readiness',
      options: [
        { value: 'none', label: 'Not recorded' },
        ...Object.entries(CAPITAL_LABELS).map(([value, label]) => ({ value, label })),
      ],
    },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 sm:flex-none">
        <label htmlFor={searchId} className="sr-only">
          Search Final Review
        </label>
        <SearchIcon
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          id={searchId}
          type="search"
          placeholder="Quote, customer, KAM, ERF…"
          className="h-11 w-full pl-8 sm:w-64"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <FiltersPopover groups={groups} value={filters} onChange={onFilters} />
      {activeFilterCount(filters) > 0 && (
        <button
          type="button"
          className="text-emphasis min-h-11 px-2 text-sm underline"
          onClick={() => onFilters({})}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function ApprovalCard({ item, canDecide }: { item: FinalReviewItem; canDecide: boolean }) {
  const { data: config } = usePublicConfig();
  const label = (list: string, code: string | null) =>
    code ? (config?.valueLists[list]?.find((v) => v.code === code)?.label ?? code) : null;
  // The accessible name starts with the visible text (WCAG 2.5.3) and adds the quote it belongs to.
  const reviewLabel = item.canDecide && canDecide ? 'Review & decide' : 'Open review';
  const product =
    item.productSummary ??
    ([label('product_family', item.productFamily), label('resin', item.resin)]
      .filter(Boolean)
      .join(' · ') ||
      null);

  return (
    <li
      className="bg-card rounded-card grid content-start gap-3 border p-4"
      data-testid="final-review-item"
      data-quote={item.quoteNumber}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={item.priority} quoteNumber={item.quoteNumber} showWhy={false} />
          <Link
            to="/quotes/$quoteNumber/review"
            params={{ quoteNumber: item.quoteNumber }}
            className="text-emphasis inline-flex min-h-11 items-center font-semibold underline-offset-4 hover:underline"
          >
            {item.quoteNumber}
          </Link>
        </span>
        <span className="text-muted-foreground text-xs whitespace-nowrap" data-testid="waiting">
          Waiting {formatDuration(item.waitingMs)}
        </span>
      </div>

      <div className="grid gap-0.5">
        <p className="text-sm font-medium break-words">{item.customerName ?? 'Unknown customer'}</p>
        <p className="text-muted-foreground text-xs break-words">
          {[
            product,
            item.estAnnualVolume != null &&
              `${item.estAnnualVolume.toLocaleString('en-US')} units/yr`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div className="min-w-0">
          <dt className="text-muted-foreground text-xs font-medium">Price approval</dt>
          <dd data-testid="approval-status">
            {item.priceApproved ? (
              <span className="inline-flex items-center gap-1">
                <CheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
                Approved{item.priceApprovedAt ? ` ${absoluteTime(item.priceApprovedAt)}` : ''}
              </span>
            ) : (
              <span className="text-warning-foreground bg-warning rounded-pill px-2 py-0.5 text-xs">
                Not approved
              </span>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground text-xs font-medium">Capital readiness</dt>
          <dd>
            <CapitalChip value={item.capitalReadiness} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground text-xs font-medium">Engineering (G2)</dt>
          <dd
            className={cn(
              'inline-flex items-center gap-1 text-xs',
              item.g2Flag && 'text-warning-foreground bg-warning rounded-pill px-2 py-0.5',
            )}
            data-testid="g2-outcome"
          >
            {item.g2Flag && <TriangleAlertIcon className="size-3 shrink-0" aria-hidden="true" />}
            {item.g2OutcomeLabel ?? '–'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground text-xs font-medium">KAM</dt>
          <dd className="break-words">{item.kamName ?? '–'}</dd>
        </div>
        <div className="col-span-2 min-w-0">
          <dt className="text-muted-foreground text-xs font-medium">Pricing approver</dt>
          <dd className="break-words">{item.priceApproverName ?? '–'}</dd>
        </div>
      </dl>

      {item.blockedBy.length > 0 && (
        <p className="bg-secondary rounded-md px-3 py-2 text-sm" data-testid="blocked-by">
          {item.blockedBy.join(' ')}
        </p>
      )}

      <Link
        to="/quotes/$quoteNumber/review"
        params={{ quoteNumber: item.quoteNumber }}
        className={cn(
          buttonVariants({ variant: item.canDecide ? 'action' : 'outline' }),
          'min-h-11 w-full sm:w-auto sm:justify-self-end',
        )}
        aria-label={`${reviewLabel} ${item.quoteNumber}`}
      >
        {reviewLabel}
      </Link>
    </li>
  );
}
