import type { SfWritebackPreview, SfWritebackRow, SfWritebackSummary } from '@ccq/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudUploadIcon } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';

import { ErrorState } from '@/components/ErrorState';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * FB-29 (N19-01): Admin → Integrations → Salesforce write-back. The switch and the mode (Admin), why nothing
 * is written when nothing is, the counts, the latest 50 rows with Retry and Skip on failed rows, and a preview
 * of what the current map would send for a quote. Leadership reads it (config.read); the server decides who
 * may change it.
 */
export const sfWritebackKey = ['admin', 'sf-writeback'] as const;

const STATUS_LABEL: Record<SfWritebackRow['status'], string> = {
  pending: 'Queued',
  sent: 'Sent',
  failed: 'Failed',
  skipped: 'Not written',
  dry_run: 'Dry run',
};

const STATUS_STYLE: Record<SfWritebackRow['status'], string> = {
  pending: 'bg-muted text-muted-foreground',
  sent: 'bg-success/15 text-success',
  failed: 'bg-destructive text-destructive-foreground',
  skipped: 'bg-muted text-muted-foreground',
  dry_run: 'border text-foreground',
};

const REASON_LABEL: Record<NonNullable<SfWritebackRow['skippedReason']>, string> = {
  superseded: 'a newer value replaced it',
  regression: 'Salesforce is at a later stage',
  other_active_quote: 'another quote still needs the opportunity',
  nothing_to_reopen: 'QuoteFlow had not closed it',
  moved_in_salesforce: 'moved in Salesforce since',
  admin_skip: 'skipped by an Admin',
};

const EVENT_LABEL: Record<SfWritebackRow['event'], string> = {
  outcome_recorded: 'Customer outcome',
  requote_started: 'Re-quote (reopen)',
  stage_changed: 'Stage change',
  quote_link: 'Quote link',
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

function Counts({ counts }: { counts: SfWritebackSummary['counts'] }) {
  const items = [
    ['Queued', counts.pending],
    ['Failed', counts.failed],
    ['Sent in 24 h', counts.sent24h],
  ] as const;
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm" data-testid="sf-writeback-counts">
      {items.map(([label, n]) => (
        <div key={label} className="flex gap-1">
          <dt className="text-muted-foreground">{label}:</dt>
          <dd className={cn('font-medium', label === 'Failed' && n > 0 && 'text-destructive')}>
            {n}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Preview() {
  const inputId = useId();
  const [quoteNumber, setQuoteNumber] = useState('');
  const preview = useMutation({
    mutationFn: (qn: string) => api.admin.previewSfWrite(qn.trim().toUpperCase()),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (quoteNumber.trim()) preview.mutate(quoteNumber);
  };
  const result: SfWritebackPreview | undefined = preview.data;
  return (
    <div className="grid gap-2" data-testid="sf-writeback-preview">
      <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
        <label htmlFor={inputId} className="grid content-start gap-1 text-sm">
          <span className="font-medium">Preview for a quote number</span>
          <Input
            id={inputId}
            value={quoteNumber}
            onChange={(e) => setQuoteNumber(e.target.value)}
            placeholder="CCQ-2026-00001"
            className="w-48"
            autoComplete="off"
          />
        </label>
        <Button type="submit" variant="outline" disabled={preview.isPending || !quoteNumber.trim()}>
          Preview
        </Button>
      </form>
      {preview.isError && (
        <p role="alert" className="text-destructive text-sm">
          {describeError(preview.error).message}
        </p>
      )}
      {result && (
        <div className="grid gap-1 text-sm" aria-live="polite">
          <p>
            {result.quoteNumber} → opportunity <code>{result.sfOpportunityId}</code>
          </p>
          {result.writes.length > 0 && (
            <ul className="grid gap-1">
              {result.writes.map((w) => (
                <li key={`${w.event}-${w.sfField}`} className="bg-muted/50 rounded p-2">
                  <span className="font-medium">{EVENT_LABEL[w.event]}</span>: {w.sfObject}.
                  {w.sfField} = <strong>{w.value}</strong>
                  {w.closing && ' (closes the opportunity)'}
                  {w.note && <span className="text-muted-foreground block text-xs">{w.note}</span>}
                  <code className="text-muted-foreground block text-xs break-all">{w.payload}</code>
                </li>
              ))}
            </ul>
          )}
          {result.notes.map((n) => (
            <p key={n} className="text-muted-foreground text-xs">
              {n}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function RowActions({ row, onDone }: { row: SfWritebackRow; onDone: () => Promise<unknown> }) {
  const act = useMutation({
    mutationFn: (kind: 'retry' | 'skip') =>
      kind === 'retry' ? api.admin.retrySfWrite(row.id) : api.admin.skipSfWrite(row.id),
    onSuccess: (_r, kind) =>
      toast.success({
        title: kind === 'retry' ? 'Queued to try again' : 'Skipped: it will not be sent',
      }),
    onError: (err) => {
      const e = describeError(err);
      toast.error({ title: e.title, description: e.message });
    },
    onSettled: onDone,
  });
  if (row.status !== 'failed' && row.status !== 'pending') return null;
  return (
    <span className="flex flex-wrap gap-1">
      {row.status === 'failed' && (
        <Button
          size="sm"
          variant="outline"
          className="min-h-11 sm:h-8 sm:min-h-8"
          disabled={act.isPending}
          onClick={() => act.mutate('retry')}
          aria-label={`Retry the write for ${row.quoteNumber}`}
        >
          Retry
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="min-h-11 sm:h-8 sm:min-h-8"
        disabled={act.isPending}
        onClick={() => act.mutate('skip')}
        aria-label={`Skip the write for ${row.quoteNumber}`}
      >
        Skip
      </Button>
    </span>
  );
}

function Rows({
  rows,
  canManage,
  onDone,
}: {
  rows: SfWritebackRow[];
  canManage: boolean;
  onDone: () => Promise<unknown>;
}) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing has been queued yet.</p>;
  }
  return (
    // A keyboard user can scroll the rows sideways on a phone (focusable region, axe).
    <div
      className="relative min-w-0 overflow-x-auto"
      tabIndex={0}
      role="region"
      aria-label="Latest Salesforce writes"
    >
      <table className="w-full text-left text-sm" data-testid="sf-writeback-rows">
        <caption className="sr-only">Latest Salesforce writes, newest first</caption>
        <thead className="text-muted-foreground text-xs">
          <tr>
            <th className="py-1 pr-3 font-medium">When</th>
            <th className="py-1 pr-3 font-medium">Quote</th>
            <th className="py-1 pr-3 font-medium">What</th>
            <th className="py-1 pr-3 font-medium">Status</th>
            {canManage && (
              <th className="py-1 pr-3 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t align-top" data-testid={`sf-write-${r.id}`}>
              <td className="py-1 pr-3 whitespace-nowrap">{when(r.createdAt)}</td>
              <td className="py-1 pr-3 whitespace-nowrap">{r.quoteNumber}</td>
              <td className="py-1 pr-3">
                {EVENT_LABEL[r.event]}: {r.sfField} = {r.value}
              </td>
              <td className="py-1 pr-3">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-semibold',
                    STATUS_STYLE[r.status],
                  )}
                  data-testid="sf-write-status"
                >
                  {STATUS_LABEL[r.status]}
                </span>
                {r.skippedReason && (
                  <span className="text-muted-foreground block text-xs">
                    {REASON_LABEL[r.skippedReason]}
                  </span>
                )}
                {r.lastError && (
                  <span className="text-destructive block text-xs break-words">{r.lastError}</span>
                )}
                {r.status === 'pending' && r.attempts > 0 && (
                  <span className="text-muted-foreground block text-xs">
                    {r.attempts} tries; next {when(r.nextAttemptAt)}
                  </span>
                )}
              </td>
              {canManage && (
                <td className="py-1 pr-3">
                  <RowActions row={r} onDone={onDone} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SfWritebackCard() {
  const queryClient = useQueryClient();
  const switchId = useId();
  const modeId = useId();
  const summary = useQuery({ queryKey: sfWritebackKey, queryFn: api.admin.sfWriteback });
  const [pending, setPending] = useState<{ enabled?: boolean; mode?: 'dry_run' | 'live' } | null>(
    null,
  );
  const refresh = () => queryClient.invalidateQueries({ queryKey: sfWritebackKey });
  const save = useMutation({
    mutationFn: api.admin.setSfWriteback,
    onSettled: (_data, err) => {
      setPending(null);
      if (err) void refresh();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(sfWritebackKey, data);
      toast.success({ title: 'Salesforce write-back saved', description: data.statusText });
    },
    onError: (err) => {
      const e = describeError(err);
      toast.error({ title: e.title, description: e.message });
    },
  });

  /** Show the new switch or mode at once (a controlled input would snap back while the save runs). */
  const change = (body: { enabled?: boolean; mode?: 'dry_run' | 'live' }) => {
    setPending((p) => ({ ...p, ...body }));
    save.mutate(body);
  };

  if (summary.isError) {
    return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;
  }
  const s = summary.data ? { ...summary.data, ...pending } : undefined;
  return (
    <section
      aria-labelledby="sf-writeback-heading"
      className="bg-card rounded-card mb-6 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 border p-4"
      data-testid="sf-writeback-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CloudUploadIcon className="size-5" aria-hidden />
        <h2 id="sf-writeback-heading" className="font-display text-lg">
          Salesforce write-back
        </h2>
        {s && (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-semibold',
              s.sending ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground',
            )}
            data-testid="sf-writeback-state"
          >
            {!s.enabled
              ? 'Off'
              : s.mode === 'dry_run'
                ? 'Dry run'
                : s.sending
                  ? 'Live'
                  : 'Not sending'}
          </span>
        )}
      </div>
      {s && (
        <>
          <p className="text-sm" data-testid="sf-writeback-status">
            {s.statusText}
          </p>
          {s.provisional && (
            <p className="text-muted-foreground text-xs">
              What is written, and where, is provisional: it waits on IT&apos;s write permission and
              the Salesforce owner&apos;s approval of the field mapping.
            </p>
          )}
          {s.canManage && (
            <div className="flex flex-wrap items-end gap-4">
              <label
                htmlFor={switchId}
                className="flex min-h-11 items-center gap-2 text-sm font-medium"
              >
                <input
                  id={switchId}
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={s.enabled}
                  disabled={save.isPending}
                  onChange={(e) => change({ enabled: e.target.checked })}
                />
                Write back to Salesforce
              </label>
              <label htmlFor={modeId} className="grid content-start gap-1 text-sm">
                <span className="font-medium">Mode</span>
                <NativeSelect
                  id={modeId}
                  value={s.mode}
                  disabled={save.isPending}
                  onChange={(e) => change({ mode: e.target.value as 'dry_run' | 'live' })}
                  aria-describedby={s.liveAllowed ? undefined : `${modeId}-why`}
                >
                  <option value="dry_run">Dry run (record only, send nothing)</option>
                  <option value="live" disabled={!s.liveAllowed}>
                    Live (send to Salesforce)
                  </option>
                </NativeSelect>
              </label>
              {!s.liveAllowed && s.liveBlockedReason && (
                <p id={`${modeId}-why`} className="text-muted-foreground basis-full text-xs">
                  Live is not available here: {s.liveBlockedReason}
                </p>
              )}
            </div>
          )}
          <Counts counts={s.counts} />
          <Rows rows={s.rows} canManage={s.canManage} onDone={refresh} />
          <Preview />
        </>
      )}
    </section>
  );
}
