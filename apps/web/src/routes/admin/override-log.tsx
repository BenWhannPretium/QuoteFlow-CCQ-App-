import { OVERRIDE_STATUS_VALUES, type OverrideDto, type OverrideStatus } from '@ccq/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { ShieldCheckIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { formatOverrideValue } from '@/components/Overrides';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { usePublicConfig } from '@/config/public-config';
import { api } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export const Route = createFileRoute('/admin/override-log')({ component: OverrideLogPage });

const STATUS_CLASS: Record<OverrideStatus, string> = {
  requested: 'bg-warning text-warning-foreground',
  approved: 'bg-secondary text-secondary-foreground',
  applied: 'bg-success/15 text-success',
  rejected: 'bg-muted text-muted-foreground',
  reverted: 'bg-muted text-muted-foreground',
};

const FIELDS = [
  ['priority_tier', 'Priority tier'],
  ['ship_to', 'Ship-to'],
  ['queue_position', 'Queue position'],
] as const;

const col = createColumnHelper<OverrideDto>();

/** The override log (F-06): every override, who asked, who decided, and the original value. Leadership + Admin. */
function OverrideLogPage() {
  useDocumentTitle('Override log');
  const { data: config } = usePublicConfig();
  const ids = { status: useId(), field: useId() };
  const [status, setStatus] = useState<OverrideStatus | ''>('');
  const [field, setField] = useState('');
  const log = useInfiniteQuery({
    queryKey: ['admin', 'override-log', status, field],
    queryFn: ({ pageParam }) =>
      api.overrideLog({
        ...(status ? { status } : {}),
        ...(field ? { field } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = log.data?.pages.flatMap((p) => p.items) ?? [];

  const columns = [
    col.accessor('quoteNumber', {
      header: 'Quote',
      meta: { primary: true },
      cell: (c) => (
        <Link
          to="/quotes/$quoteNumber"
          params={{ quoteNumber: c.getValue() }}
          className="font-medium underline-offset-4 hover:underline"
        >
          {c.getValue()}
        </Link>
      ),
    }),
    col.accessor('fieldLabel', { header: 'Field' }),
    col.display({
      id: 'change',
      header: 'Change',
      cell: (c) => {
        const o = c.row.original;
        return (
          <span>
            {formatOverrideValue(o.field, o.originalValue, config)} →{' '}
            <span className="font-medium">
              {formatOverrideValue(o.field, o.requestedValue, config)}
            </span>
          </span>
        );
      },
    }),
    col.accessor('justification', {
      header: 'Justification',
      cell: (c) => <span className="line-clamp-3 max-w-xs">{c.getValue()}</span>,
    }),
    col.accessor('status', {
      header: 'Status',
      cell: (c) => (
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-semibold',
            STATUS_CLASS[c.getValue()],
          )}
        >
          {c.getValue()}
        </span>
      ),
    }),
    col.accessor('requestedAt', {
      header: 'Requested',
      cell: (c) => (
        <span>
          {c.row.original.requestedByName ?? '—'}
          <span className="text-muted-foreground block text-xs">{absoluteTime(c.getValue())}</span>
        </span>
      ),
    }),
    col.display({
      id: 'decided',
      header: 'Decided / reverted',
      meta: { hideOnMobile: true },
      cell: (c) => {
        const o = c.row.original;
        const decided =
          o.approvalMode === 'self' ? 'Self-applied (logged)' : (o.decidedByName ?? '—');
        return (
          <span>
            {decided}
            {o.decisionNote && (
              <span className="text-muted-foreground block text-xs">{o.decisionNote}</span>
            )}
            {o.revertedAt && (
              <span className="text-muted-foreground block text-xs">
                Reverted by {o.revertedByName ?? '—'}, {absoluteTime(o.revertedAt)}
              </span>
            )}
          </span>
        );
      },
    }),
  ];

  return (
    <div data-testid="page" data-page-title="Override log">
      <PageHeader
        eyebrow="Governed overrides"
        title="Override log"
        description="Every override of a governed field, with the original value, the justification and who decided. Leadership and Admin only."
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="grid gap-1">
          <label htmlFor={ids.status} className="text-xs font-medium">
            Status
          </label>
          <NativeSelect
            id={ids.status}
            value={status}
            onChange={(e) => setStatus(e.target.value as OverrideStatus | '')}
          >
            <option value="">Any</option>
            {OVERRIDE_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <label htmlFor={ids.field} className="text-xs font-medium">
            Field
          </label>
          <NativeSelect id={ids.field} value={field} onChange={(e) => setField(e.target.value)}>
            <option value="">Any</option>
            {FIELDS.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {log.isError ? (
        <ErrorState error={log.error} onRetry={() => void log.refetch()} />
      ) : (
        <>
          <DataTable
            caption="Overrides, newest first"
            columns={columns}
            data={items}
            getRowId={(r) => r.id}
            isLoading={log.isLoading}
            empty={
              <EmptyState
                icon={ShieldCheckIcon}
                title="No overrides"
                description="Nothing matches these filters."
              />
            }
          />
          {log.hasNextPage && (
            <div className="mt-4">
              <Button
                variant="outline"
                onClick={() => void log.fetchNextPage()}
                disabled={log.isFetchingNextPage}
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
