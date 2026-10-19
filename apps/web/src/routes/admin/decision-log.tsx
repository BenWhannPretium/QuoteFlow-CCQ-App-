import type { DecisionLogEntry, DecisionLogQuery } from '@ccq/contracts';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { DownloadIcon, ScrollTextIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { adminKey, BackToAdmin } from '@/admin/shared';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { SkeletonRows } from '@/components/Skeletons';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { api, downloadBlob } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export const Route = createFileRoute('/admin/decision-log')({ component: DecisionLogPage });

type Filters = Pick<DecisionLogQuery, 'entity' | 'from' | 'to'>;

const ENTITIES: [string, string][] = [
  ['', 'Everything'],
  ['value_list', 'Value lists'],
  ['reason_code', 'Reason codes'],
  ['stage_definition', 'Stages'],
  ['gate_definition', 'Gates'],
  ['gate_outcome_definition', 'Gate outcomes'],
  ['app_setting', 'App settings'],
  ['scoring_model', 'Scoring model'],
  ['user_scope', 'User scope'],
];

const show = (v: unknown) =>
  v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v);

function Change({ c }: { c: DecisionLogEntry['changes'][number] }) {
  const long = show(c.before).length + show(c.after).length > 80;
  return (
    <li className="text-sm">
      <span className="font-mono text-xs">{c.path || 'value'}</span>{' '}
      {long ? (
        <details className="inline">
          <summary className="text-muted-foreground inline cursor-pointer text-xs">changed</summary>
          <pre className="bg-muted mt-1 max-w-full overflow-x-auto rounded p-2 text-[11px] whitespace-pre-wrap">
            {`before: ${JSON.stringify(c.before, null, 2)}\nafter:  ${JSON.stringify(c.after, null, 2)}`}
          </pre>
        </details>
      ) : (
        <>
          <span className="text-muted-foreground line-through">{show(c.before)}</span> →{' '}
          <strong>{show(c.after)}</strong>
        </>
      )}
    </li>
  );
}

/**
 * B-19 screen 8, the minimal F-21 decision log: every config change, newest first, with who made it,
 * what changed, why and when. Read from the append-only audit log; exportable (the export is audited).
 */
function DecisionLogPage() {
  useDocumentTitle('Decision log');
  const ids = { entity: useId(), from: useId(), to: useId() };
  const [draft, setDraft] = useState<Filters>({});
  const [filters, setFilters] = useState<Filters>({});
  const log = useInfiniteQuery({
    queryKey: adminKey('decision-log', JSON.stringify(filters)),
    queryFn: ({ pageParam }) =>
      api.admin.decisionLog({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const exportCsv = useMutation({
    mutationFn: () => api.admin.decisionLogExport(filters),
    onSuccess: (blob) => {
      downloadBlob(blob, 'ccq-decision-log.csv');
      toast.success({
        title: 'Export ready',
        description: 'The export is recorded in the audit log.',
      });
    },
  });
  const items = log.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div data-testid="page" data-page-title="Decision log">
      <BackToAdmin />
      <PageHeader
        eyebrow="Configuration"
        title="Decision log"
        description="Every configuration change: who, what, why and when. Append-only."
        actions={
          <Button onClick={() => exportCsv.mutate()} disabled={exportCsv.isPending}>
            <DownloadIcon aria-hidden="true" /> Export CSV
          </Button>
        }
      />
      <form
        className="bg-card rounded-card mb-6 grid gap-3 border p-4 sm:grid-cols-4 sm:items-end"
        aria-label="Filter the decision log"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(Object.fromEntries(Object.entries(draft).filter(([, v]) => v)));
        }}
      >
        <div className="grid gap-1">
          <label htmlFor={ids.entity} className="text-xs font-medium">
            What
          </label>
          <NativeSelect
            id={ids.entity}
            value={draft.entity ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, entity: e.target.value || undefined }))}
          >
            {ENTITIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
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
        <Button type="submit" variant="outline">
          Apply
        </Button>
      </form>

      {log.isError ? (
        <ErrorState error={log.error} onRetry={() => void log.refetch()} />
      ) : log.isLoading ? (
        <SkeletonRows rows={6} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ScrollTextIcon}
          title="No changes yet"
          description="Configuration changes made in Admin appear here."
        />
      ) : (
        <ol className="bg-card rounded-card divide-y border" aria-label="Configuration changes">
          {items.map((e) => (
            <li key={e.id} className="grid gap-1.5 p-3" data-testid="decision">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium">{e.subject}</span>
                <span className="text-muted-foreground text-xs">
                  <time dateTime={e.at}>{absoluteTime(e.at)}</time> · {e.actorName ?? 'System'}
                </span>
              </div>
              {e.changeReason && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Why: </span>
                  {e.changeReason}
                </p>
              )}
              {e.changes.length > 0 && (
                <ul className="grid gap-0.5" aria-label="Changes">
                  {e.changes.map((c) => (
                    <Change key={c.path} c={c} />
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      {log.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            onClick={() => void log.fetchNextPage()}
            disabled={log.isFetchingNextPage}
          >
            {log.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
