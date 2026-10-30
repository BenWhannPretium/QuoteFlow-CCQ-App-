import type { PricingQueueItem, PricingQueueResponse } from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import {
  CheckIcon,
  HistoryIcon,
  InboxIcon,
  MoreHorizontalIcon,
  SearchIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { ForbiddenPage, useCan } from '@/auth';
import {
  DataTable,
  EmptyState,
  ErrorState,
  FiltersPopover,
  GateDecisionDialog,
  PageHeader,
  PriorityBadge,
  SkeletonRows,
  type FilterGroup,
  type FilterValue,
} from '@/components';
import { BulkReassignDialog } from '@/components/engineering/BulkReassignDialog';
import { formatDuration } from '@/components/engineering/format';
import { CapitalChip } from '@/components/pricing/CapitalChip';
import { PricerAssignDialog } from '@/components/pricing/PricerAssignDialog';
import { CAPITAL_LABELS, pricingQueueQueryKey } from '@/components/pricing/QuotingTab';
import { ReviewTabs, type ReviewTab } from '@/components/ReviewTabs';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input, NativeSelect } from '@/components/ui/input';
import { usePublicConfig } from '@/config/public-config';
import { api, type PricingQueueParams } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export const Route = createFileRoute('/queue/pricing')({
  component: PricingQueuePage,
});

/**
 * The pricing queue (B-11, DEC-19/20): every quote in Quoting, highest priority first, then the
 * longest waiting. B-26 (A6): the pricing lead assigns each quote to a pricer (and can move a pricer's
 * work in bulk); everyone can filter to their own. Pricing records the approval and submits to Final
 * Review; Leadership reads. The
 * API decides who may do what, and no price figure is shown or edited here (DEC-23, PRD §9).
 */
function PricingQueuePage() {
  const canRead = useCan('pricingQueue.read');
  useDocumentTitle('Pricing queue');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterValue>({});
  const [approved, setApproved] = useState<'' | 'yes' | 'no'>('');
  const [pricer, setPricer] = useState('');
  const [tab, setTab] = useState<ReviewTab>('all');
  const params: PricingQueueParams = {
    ...(tab === 'ready' ? { review: 'ready' as const } : {}),
    ...(filters.tier?.length ? { tier: filters.tier.join(',') } : {}),
    ...(filters.g2?.length ? { g2: filters.g2.join(',') } : {}),
    ...(filters.capital?.length ? { capital: filters.capital.join(',') } : {}),
    ...(filters.productFamily?.length ? { productFamily: filters.productFamily.join(',') } : {}),
    ...(approved ? { approved } : {}),
    ...(pricer ? { pricer } : {}),
    ...(search.trim() ? { q: search.trim() } : {}),
  };
  const queue = useQuery({
    queryKey: [...pricingQueueQueryKey, params],
    queryFn: () => api.pricingQueue(params),
    enabled: canRead,
    placeholderData: (prev) => prev,
  });

  if (!canRead) return <ForbiddenPage />;
  const data = queue.data;

  return (
    <div className="grid gap-6" data-testid="pricing-queue">
      <PageHeader
        className="mb-0"
        title="Pricing queue"
        eyebrow="Pricing"
        description="Every quote in Quoting, highest priority first, then the longest waiting. Record the price approval and capital readiness, then submit to Final Review."
        actions={
          // B-15: the retired pricing app's history (ERF, BPR, SPR), imported into CCQ.
          <Link
            to="/pricing-history"
            search={{ kind: 'erf' }}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            data-testid="pricing-history-nav"
          >
            <HistoryIcon className="size-4" aria-hidden="true" />
            Pricing history
          </Link>
        }
      />
      {queue.isPending && <SkeletonRows rows={6} />}
      {queue.error && <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />}
      {data && (
        <>
          {data.canDecide && (
            <ReviewTabs value={tab} onChange={setTab} readyCount={data.readyForReview} />
          )}
          <Counts data={data} />
          <section className="grid gap-3" aria-labelledby="pricing-queue-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="pricing-queue-heading" className="text-base font-semibold">
                Queue{' '}
                <span className="text-muted-foreground font-normal">
                  (
                  {data.items.length === data.total
                    ? data.total
                    : `${data.items.length} of ${data.total}`}
                  )
                </span>
              </h2>
              <Toolbar
                data={data}
                search={search}
                onSearch={setSearch}
                filters={filters}
                onFilters={setFilters}
                approved={approved}
                onApproved={setApproved}
                pricer={pricer}
                onPricer={setPricer}
              />
            </div>
            <QueueTable data={data} />
          </section>
        </>
      )}
    </div>
  );
}

function Counts({ data }: { data: PricingQueueResponse }) {
  const chips = [
    { key: 'awaiting', label: 'Awaiting price approval', n: data.counts.awaitingApproval },
    { key: 'capital', label: 'Capital pending', n: data.counts.capitalPending },
    { key: 'flagged', label: 'Capital required / with risk (G2)', n: data.counts.flagged },
  ];
  return (
    <ul className="flex flex-wrap gap-2" data-testid="pricing-counts">
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
  approved,
  onApproved,
  pricer,
  onPricer,
}: {
  data: PricingQueueResponse;
  search: string;
  onSearch: (v: string) => void;
  filters: FilterValue;
  onFilters: (v: FilterValue) => void;
  approved: '' | 'yes' | 'no';
  onApproved: (v: '' | 'yes' | 'no') => void;
  pricer: string;
  onPricer: (v: string) => void;
}) {
  const { data: config } = usePublicConfig();
  const ids = { search: useId(), approved: useId(), pricer: useId() };
  const [reassigning, setReassigning] = useState(false);
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
    {
      key: 'productFamily',
      label: 'Product family',
      options: (config?.valueLists.product_family ?? []).map((v) => ({
        value: v.code,
        label: v.label,
      })),
    },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <label htmlFor={ids.search} className="sr-only">
          Search the pricing queue
        </label>
        <SearchIcon
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          id={ids.search}
          type="search"
          placeholder="Quote, customer, ERF…"
          className="h-9 w-56 pl-8"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <label htmlFor={ids.approved} className="sr-only">
        Price approval
      </label>
      <NativeSelect
        id={ids.approved}
        className="h-9 w-auto"
        value={approved}
        onChange={(e) => onApproved(e.target.value as '' | 'yes' | 'no')}
      >
        <option value="">Any approval</option>
        <option value="no">Awaiting approval</option>
        <option value="yes">Price approved</option>
      </NativeSelect>
      <label htmlFor={ids.pricer} className="sr-only">
        Pricer
      </label>
      <NativeSelect
        id={ids.pricer}
        className="h-9 w-auto"
        value={pricer}
        onChange={(e) => onPricer(e.target.value)}
        data-testid="pricer-filter"
      >
        <option value="">Any pricer</option>
        <option value="me">Assigned to me</option>
        <option value="unassigned">Unassigned</option>
        {data.pricers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayName}
          </option>
        ))}
      </NativeSelect>
      <FiltersPopover groups={groups} value={filters} onChange={onFilters} />
      {data.canAssign && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setReassigning(true)}
          data-testid="reassign-pricing-work"
        >
          Reassign work…
        </Button>
      )}
      {reassigning && (
        <BulkReassignDialog
          open
          onOpenChange={setReassigning}
          title="Reassign a pricer's work"
          noun="pricer"
          people={data.pricers.map((p) => ({
            id: p.id,
            displayName: p.displayName,
            openCount: p.openAssigned,
          }))}
          queryKey={pricingQueueQueryKey}
          reassign={api.bulkReassignPricing}
        />
      )}
    </div>
  );
}

/** Like the engineering queue: assign one or several quotes, or move them off one pricer. */
type AssignDialogState =
  | { kind: 'assign'; quoteNumbers: string[]; current?: string | null }
  | { kind: 'reassign'; quoteNumbers: string[] };

function QueueTable({ data }: { data: PricingQueueResponse }) {
  const { data: config } = usePublicConfig();
  const navigate = useNavigate();
  const [deciding, setDeciding] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<AssignDialogState | null>(null);
  const label = (list: string, code: string | null) =>
    code ? (config?.valueLists[list]?.find((v) => v.code === code)?.label ?? code) : null;

  const visibleIds = new Set(data.items.map((i) => i.quoteNumber));
  const chosen = selected.filter((qn) => visibleIds.has(qn));

  const columns = useMemo<ColumnDef<PricingQueueItem>[]>(() => {
    const cols: ColumnDef<PricingQueueItem>[] = [];
    if (data.canAssign) {
      cols.push({
        id: 'select',
        enableSorting: false,
        meta: { hideOnMobile: true },
        header: () => (
          <input
            type="checkbox"
            aria-label="Select all quotes in view"
            className="size-4 accent-[var(--primary)]"
            checked={
              data.items.length > 0 && data.items.every((i) => selected.includes(i.quoteNumber))
            }
            onChange={(e) =>
              setSelected(e.target.checked ? data.items.map((i) => i.quoteNumber) : [])
            }
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select ${row.original.quoteNumber}`}
            className="size-4 accent-[var(--primary)]"
            checked={selected.includes(row.original.quoteNumber)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              setSelected((s) =>
                e.target.checked
                  ? [...s, row.original.quoteNumber]
                  : s.filter((x) => x !== row.original.quoteNumber),
              )
            }
          />
        ),
      });
    }
    cols.push(
      {
        id: 'priority',
        header: 'Tier',
        accessorFn: (q) => q.priority.score ?? -1,
        cell: ({ row }) => (
          <PriorityBadge
            priority={row.original.priority}
            quoteNumber={row.original.quoteNumber}
            showWhy={false}
          />
        ),
      },
      {
        id: 'quote',
        header: 'Quote',
        accessorKey: 'quoteNumber',
        meta: { primary: true },
        cell: ({ row }) => {
          const q = row.original;
          return (
            <span className="grid gap-1">
              <Link
                to="/quotes/$quoteNumber"
                params={{ quoteNumber: q.quoteNumber }}
                search={{ tab: 'quoting' }}
                className="text-emphasis font-semibold whitespace-nowrap underline-offset-4 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {q.quoteNumber}
              </Link>
              <span className="text-muted-foreground text-xs" data-testid="approval-status">
                {q.status === 'on_hold' ? (
                  `On hold${q.reviewDate ? ` until ${q.reviewDate}` : ''}`
                ) : q.priceApproved ? (
                  <span className="inline-flex items-center gap-1">
                    <CheckIcon className="size-3" aria-hidden="true" />
                    Price approved{q.priceApprovedAt ? ` ${absoluteTime(q.priceApprovedAt)}` : ''}
                  </span>
                ) : (
                  'Awaiting approval'
                )}
              </span>
            </span>
          );
        },
      },
      {
        id: 'account',
        header: 'Account',
        accessorFn: (q) => q.customerName ?? '',
        cell: ({ row }) => (
          <span className="grid max-w-56 min-w-0 gap-0.5">
            <span className="break-words">{row.original.customerName ?? 'Unknown customer'}</span>
            <span className="text-muted-foreground text-xs break-words">
              {row.original.opportunityName}
            </span>
          </span>
        ),
      },
      {
        id: 'product',
        header: 'Product',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block max-w-64 text-xs break-words">
            {row.original.productSummary ??
              label('product_family', row.original.productFamily) ??
              '–'}
          </span>
        ),
      },
      {
        id: 'volume',
        header: 'Volume / yr',
        accessorFn: (q) => q.estAnnualVolume ?? -1,
        meta: { numeric: true },
        cell: ({ row }) => row.original.estAnnualVolume?.toLocaleString('en-US') ?? '–',
      },
      {
        id: 'g2',
        header: 'G2 outcome',
        accessorFn: (q) => q.g2OutcomeLabel ?? '',
        cell: ({ row }) => {
          const q = row.original;
          if (!q.g2OutcomeLabel) return <span className="text-muted-foreground">–</span>;
          return (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs whitespace-nowrap',
                q.g2Flag && 'text-warning-foreground bg-warning rounded-pill px-2 py-0.5',
              )}
              data-testid="g2-outcome"
            >
              {q.g2Flag && <TriangleAlertIcon className="size-3" aria-hidden="true" />}
              {q.g2OutcomeLabel}
            </span>
          );
        },
      },
      {
        id: 'capital',
        header: 'Capital readiness',
        accessorFn: (q) => q.capitalReadiness ?? '',
        cell: ({ row }) => <CapitalChip value={row.original.capitalReadiness} />,
      },
      {
        id: 'time',
        header: 'In Quoting',
        accessorKey: 'activeMsInStage',
        meta: { numeric: true },
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{formatDuration(row.original.activeMsInStage)}</span>
        ),
      },
      { id: 'kam', header: 'KAM', accessorFn: (q) => q.kamName ?? '' },
      {
        id: 'pricer',
        header: 'Pricer',
        accessorFn: (q) => q.assignedPricerName ?? '',
        cell: ({ row }) =>
          row.original.assignedPricerName ? (
            <span className="grid">
              <span data-testid="assigned-pricer">{row.original.assignedPricerName}</span>
              {row.original.leadReview !== 'none' && (
                <span className="text-muted-foreground text-xs" data-testid="lead-review-status">
                  {row.original.leadReview === 'submitted'
                    ? 'Ready for lead review'
                    : 'Sent back by lead'}
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">Unassigned</span>
          ),
      },
      {
        id: 'engineer',
        header: 'Engineer',
        accessorFn: (q) => q.assignedEngineerName ?? '',
        cell: ({ row }) =>
          row.original.assignedEngineerName ?? <span className="text-muted-foreground">–</span>,
      },
    );
    cols.push({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      cell: ({ row }) => {
        const q = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Actions for ${q.quoteNumber}`}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontalIcon aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() =>
                  void navigate({
                    to: '/quotes/$quoteNumber',
                    params: { quoteNumber: q.quoteNumber },
                    search: { tab: 'quoting' },
                  })
                }
              >
                {q.canEdit ? 'Record price approval' : 'Open Quoting'}
              </DropdownMenuItem>
              {data.canAssign && (
                <DropdownMenuItem
                  onSelect={() =>
                    setDialog({
                      kind: 'assign',
                      quoteNumbers: [q.quoteNumber],
                      current: q.assignedPricerId,
                    })
                  }
                >
                  {q.assignedPricerId ? 'Reassign pricer…' : 'Assign pricer…'}
                </DropdownMenuItem>
              )}
              {data.canDecide && q.canEdit && (
                <DropdownMenuItem onSelect={() => setDeciding(q.quoteNumber)}>
                  Decide G3…
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    });
    return cols;
    // The label helper changes every render; the table only needs the data and config.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, config, selected]);

  return (
    <div className="grid gap-3">
      {data.canAssign && chosen.length > 0 && (
        <div
          className="bg-secondary flex flex-wrap items-center gap-3 rounded-md px-3 py-2 text-sm"
          role="region"
          aria-label="Bulk actions"
        >
          <span>{chosen.length} selected</span>
          <Button size="sm" onClick={() => setDialog({ kind: 'assign', quoteNumbers: chosen })}>
            Assign selected…
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDialog({ kind: 'reassign', quoteNumbers: chosen })}
          >
            Move selected from one pricer…
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
      )}
      <DataTable
        caption="Pricing queue"
        columns={columns}
        data={data.items}
        getRowId={(q) => q.quoteNumber}
        empty={
          <EmptyState
            icon={InboxIcon}
            title={
              data.total === 0 ? 'Nothing waiting for pricing' : 'No quotes match these filters'
            }
            description={
              data.total === 0
                ? 'Quotes arrive here when Engineering clears them at G2. Pricing is notified.'
                : 'Clear a filter or the search to see more.'
            }
          />
        }
      />
      {dialog?.kind === 'assign' && (
        <PricerAssignDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          quoteNumbers={dialog.quoteNumbers}
          currentPricerId={dialog.current ?? null}
          pricers={data.pricers}
          onDone={() => setSelected([])}
        />
      )}
      {dialog?.kind === 'reassign' && (
        <BulkReassignDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title="Reassign a pricer's work"
          noun="pricer"
          people={data.pricers.map((p) => ({
            id: p.id,
            displayName: p.displayName,
            openCount: p.openAssigned,
          }))}
          quoteNumbers={dialog.quoteNumbers}
          queryKey={pricingQueueQueryKey}
          reassign={api.bulkReassignPricing}
          onDone={() => setSelected([])}
        />
      )}
      {deciding && (
        <GateDecisionDialog
          open
          onOpenChange={(open) => !open && setDeciding(null)}
          gateKey="G3"
          quoteNumber={deciding}
        />
      )}
    </div>
  );
}
