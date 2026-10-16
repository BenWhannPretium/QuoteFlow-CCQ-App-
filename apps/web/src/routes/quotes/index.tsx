import {
  QUOTE_LIST_COLUMNS,
  QUOTE_LIST_DEFAULT_COLUMNS,
  type QuoteListColumnKey,
  type QuoteListItem,
  type QuoteListResponse,
  type QuoteSortKey,
} from '@ccq/contracts';
import { isCommercialKey } from '@ccq/domain';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { ChevronDownIcon, ChevronUpIcon, TriangleAlertIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { RequirePermission, useCurrentUser } from '@/auth';
import {
  DataTable,
  ErrorState,
  PageHeader,
  PriorityBadge,
  QualificationWarnings,
  ScoreBreakdownTable,
  ScorePill,
  SkeletonRows,
  StageBadge,
  TierChip,
} from '@/components';
import {
  ColumnChooser,
  ExportButton,
  NoMatches,
  PipelineViewTabs,
  formatCount,
  formatDays,
  formatUsd,
} from '@/components/pipeline/parts';
import { PipelineToolbar } from '@/components/pipeline/PipelineToolbar';
import { CapitalChip } from '@/components/pricing/CapitalChip';
import { Button } from '@/components/ui/button';
import { usePublicConfig } from '@/config/public-config';
import { api } from '@/lib/api';
import {
  parsePipelineSearch,
  pipelineApiQuery,
  sortDirFor,
  type PipelineSearch,
} from '@/lib/pipeline-search';
import { readColumns, writeColumns } from '@/lib/saved-views';
import { relativeTime } from '@/lib/time';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

interface QuotesSearch extends PipelineSearch {
  /** `priority` = the Prioritization view (scored list); otherwise the list. */
  view?: 'priority' | undefined;
}

export const Route = createFileRoute('/quotes/')({
  validateSearch: (raw: Record<string, unknown>): QuotesSearch => ({
    ...parsePipelineSearch(raw),
    ...(raw.view === 'priority' ? { view: 'priority' as const } : {}),
  }),
  component: QuotesPage,
});

export const pipelineQueryKey = ['pipeline'] as const;
const PAGE_SIZE = 50;
const LIST_SORTS: QuoteSortKey[] = ['updated', 'score', 'tier', 'age', 'closeDate', 'amount'];
const PRIORITY_SORTS: QuoteSortKey[] = ['score', 'tier', 'age', 'closeDate', 'amount'];

/** List column → server sort key (columns without one aren't sortable). */
const COLUMN_SORT: Partial<Record<QuoteListColumnKey, QuoteSortKey>> = {
  tier: 'tier',
  score: 'score',
  daysInStage: 'age',
  expectedCloseDate: 'closeDate',
  amount: 'amount',
  updatedAt: 'updated',
};

/**
 * Quotes (F-07): every quote the caller can see, as a sortable list or as the scored Prioritization
 * view. Filters, search, sort and page are in the URL (shareable); the API scopes and redacts.
 */
function QuotesPage() {
  const search = Route.useSearch();
  const priority = search.view === 'priority';
  // The list carries the nav item's name (Pipeline); the scored view is Prioritization.
  const title = priority ? 'Prioritization' : 'Pipeline';
  useDocumentTitle(title);
  const navigate = useNavigate({ from: Route.fullPath });
  const setSearch = useCallback(
    (next: PipelineSearch) =>
      void navigate({ search: { ...next, view: search.view }, replace: true }),
    [navigate, search.view],
  );
  const { view: _v, ...filters } = search;
  const [dir, sort] = sortDirFor(filters, priority ? 'score' : 'updated');
  // Prioritization is about open work: closed quotes only when the user picks a status.
  const apiQuery = pipelineApiQuery(filters, {
    sort,
    dir,
    pageSize: PAGE_SIZE,
    status: priority ? (filters.status ?? 'open') : filters.status,
  });
  const list = useQuery({
    queryKey: [...pipelineQueryKey, 'list', apiQuery],
    queryFn: () => api.quotes(apiQuery),
    placeholderData: (prev) => prev,
  });

  const { user } = useCurrentUser();
  const [columns, setColumns] = useState<QuoteListColumnKey[]>(() => {
    const saved = readColumns(user.id)?.filter(
      (c): c is QuoteListColumnKey => c in QUOTE_LIST_COLUMNS,
    );
    return saved?.length ? saved : QUOTE_LIST_DEFAULT_COLUMNS;
  });
  const data = list.data;
  const visibleColumns = columns.filter(
    (c) => (data?.commercialVisible ?? false) || !isCommercialKey(c, []),
  );

  return (
    <RequirePermission permission="quote.read">
      <div className="grid min-w-0 grid-cols-1 gap-4" data-testid="page" data-page-title={title}>
        <PageHeader
          className="mb-0"
          title={title}
          eyebrow="Quotes"
          description={
            priority
              ? 'Open quotes by priority score (pick a status to see others). The score is advisory: it orders the list, people decide.'
              : 'Every quote you can see. Filters and sort are in the link, so you can share this view.'
          }
        />
        <PipelineViewTabs current={priority ? 'priority' : 'list'} search={filters} />
        <PipelineToolbar
          search={filters}
          onChange={setSearch}
          people={data?.filterOptions}
          sortKeys={priority ? PRIORITY_SORTS : LIST_SORTS}
          defaultSort={priority ? 'score' : 'updated'}
          savedViewsKey={priority ? 'priority' : 'quotes'}
        >
          {!priority && data && (
            <ColumnChooser
              value={visibleColumns}
              commercialVisible={data.commercialVisible}
              onChange={(next) => {
                setColumns(next);
                writeColumns(user.id, next);
              }}
            />
          )}
          {data?.canExport && (
            <ExportButton search={filters} columns={priority ? PRIORITY_EXPORT : visibleColumns} />
          )}
        </PipelineToolbar>
        {list.isPending && <SkeletonRows rows={8} />}
        {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {data && (
          <>
            <p
              className="text-muted-foreground text-sm"
              aria-live="polite"
              data-testid="result-count"
            >
              {data.total === 0
                ? 'No quotes'
                : `${formatCount((data.page - 1) * data.pageSize + 1)}–${formatCount(
                    Math.min(data.page * data.pageSize, data.total),
                  )} of ${formatCount(data.total)} quotes`}
              {!data.peerPriorityVisible && ' · Other KAMs’ priority is hidden by a setting.'}
            </p>
            {data.total === 0 ? (
              <NoMatches search={filters} onChange={setSearch} />
            ) : priority ? (
              <PriorityList data={data} />
            ) : (
              <QuoteTable
                data={data}
                columns={visibleColumns}
                sort={sort}
                dir={dir}
                onSort={(s, d) => setSearch({ ...filters, sort: s, dir: d, page: undefined })}
              />
            )}
            <Pager data={data} onPage={(page) => setSearch({ ...filters, page })} />
          </>
        )}
      </div>
    </RequirePermission>
  );
}

const PRIORITY_EXPORT: QuoteListColumnKey[] = [
  'quoteNumber',
  'score',
  'tier',
  'customerName',
  'productSummary',
  'stage',
  'kamName',
  'daysInStage',
  'warnings',
];

const accountOf = (q: QuoteListItem) => q.accountName;
const opportunityOf = (q: QuoteListItem) => q.opportunityName;

function useLabel() {
  const { data: config } = usePublicConfig();
  return (list: string, code: string | null) =>
    code ? (config?.valueLists[list]?.find((v) => v.code === code)?.label ?? code) : '–';
}

function QuoteTable({
  data,
  columns,
  sort,
  dir,
  onSort,
}: {
  data: QuoteListResponse;
  columns: QuoteListColumnKey[];
  sort: QuoteSortKey;
  dir: 'asc' | 'desc';
  onSort: (sort: QuoteSortKey, dir: 'asc' | 'desc') => void;
}) {
  const navigate = useNavigate();
  const label = useLabel();
  const now = new Date();
  const defs = useMemo<ColumnDef<QuoteListItem>[]>(
    () =>
      columns.map((key): ColumnDef<QuoteListItem> => {
        const base = {
          id: key,
          header: QUOTE_LIST_COLUMNS[key],
          enableSorting: !!COLUMN_SORT[key],
        };
        switch (key) {
          case 'quoteNumber':
            return {
              ...base,
              meta: { primary: true },
              cell: ({ row }) => (
                <Link
                  to="/quotes/$quoteNumber"
                  params={{ quoteNumber: row.original.quoteNumber }}
                  className="text-emphasis font-semibold whitespace-nowrap underline-offset-4 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {row.original.quoteNumber}
                </Link>
              ),
            };
          case 'stage':
            return { ...base, cell: ({ row }) => <StageBadge stageKey={row.original.stageKey} /> };
          case 'status':
            return { ...base, cell: ({ row }) => row.original.status.replace('_', ' ') };
          case 'tier':
            return {
              ...base,
              cell: ({ row }) => {
                const p = row.original.priority;
                if (!p.visible)
                  return <span className="text-muted-foreground text-xs">Hidden</span>;
                return p.tier ? (
                  <TierChip tier={p.tier} label={p.tierLabel} overridden={p.tierOverridden} />
                ) : (
                  '–'
                );
              },
            };
          case 'score':
            return {
              ...base,
              meta: { numeric: true },
              cell: ({ row }) =>
                row.original.priority.visible ? (
                  <ScorePill score={row.original.priority.score} />
                ) : (
                  '–'
                ),
            };
          case 'customerName':
          case 'opportunityName': {
            const text = key === 'customerName' ? accountOf : opportunityOf;
            return {
              ...base,
              cell: ({ row }) => (
                <span className="block min-w-40">{text(row.original) ?? '–'}</span>
              ),
            };
          }
          case 'productSummary':
            return {
              ...base,
              cell: ({ row }) => (
                <span
                  className="line-clamp-2 block min-w-56"
                  title={row.original.productSummary ?? undefined}
                >
                  {row.original.productSummary ?? '–'}
                </span>
              ),
            };
          case 'kamName':
          case 'assignedEngineerName':
            return {
              ...base,
              cell: ({ row }) => (
                <span className="whitespace-nowrap">{row.original[key] ?? '–'}</span>
              ),
            };
          case 'productFamily':
          case 'market':
          case 'resin': {
            const listKey = key === 'productFamily' ? 'product_family' : key;
            return { ...base, cell: ({ row }) => label(listKey, row.original[key]) };
          }
          case 'estAnnualVolume':
            return {
              ...base,
              meta: { numeric: true },
              cell: ({ row }) => formatCount(row.original.estAnnualVolume),
            };
          case 'amount':
            return {
              ...base,
              meta: { numeric: true },
              cell: ({ row }) => formatUsd(row.original.amount),
            };
          case 'daysInStage':
            return {
              ...base,
              meta: { numeric: true },
              cell: ({ row }) => formatDays(row.original.daysInStage),
            };
          case 'sfStage':
            return {
              ...base,
              cell: ({ row }) => (
                <span className="inline-flex items-center gap-1">
                  {row.original.sfStage ?? '–'}
                  {row.original.sfMismatch && (
                    <TriangleAlertIcon
                      className="text-warning-foreground size-3.5"
                      aria-label="Disagrees with CCQ"
                    />
                  )}
                </span>
              ),
            };
          case 'warnings':
            return {
              ...base,
              cell: ({ row }) =>
                row.original.warnings.length ? (
                  <span title={row.original.warnings.map((w) => w.message).join('\n')}>
                    {row.original.warnings.length}
                  </span>
                ) : (
                  '–'
                ),
            };
          case 'validityUntil':
            return {
              ...base,
              cell: ({ row }) =>
                row.original.validityUntil ? (
                  <span className={row.original.validityExpired ? 'font-semibold' : undefined}>
                    {row.original.validityUntil}
                    {row.original.validityExpired && ' (expired)'}
                  </span>
                ) : (
                  '–'
                ),
            };
          case 'updatedAt':
            return { ...base, cell: ({ row }) => relativeTime(row.original.updatedAt, now) };
          case 'prelimCapitalUsd':
            return {
              ...base,
              meta: { numeric: true },
              cell: ({ row }) => formatUsd(row.original.commercial?.prelimCapitalUsd),
            };
          case 'capitalReadiness':
            return {
              ...base,
              cell: ({ row }) => <CapitalChip value={row.original.commercial?.capitalReadiness} />,
            };
          default:
            return {
              ...base,
              cell: ({ row }) => (
                <span className="whitespace-nowrap">{row.original[key] ?? '–'}</span>
              ),
            };
        }
      }),
    // `now` and `label` change every render; the column set is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns],
  );
  const sortColumn = (Object.keys(COLUMN_SORT) as QuoteListColumnKey[]).find(
    (k) => COLUMN_SORT[k] === sort,
  );
  const sorting: SortingState = sortColumn ? [{ id: sortColumn, desc: dir === 'desc' }] : [];
  return (
    <DataTable
      columns={defs}
      data={data.items}
      caption="Quotes"
      getRowId={(r) => r.id}
      rowTestId={(r) => `quote-row-${r.quoteNumber}`}
      onRowClick={(r) =>
        void navigate({ to: '/quotes/$quoteNumber', params: { quoteNumber: r.quoteNumber } })
      }
      manualSorting={{
        sorting,
        onSortingChange: (next) => {
          const first = next[0];
          const key = first ? COLUMN_SORT[first.id as QuoteListColumnKey] : undefined;
          if (key && first) onSort(key, first.desc ? 'desc' : 'asc');
        },
      }}
    />
  );
}

/** The scored list: rank, score + tier (override marker), the "Why this priority?" popover and the
 *  breakdown expandable inline. Withheld priorities (kam_can_see_peer_scores) show as hidden. */
function PriorityList({ data }: { data: QuoteListResponse }) {
  const label = useLabel();
  const [open, setOpen] = useState<string[]>([]);
  return (
    <ol className="grid gap-3" aria-label="Quotes by priority" data-testid="priority-list">
      {data.items.map((q, i) => {
        const rank = (data.page - 1) * data.pageSize + i + 1;
        const expanded = open.includes(q.id);
        const canExpand = q.priority.visible && q.priority.breakdown.length > 0;
        const product =
          q.productSummary ??
          [label('product_family', q.productFamily), label('resin', q.resin)].join(' · ');
        return (
          <li
            key={q.id}
            className="bg-card rounded-card grid gap-3 border p-4"
            data-testid="priority-item"
            data-quote={q.quoteNumber}
          >
            <div className="grid gap-2 sm:grid-cols-[2.5rem_1fr_auto] sm:items-start">
              <span
                className="text-muted-foreground text-sm tabular-nums"
                aria-label={`Rank ${rank}`}
              >
                {rank}
              </span>
              <div className="grid min-w-0 gap-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link
                    to="/quotes/$quoteNumber"
                    params={{ quoteNumber: q.quoteNumber }}
                    className="text-emphasis font-semibold underline-offset-4 hover:underline"
                  >
                    {q.quoteNumber}
                  </Link>
                  <PriorityBadge priority={q.priority} quoteNumber={q.quoteNumber} />
                  <StageBadge stageKey={q.stageKey} />
                  {q.status === 'on_hold' && (
                    <span className="text-muted-foreground text-xs">On hold</span>
                  )}
                </div>
                <p className="min-w-0 text-sm break-words">
                  {q.accountName ?? 'Unknown account'}
                  {q.opportunityName ? ` · ${q.opportunityName}` : ''}
                </p>
                <p className="text-muted-foreground text-xs">
                  {[
                    product,
                    q.estAnnualVolume != null && `${formatCount(q.estAnnualVolume)} units/yr`,
                    q.kamName && `KAM ${q.kamName}`,
                    `${formatDays(q.daysInStage)} in stage`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <QualificationWarnings warnings={q.warnings} />
              </div>
              {canExpand && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={expanded}
                  aria-controls={`breakdown-${q.id}`}
                  onClick={() =>
                    setOpen((o) => (expanded ? o.filter((x) => x !== q.id) : [...o, q.id]))
                  }
                >
                  {expanded ? (
                    <ChevronUpIcon aria-hidden="true" />
                  ) : (
                    <ChevronDownIcon aria-hidden="true" />
                  )}
                  {expanded ? 'Hide breakdown' : 'Breakdown'}
                </Button>
              )}
            </div>
            {canExpand && expanded && (
              <div id={`breakdown-${q.id}`} className="overflow-x-auto sm:pl-10">
                <ScoreBreakdownTable priority={q.priority} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Pager({ data, onPage }: { data: QuoteListResponse; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={data.page <= 1}
        onClick={() => onPage(data.page - 1)}
      >
        Previous
      </Button>
      <span className="text-muted-foreground text-sm">
        Page {data.page} of {pages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={data.page >= pages}
        onClick={() => onPage(data.page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}
