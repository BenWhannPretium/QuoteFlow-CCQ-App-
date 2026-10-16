import { AUDIT_ACTION_VALUES, type AuditEventDto, type AuditQuery } from '@ccq/contracts';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { DownloadIcon, ScrollTextIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { useCan } from '@/auth';
import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export const Route = createFileRoute('/admin/audit')({ component: AuditPage });

type Filters = Pick<AuditQuery, 'actorId' | 'quoteNumber' | 'action' | 'from' | 'to'>;

const ACTION_LABEL = (a: string) => a.replace(/_/g, ' ');
const QUOTE_NUMBER = /^CCQ-\d{4}-\d{5}$/;

const col = createColumnHelper<AuditEventDto>();
const columns = [
  col.accessor('at', {
    header: 'When',
    meta: { primary: true },
    cell: (c) => <time dateTime={c.getValue()}>{absoluteTime(c.getValue())}</time>,
  }),
  col.accessor('actorName', {
    header: 'Who',
    cell: (c) => (
      <span>
        {c.getValue() ?? 'System'}
        <span className="text-muted-foreground block text-xs">
          {c.row.original.actorRoles.join(', ')}
        </span>
      </span>
    ),
  }),
  col.accessor('action', { header: 'Action', cell: (c) => ACTION_LABEL(c.getValue()) }),
  col.accessor('entity', { header: 'Entity' }),
  col.accessor('quoteNumber', {
    header: 'Quote',
    cell: (c) =>
      c.getValue() ? (
        <Link
          to="/quotes/$quoteNumber"
          params={{ quoteNumber: c.getValue()! }}
          className="underline-offset-4 hover:underline"
        >
          {c.getValue()}
        </Link>
      ) : (
        '—'
      ),
  }),
  col.display({
    id: 'details',
    header: 'Before / after',
    meta: { hideOnMobile: true },
    cell: (c) => {
      const e = c.row.original;
      if (e.before == null && e.after == null) return '—';
      return (
        <details>
          <summary className="cursor-pointer text-xs">Show</summary>
          <pre className="bg-muted mt-1 max-w-md overflow-x-auto rounded p-2 text-[11px]">
            {JSON.stringify({ before: e.before, after: e.after }, null, 2)}
          </pre>
        </details>
      );
    },
  }),
  col.accessor('requestId', {
    header: 'Request',
    meta: { hideOnMobile: true },
    cell: (c) => (
      <span className="text-muted-foreground font-mono text-[11px]">{c.getValue() ?? '—'}</span>
    ),
  }),
];

/**
 * The usage audit log (F-12): append-only, filterable by user, quote, action and date (US Central
 * days), with a CSV export that is itself audited. Leadership and Admin (audit.read).
 */
function AuditPage() {
  useDocumentTitle('Audit log');
  const ids = { user: useId(), quote: useId(), action: useId(), from: useId(), to: useId() };
  const canOverrideLog = useCan('overrideLog.read');
  const [draft, setDraft] = useState<Filters>({});
  const [filters, setFilters] = useState<Filters>({});
  const [userQuery, setUserQuery] = useState('');

  const log = useInfiniteQuery({
    queryKey: ['admin', 'audit', filters],
    queryFn: ({ pageParam }) =>
      api.auditEvents({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const users = useQuery({
    queryKey: ['users', userQuery],
    queryFn: () => api.searchUsers(userQuery),
    enabled: userQuery.trim().length >= 2,
    staleTime: 60_000,
  });
  const exportCsv = useMutation({
    mutationFn: () => api.auditExport(filters),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ccq-audit.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast.success({
        title: 'Export ready',
        description: 'The export is recorded in the audit log.',
      });
    },
  });
  const items = log.data?.pages.flatMap((p) => p.items) ?? [];
  const quoteInvalid = !!draft.quoteNumber && !QUOTE_NUMBER.test(draft.quoteNumber);

  return (
    <div data-testid="page" data-page-title="Audit log">
      <PageHeader
        eyebrow="Usage audit"
        title="Audit log"
        description="Every quote view, change, decision, override, export and sign-in. Append-only; days are US Central."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/admin/reports/usage" className={buttonVariants({ variant: 'outline' })}>
              Usage report
            </Link>
            {canOverrideLog && (
              <Link to="/admin/override-log" className={buttonVariants({ variant: 'outline' })}>
                Override log
              </Link>
            )}
            <Button onClick={() => exportCsv.mutate()} disabled={exportCsv.isPending}>
              <DownloadIcon aria-hidden="true" />
              Export CSV
            </Button>
          </div>
        }
      />

      <form
        className="bg-card rounded-card mb-6 grid gap-3 border p-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end"
        aria-label="Filter the audit log"
        onSubmit={(e) => {
          e.preventDefault();
          if (quoteInvalid) return;
          setFilters(Object.fromEntries(Object.entries(draft).filter(([, v]) => v)));
        }}
      >
        <div className="grid gap-1 lg:col-span-2">
          <label htmlFor={ids.user} className="text-xs font-medium">
            User
          </label>
          <Input
            id={ids.user}
            list={`${ids.user}-list`}
            value={userQuery}
            placeholder="Name or email"
            onChange={(e) => {
              setUserQuery(e.target.value);
              const hit = users.data?.items.find((u) => u.displayName === e.target.value);
              setDraft((d) => ({ ...d, actorId: hit?.id }));
            }}
          />
          <datalist id={`${ids.user}-list`}>
            {users.data?.items.map((u) => (
              <option key={u.id} value={u.displayName}>
                {u.upn}
              </option>
            ))}
          </datalist>
        </div>
        <div className="grid gap-1">
          <label htmlFor={ids.quote} className="text-xs font-medium">
            Quote
          </label>
          <Input
            id={ids.quote}
            value={draft.quoteNumber ?? ''}
            placeholder="CCQ-2026-00001"
            aria-invalid={quoteInvalid}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                quoteNumber: e.target.value.trim().toUpperCase() || undefined,
              }))
            }
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor={ids.action} className="text-xs font-medium">
            Action
          </label>
          <NativeSelect
            id={ids.action}
            value={draft.action ?? ''}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                action: (e.target.value || undefined) as Filters['action'],
              }))
            }
          >
            <option value="">Any</option>
            {AUDIT_ACTION_VALUES.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL(a)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <label htmlFor={ids.from} className="text-xs font-medium">
            From
          </label>
          <Input
            id={ids.from}
            type="date"
            value={draft.from ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value || undefined }))}
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor={ids.to} className="text-xs font-medium">
            To
          </label>
          <Input
            id={ids.to}
            type="date"
            value={draft.to ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value || undefined }))}
          />
        </div>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-6 lg:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraft({});
              setUserQuery('');
              setFilters({});
            }}
          >
            Clear
          </Button>
          <Button type="submit" variant="primary">
            Apply filters
          </Button>
        </div>
      </form>

      {log.isError ? (
        <ErrorState error={log.error} onRetry={() => void log.refetch()} />
      ) : (
        <>
          <DataTable
            caption="Audit events, newest first"
            columns={columns}
            data={items}
            getRowId={(r) => r.id}
            isLoading={log.isLoading}
            empty={
              <EmptyState
                icon={ScrollTextIcon}
                title="No audit events"
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
