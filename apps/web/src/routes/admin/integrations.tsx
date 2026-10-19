import type { ConnectorHealth, IntegrationRun } from '@ccq/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { RefreshCwIcon } from 'lucide-react';

import { adminKey, BackToAdmin, useCanEditConfig } from '@/admin/shared';
import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export const Route = createFileRoute('/admin/integrations')({ component: IntegrationsPage });

const runsKey = ['admin', 'integrations'] as const;

const HEALTH_STYLE: Record<ConnectorHealth['health'], string> = {
  ok: 'bg-success/15 text-success',
  degraded: 'bg-warning text-warning-foreground',
  down: 'bg-destructive text-destructive-foreground',
  unknown: 'bg-muted text-muted-foreground',
};

/** B-19: one card per connector: how it is configured and how its recent runs went. */
function ConnectorHealthPanel() {
  const health = useQuery({
    queryKey: adminKey('connector-health'),
    queryFn: api.admin.connectorHealth,
  });
  if (health.isError)
    return <ErrorState error={health.error} onRetry={() => void health.refetch()} />;
  return (
    <section aria-labelledby="connector-health" className="mb-6 grid gap-2">
      <h2 id="connector-health" className="font-display text-lg">
        Connector health
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(health.data?.items ?? []).map((c) => (
          <li
            key={c.source}
            className="bg-card rounded-card grid gap-1 border p-3"
            data-testid={`health-${c.source}`}
          >
            <span className="flex items-center gap-2">
              <span className="font-medium capitalize">{c.source}</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-semibold capitalize',
                  HEALTH_STYLE[c.health],
                )}
              >
                {c.health}
              </span>
            </span>
            <span className="text-muted-foreground text-xs">Mode: {c.mode}</span>
            <span className="text-xs">
              Last run: {when(c.lastRunAt)}
              {c.lastStatus ? ` (${c.lastStatus})` : ''}
            </span>
            <span className="text-xs">Last success: {when(c.lastSuccessAt)}</span>
            {c.failures24h > 0 && (
              <span className="text-destructive text-xs">{c.failures24h} failure(s) in 24 h</span>
            )}
            {c.lastError && (
              <span className="text-muted-foreground truncate text-xs" title={c.lastError}>
                {c.lastError}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const STATUS_STYLE: Record<IntegrationRun['status'], string> = {
  succeeded: 'bg-success/15 text-success',
  partial: 'bg-warning text-warning-foreground',
  failed: 'bg-destructive text-destructive-foreground',
  running: 'bg-muted text-muted-foreground',
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

function duration(run: IntegrationRun) {
  if (!run.finishedAt) return '—';
  const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** The counts that matter at a glance; the full set is in the tooltip. */
function countsSummary(counts: Record<string, number>) {
  const keys = ['fetched', 'inserted', 'updated', 'errors', 'deleted', 'quotesFlagged'];
  return keys
    .filter((k) => counts[k] !== undefined)
    .map((k) => `${k} ${counts[k]}`)
    .join(' · ');
}

const col = createColumnHelper<IntegrationRun>();
const columns = [
  col.accessor('startedAt', {
    header: 'Started',
    cell: (c) => when(c.getValue()),
    meta: { primary: true },
  }),
  col.accessor('source', { header: 'Source' }),
  col.accessor('status', {
    header: 'Status',
    cell: (c) => (
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-xs font-semibold capitalize',
          STATUS_STYLE[c.getValue()],
        )}
      >
        {c.getValue()}
      </span>
    ),
  }),
  col.display({ id: 'duration', header: 'Duration', cell: (c) => duration(c.row.original) }),
  col.accessor('counts', {
    header: 'Counts',
    enableSorting: false,
    cell: (c) => (
      <span className="text-xs tabular-nums" title={JSON.stringify(c.getValue())}>
        {countsSummary(c.getValue())}
      </span>
    ),
  }),
  col.accessor('error', {
    header: 'Error',
    enableSorting: false,
    cell: (c) => c.getValue() ?? '—',
  }),
];

/** Admin → Integrations: connector health (B-19), recent integration_run rows and a manual Salesforce sync (B-06). */
function IntegrationsPage() {
  useDocumentTitle('Integrations');
  const canSync = useCanEditConfig();
  const queryClient = useQueryClient();
  const runs = useQuery({ queryKey: runsKey, queryFn: () => api.integrationRuns() });
  const sync = useMutation({
    mutationFn: api.syncSalesforce,
    onSuccess: (result) => {
      const show = result.outcome === 'failed' ? toast.error : toast.success;
      show({
        title:
          result.outcome === 'running'
            ? 'Salesforce sync is still running'
            : result.outcome === 'skipped'
              ? 'A Salesforce sync is already running'
              : `Salesforce sync ${result.outcome}`,
        description: countsSummary(result.counts),
      });
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: runsKey }),
        queryClient.invalidateQueries({ queryKey: adminKey('connector-health') }),
      ]),
  });

  return (
    <div data-testid="page" data-page-title="Integrations">
      <BackToAdmin />
      <PageHeader
        eyebrow="Configuration"
        title="Integrations"
        description="Salesforce is read every 15 minutes (read-only). Failures alert admins; the app keeps working from the last snapshot."
        actions={
          canSync && (
            <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
              <RefreshCwIcon
                className={cn('size-4', sync.isPending && 'animate-spin')}
                aria-hidden
              />
              {sync.isPending ? 'Syncing…' : 'Sync Salesforce now'}
            </Button>
          )
        }
      />
      <ConnectorHealthPanel />
      {runs.isError ? (
        <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
      ) : (
        <DataTable
          caption="Recent integration runs"
          columns={columns}
          data={runs.data?.items ?? []}
          getRowId={(r) => r.id}
          isLoading={runs.isLoading}
          empty={
            <EmptyState
              icon={RefreshCwIcon}
              title="No runs yet"
              description="The first Salesforce sync runs shortly after the API starts."
            />
          }
        />
      )}
    </div>
  );
}
