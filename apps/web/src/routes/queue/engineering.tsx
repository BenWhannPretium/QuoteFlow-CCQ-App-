import type { AgingBucket, EngQueueItem, EngQueueResponse } from '@ccq/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { CircleAlertIcon, InboxIcon, MoreHorizontalIcon, PinIcon, SearchIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { ForbiddenPage, useCan, useCurrentUser } from '@/auth';
import {
  DataTable,
  EmptyState,
  ErrorState,
  FiltersPopover,
  GateDecisionDialog,
  OverrideDialog,
  PageHeader,
  PriorityBadge,
  SkeletonRows,
  type FilterGroup,
  type FilterValue,
} from '@/components';
import { AssignDialog, engQueueQueryKey } from '@/components/engineering/AssignDialog';
import { BulkReassignDialog } from '@/components/engineering/BulkReassignDialog';
import { businessDays } from '@/components/engineering/format';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input, NativeSelect } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePublicConfig } from '@/config/public-config';
import { api, isApiError, type EngQueueParams } from '@/lib/api';
import { relativeTime } from '@/lib/time';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export const Route = createFileRoute('/queue/engineering')({
  component: EngineeringQueuePage,
});

const BUCKETS: AgingBucket[] = ['fresh', 'aging', 'old'];
const BUCKET_STYLE: Record<AgingBucket, string> = {
  fresh: 'bg-secondary text-secondary-foreground',
  aging: 'bg-warning text-warning-foreground',
  old: 'bg-destructive text-destructive-foreground',
};
const STATUS_LABEL: Record<EngQueueItem['queueStatus'], string> = {
  unassigned: 'Unassigned',
  assigned: 'Awaiting acceptance',
  accepted: 'In review',
};

/**
 * The engineering queue (F-04, DEC-26): a manual, prioritized queue the upfront engineering lead
 * works by hand. EngLead (and Admin / a backup assigner) assign, accept, return and pin; an Engineer
 * sees "My assignments" and the queue read-only; Leadership reads. The API decides who may do what.
 */
function EngineeringQueuePage() {
  const canRead = useCan('engQueue.read');
  const ownsQueue = useCan('queue.assign');
  const isEngineer = useCan('engReview.edit') && !ownsQueue;
  const title = isEngineer ? 'My assignments' : 'Engineering queue';
  useDocumentTitle(title);

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterValue>({});
  const [buckets, setBuckets] = useState<AgingBucket[]>([]);
  const [agedOver, setAgedOver] = useState('');
  const params: EngQueueParams = {
    ...(filters.tier?.length ? { tier: filters.tier.join(',') } : {}),
    ...(filters.engineer?.length === 1 ? { engineer: filters.engineer[0] } : {}),
    ...(filters.productFamily?.length ? { productFamily: filters.productFamily.join(',') } : {}),
    ...(buckets.length ? { bucket: buckets.join(',') } : {}),
    ...(agedOver ? { agedOver: Number(agedOver) } : {}),
    ...(search.trim() ? { q: search.trim() } : {}),
  };
  const queue = useQuery({
    queryKey: [...engQueueQueryKey, params],
    queryFn: () => api.engQueue(params),
    enabled: canRead,
    placeholderData: (prev) => prev,
  });

  if (!canRead) return <ForbiddenPage />;
  const data = queue.data;

  return (
    <div className="grid gap-6" data-testid="eng-queue" data-page-title={title}>
      <PageHeader
        className="mb-0"
        title={title}
        eyebrow="Engineering"
        description={
          isEngineer
            ? 'Your engineering reviews first, then the whole queue (read-only).'
            : 'Every quote in Engineering Review, highest priority first. You assign by hand (DEC-26); the score only orders the list.'
        }
      />
      {queue.isPending && <SkeletonRows rows={6} />}
      {queue.error && <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />}
      {data && (
        <>
          <AgingChips data={data} selected={buckets} onChange={setBuckets} />
          {isEngineer && <MyAssignments data={data} />}
          <section className="grid gap-3" aria-labelledby="queue-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="queue-heading" className="text-base font-semibold">
                {isEngineer ? 'Engineering queue' : 'Queue'}{' '}
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
                agedOver={agedOver}
                onAgedOver={setAgedOver}
              />
            </div>
            <QueueTable data={data} />
          </section>
        </>
      )}
    </div>
  );
}

/** Header chips: how many quotes sit in each aging bucket (business days). Click to filter. */
function AgingChips({
  data,
  selected,
  onChange,
}: {
  data: EngQueueResponse;
  selected: AgingBucket[];
  onChange: (next: AgingBucket[]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="aging-chips">
      <span className="text-muted-foreground text-sm">
        In queue ({data.total}), by business days:
      </span>
      {BUCKETS.map((b) => {
        const on = selected.includes(b);
        return (
          <button
            key={b}
            type="button"
            aria-pressed={on}
            data-bucket={b}
            onClick={() => onChange(on ? selected.filter((x) => x !== b) : [...selected, b])}
            className={cn(
              'rounded-pill inline-flex min-h-9 items-center gap-2 border px-3 text-sm',
              on ? 'border-primary ring-ring ring-2' : 'border-transparent',
              BUCKET_STYLE[b],
            )}
          >
            <span>{data.aging.labels[b]}</span>
            <span className="font-semibold tabular-nums">{data.aging.counts[b]}</span>
          </button>
        );
      })}
      <span className="text-muted-foreground text-xs">Buckets, not an SLA (D-20).</span>
    </div>
  );
}

function Toolbar({
  data,
  search,
  onSearch,
  filters,
  onFilters,
  agedOver,
  onAgedOver,
}: {
  data: EngQueueResponse;
  search: string;
  onSearch: (v: string) => void;
  filters: FilterValue;
  onFilters: (v: FilterValue) => void;
  agedOver: string;
  onAgedOver: (v: string) => void;
}) {
  const { data: config } = usePublicConfig();
  const ids = { search: useId(), aged: useId() };
  const engineers = data.engineers.length
    ? data.engineers.map((e) => ({ value: e.id, label: e.displayName }))
    : [
        ...new Map(
          data.items
            .filter((i) => i.assignedEngineerId)
            .map((i) => [i.assignedEngineerId!, i.assignedEngineerName ?? 'Unknown']),
        ),
      ].map(([value, label]) => ({ value, label }));
  const groups: FilterGroup[] = [
    {
      key: 'tier',
      label: 'Tier',
      options: (config?.tiers ?? []).map((t) => ({ value: t.tier, label: t.label })),
    },
    {
      key: 'engineer',
      label: 'Engineer (pick one)',
      options: [{ value: 'unassigned', label: 'Unassigned' }, ...engineers],
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
          Search the queue
        </label>
        <SearchIcon
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          id={ids.search}
          type="search"
          placeholder="Quote, customer, KAM…"
          className="h-9 w-56 pl-8"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <label htmlFor={ids.aged} className="sr-only">
        Aged over
      </label>
      <NativeSelect
        id={ids.aged}
        className="h-9 w-auto"
        value={agedOver}
        onChange={(e) => onAgedOver(e.target.value)}
      >
        <option value="">Any age</option>
        <option value={String(data.aging.edges.aging - 1)}>
          Aged ≥ {data.aging.edges.aging} days
        </option>
        <option value={String(data.aging.edges.old)}>Aged &gt; {data.aging.edges.old} days</option>
      </NativeSelect>
      <FiltersPopover
        groups={groups}
        value={filters}
        onChange={(next) =>
          onFilters(
            next.engineer && next.engineer.length > 1
              ? { ...next, engineer: next.engineer.slice(-1) }
              : next,
          )
        }
      />
    </div>
  );
}

function MyAssignments({ data }: { data: EngQueueResponse }) {
  return (
    <section className="grid gap-3" aria-labelledby="mine-heading" data-testid="my-assignments">
      <h2 id="mine-heading" className="text-base font-semibold">
        Assigned to me ({data.mine.length})
      </h2>
      {data.mine.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title="Nothing assigned to you"
          description="The engineering lead assigns reviews from the queue. You’ll get a notification."
        />
      ) : (
        <ol className="grid gap-2">
          {data.mine.map((q) => (
            <li
              key={q.id}
              className="bg-card rounded-card flex flex-wrap items-center gap-x-4 gap-y-1 border p-3 text-sm"
              data-testid="my-assignment"
              data-quote={q.quoteNumber}
            >
              <Link
                to="/quotes/$quoteNumber"
                params={{ quoteNumber: q.quoteNumber }}
                search={{ tab: 'engineering' }}
                className="text-emphasis font-semibold underline-offset-4 hover:underline"
              >
                {q.quoteNumber}
              </Link>
              <PriorityBadge priority={q.priority} quoteNumber={q.quoteNumber} showWhy={false} />
              <span className="min-w-0 break-words">{q.customerName ?? 'Unknown customer'}</span>
              <span className="text-muted-foreground">{STATUS_LABEL[q.queueStatus]}</span>
              <AgingCell item={q} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AgingCell({ item }: { item: EngQueueItem }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        className={cn('size-2 rounded-full', {
          'bg-primary': item.agingBucket === 'fresh',
          'bg-warning': item.agingBucket === 'aging',
          'bg-destructive': item.agingBucket === 'old',
        })}
        aria-hidden="true"
      />
      <span data-testid="days-in-queue">{businessDays(item.businessDaysInQueue)}</span>
    </span>
  );
}

type Dialog =
  | { kind: 'assign'; quoteNumbers: string[]; current?: string | null }
  | { kind: 'return'; quoteNumber: string }
  | { kind: 'pin'; item: EngQueueItem }
  | { kind: 'reassign'; quoteNumbers?: string[] };

function QueueTable({ data }: { data: EngQueueResponse }) {
  const { data: config } = usePublicConfig();
  const me = useCurrentUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const label = (list: string, code: string | null) =>
    code ? (config?.valueLists[list]?.find((v) => v.code === code)?.label ?? code) : null;
  const now = new Date();

  const accept = useMutation({
    mutationFn: (qn: string) => api.acceptEngReview(qn),
    onSuccess: async (_d, qn) => {
      await queryClient.invalidateQueries({ queryKey: engQueueQueryKey });
      toast.success({ title: `${qn} accepted`, description: 'The review is in progress.' });
    },
    onError: (err) =>
      toast.error({
        title: 'Could not accept',
        description: isApiError(err) ? (err.problem.detail ?? err.problem.title) : 'Try again.',
      }),
  });

  const visibleIds = new Set(data.items.map((i) => i.quoteNumber));
  const chosen = selected.filter((qn) => visibleIds.has(qn));

  const columns = useMemo<ColumnDef<EngQueueItem>[]>(() => {
    const cols: ColumnDef<EngQueueItem>[] = [];
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
        id: 'quote',
        header: 'Quote',
        accessorKey: 'quoteNumber',
        meta: { primary: true },
        cell: ({ row }) => {
          const q = row.original;
          return (
            <span className="grid gap-1">
              <span className="inline-flex items-center gap-1.5">
                {q.pinned && (
                  <PinIcon
                    className="text-emphasis size-3.5"
                    aria-label={`Pinned at #${q.queuePosition}`}
                  />
                )}
                <Link
                  to="/quotes/$quoteNumber"
                  params={{ quoteNumber: q.quoteNumber }}
                  search={{ tab: 'engineering' }}
                  className="text-emphasis font-semibold whitespace-nowrap underline-offset-4 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {q.quoteNumber}
                </Link>
              </span>
              <span className="text-muted-foreground text-xs" data-testid="queue-status">
                {q.status === 'on_hold'
                  ? `On hold${q.reviewDate ? ` until ${q.reviewDate}` : ''}`
                  : STATUS_LABEL[q.queueStatus]}
              </span>
            </span>
          );
        },
      },
      {
        id: 'priority',
        header: 'Priority',
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
        id: 'opportunity',
        header: 'Opportunity / account',
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
        header: 'Product / resin / volume',
        enableSorting: false,
        cell: ({ row }) => {
          const q = row.original;
          return (
            <span className="text-xs">
              {[
                label('product_family', q.productFamily),
                label('resin', q.resin),
                q.estAnnualVolume != null && `${q.estAnnualVolume.toLocaleString('en-US')}/yr`,
              ]
                .filter(Boolean)
                .join(' · ') || '–'}
            </span>
          );
        },
      },
      { id: 'kam', header: 'KAM', accessorFn: (q) => q.kamName ?? '' },
      {
        id: 'inQueue',
        header: 'In queue',
        accessorKey: 'businessDaysInQueue',
        meta: { numeric: true },
        cell: ({ row }) => <AgingCell item={row.original} />,
      },
      {
        id: 'assigned',
        header: 'Since assignment',
        accessorFn: (q) => (q.assignedAt ? -Date.parse(q.assignedAt) : Number.NEGATIVE_INFINITY),
        cell: ({ row }) =>
          row.original.assignedAt ? (
            <span className="whitespace-nowrap">{relativeTime(row.original.assignedAt, now)}</span>
          ) : (
            '–'
          ),
      },
      {
        id: 'engineer',
        header: 'Engineer',
        accessorFn: (q) => q.assignedEngineerName ?? '',
        cell: ({ row }) =>
          row.original.assignedEngineerName ?? (
            <span className="text-muted-foreground">Unassigned</span>
          ),
      },
      {
        id: 'drawing',
        header: 'Drawing',
        accessorFn: (q) => label('drawing_status', q.drawingStatus) ?? '',
      },
      {
        id: 'warnings',
        header: 'Warnings',
        accessorFn: (q) => q.completeness.length,
        meta: { numeric: true },
        cell: ({ row }) => <CompletenessCell item={row.original} />,
      },
      { id: 'close', header: 'SF close', accessorFn: (q) => q.sfCloseDate ?? '' },
    );
    if (data.canAssign || data.canDecide || data.canPin) {
      cols.push({
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const q = row.original;
          const canAccept =
            q.queueStatus === 'assigned' &&
            (data.canAssign || q.assignedEngineerId === me.user.id) &&
            q.canEdit;
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
                {data.canAssign && (
                  <DropdownMenuItem
                    onSelect={() =>
                      setDialog({
                        kind: 'assign',
                        quoteNumbers: [q.quoteNumber],
                        current: q.assignedEngineerId,
                      })
                    }
                  >
                    {q.assignedEngineerId ? 'Reassign…' : 'Assign…'}
                  </DropdownMenuItem>
                )}
                {canAccept && (
                  <DropdownMenuItem onSelect={() => accept.mutate(q.quoteNumber)}>
                    Accept (start review)
                  </DropdownMenuItem>
                )}
                {data.canDecide && q.status !== 'on_hold' && (
                  <DropdownMenuItem
                    onSelect={() => setDialog({ kind: 'return', quoteNumber: q.quoteNumber })}
                  >
                    Return to KAM…
                  </DropdownMenuItem>
                )}
                {data.canPin && (
                  <DropdownMenuItem onSelect={() => setDialog({ kind: 'pin', item: q })}>
                    {q.pinned ? 'Move pin…' : 'Pin to top…'}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() =>
                    void navigate({
                      to: '/quotes/$quoteNumber',
                      params: { quoteNumber: q.quoteNumber },
                      search: { tab: 'engineering' },
                    })
                  }
                >
                  Open Engineering Review
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      });
    }
    return cols;
    // `now` and the label helper change every render; the table only needs the data and selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selected, config, me.user.id]);

  return (
    <div className="grid gap-3">
      {data.canAssign && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDialog({ kind: 'reassign' })}
            data-testid="reassign-work"
          >
            Reassign work…
          </Button>
        </div>
      )}
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
            Move selected from one engineer…
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
      )}
      <DataTable
        caption="Engineering queue"
        columns={columns}
        data={data.items}
        getRowId={(q) => q.quoteNumber}
        empty={
          <EmptyState
            icon={InboxIcon}
            title={data.total === 0 ? 'The queue is empty' : 'No quotes match these filters'}
            description={
              data.total === 0
                ? 'Quotes arrive here when they pass G1. The engineering lead is alerted.'
                : 'Clear a filter or the search to see more.'
            }
          />
        }
      />
      {dialog?.kind === 'assign' && (
        <AssignDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          quoteNumbers={dialog.quoteNumbers}
          engineers={data.engineers}
          currentEngineerId={dialog.current ?? null}
          onDone={() => setSelected([])}
        />
      )}
      {dialog?.kind === 'reassign' && (
        <BulkReassignDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title="Reassign an engineer's work"
          noun="engineer"
          people={data.engineers}
          quoteNumbers={dialog.quoteNumbers}
          queryKey={engQueueQueryKey}
          reassign={api.bulkReassignEngineering}
          onDone={() => setSelected([])}
        />
      )}
      {dialog?.kind === 'return' && (
        <GateDecisionDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          gateKey="G2"
          quoteNumber={dialog.quoteNumber}
          initialOutcomeKey="rework"
        />
      )}
      {dialog?.kind === 'pin' && (
        <OverrideDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          quoteNumber={dialog.item.quoteNumber}
          field={{
            field: 'queue_position',
            label: 'Queue position',
            approval: 'self',
            canRequest: true,
            currentValue: dialog.item.queuePosition,
            pending: null,
            applied: null,
          }}
        />
      )}
    </div>
  );
}

function CompletenessCell({ item }: { item: EngQueueItem }) {
  const n = item.completeness.length;
  if (n === 0) return <span className="text-muted-foreground">–</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-8 items-center gap-1 rounded px-1 text-xs"
          aria-label={`${n} completeness warning${n === 1 ? '' : 's'}: ${item.completeness.map((c) => c.field).join(', ')}`}
          onClick={(e) => e.stopPropagation()}
        >
          <CircleAlertIcon className="size-3.5" aria-hidden="true" />
          {n}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <ul className="grid gap-0.5 text-xs">
          {item.completeness.map((c) => (
            <li key={c.code + c.field}>
              {c.field.replaceAll('_', ' ')}: {c.message}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
