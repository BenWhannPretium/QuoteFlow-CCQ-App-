import type { FeedbackItem, UpdateFeedbackBody } from '@ccq/contracts';
import {
  FEEDBACK_SEVERITY_LABELS,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_STATUSES,
  isOpenFeedback,
  mustFixBeforeSignoff,
  type FeedbackStatus,
} from '@ccq/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { ClipboardCopyIcon, ImageIcon, MessageSquareWarningIcon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Field, FormErrors, problemErrors, type ServerError } from '@/components/forms';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export const Route = createFileRoute('/admin/feedback')({ component: FeedbackPage });

const feedbackKey = (status: string) => ['admin', 'feedback', status] as const;
const col = createColumnHelper<FeedbackItem>();

function SeverityPill({ severity, status }: { severity: number; status: string }) {
  const blocking = mustFixBeforeSignoff(severity) && isOpenFeedback(status);
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        blocking ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground',
      )}
      title={FEEDBACK_SEVERITY_LABELS[severity as 1 | 2 | 3 | 4]}
    >
      Sev-{severity}
    </span>
  );
}

/**
 * B-23 Admin → Feedback: every "Report an issue" report, with its page context, for the daily UAT
 * triage. Admin only (feedback.triage): reports can show commercial figures.
 */
function FeedbackPage() {
  useDocumentTitle('Feedback');
  const statusId = useId();
  const [status, setStatus] = useState<FeedbackStatus | ''>('');
  const [editing, setEditing] = useState<FeedbackItem | null>(null);
  const list = useQuery({
    queryKey: feedbackKey(status),
    queryFn: () => api.admin.feedback(status || undefined),
  });
  const items = list.data?.items ?? [];
  const blocking = items.filter(
    (i) => mustFixBeforeSignoff(i.severity) && isOpenFeedback(i.status),
  ).length;

  const columns = [
    col.accessor('severity', {
      header: 'Sev',
      cell: (c) => <SeverityPill severity={c.getValue()} status={c.row.original.status} />,
    }),
    col.accessor('description', {
      header: 'Report',
      meta: { primary: true },
      cell: (c) => (
        <button
          type="button"
          className="text-left underline-offset-4 hover:underline"
          onClick={() => setEditing(c.row.original)}
        >
          <span className="line-clamp-2 max-w-md font-medium">{c.getValue()}</span>
          <span className="text-muted-foreground block text-xs">
            {c.row.original.type} · <code>{c.row.original.route}</code>
            {c.row.original.hasScreenshot ? ' · screenshot' : ''}
          </span>
        </button>
      ),
    }),
    col.accessor('quoteNumber', {
      header: 'Quote',
      meta: { hideOnMobile: true },
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
    col.accessor('status', {
      header: 'Status',
      cell: (c) => FEEDBACK_STATUS_LABELS[c.getValue()],
    }),
    col.accessor('createdAt', {
      header: 'Reported',
      meta: { hideOnMobile: true },
      cell: (c) => (
        <span>
          {c.row.original.reporterName}
          <span className="text-muted-foreground block text-xs">
            {c.row.original.reporterRoles} · {absoluteTime(c.getValue())}
          </span>
        </span>
      ),
    }),
    col.accessor('ownerName', {
      header: 'Owner',
      meta: { hideOnMobile: true },
      cell: (c) => c.getValue() ?? '—',
    }),
  ];

  return (
    <div data-testid="page" data-page-title="Feedback">
      <PageHeader
        eyebrow="UAT"
        title="Feedback"
        description="Reports from the “Report an issue” button. Sev-1 and Sev-2 must be fixed by Thu Nov 12; Sev-3 and Sev-4 go to the P1 backlog unless trivial. Admin only."
      />
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="grid gap-1">
          <label htmlFor={statusId} className="text-xs font-medium">
            Status
          </label>
          <NativeSelect
            id={statusId}
            value={status}
            onChange={(e) => setStatus(e.target.value as FeedbackStatus | '')}
          >
            <option value="">Any</option>
            {FEEDBACK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {FEEDBACK_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <p className="text-sm" data-testid="feedback-blocking">
          <span className="font-semibold">{blocking}</span> open Sev-1/2
        </p>
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <DataTable
          caption="Feedback reports, newest first"
          columns={columns}
          data={items}
          getRowId={(r) => r.id}
          isLoading={list.isLoading}
          empty={
            <EmptyState
              icon={MessageSquareWarningIcon}
              title="No reports"
              description="Nothing matches this filter."
            />
          }
        />
      )}
      {editing && <TriageDialog item={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TriageDialog({ item, onClose }: { item: FeedbackItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: api.admin.users });
  const [status, setStatus] = useState<FeedbackStatus>(item.status);
  const [severity, setSeverity] = useState(item.severity);
  const [ownerId, setOwnerId] = useState(item.ownerId ?? '');
  const [githubIssueUrl, setGithubIssueUrl] = useState(item.githubIssueUrl ?? '');
  const [triageNote, setTriageNote] = useState(item.triageNote ?? '');
  const [errors, setErrors] = useState<ServerError[]>([]);
  const [shotUrl, setShotUrl] = useState<string | null>(null);

  useEffect(() => () => void (shotUrl && URL.revokeObjectURL(shotUrl)), [shotUrl]);

  const save = useMutation({
    mutationFn: (body: UpdateFeedbackBody) => api.admin.updateFeedback(item.id, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'feedback'] });
      toast.success({ title: 'Report updated' });
      onClose();
    },
    onError: (err) => setErrors(problemErrors(err)),
  });

  const copyIssue = async () => {
    await navigator.clipboard.writeText(`${item.issueTitle}\n\n${item.issueMarkdown}`);
    toast.success({
      title: 'GitHub issue copied',
      description: 'Paste it into a new issue, then add the issue link here.',
    });
  };

  const showScreenshot = async () => {
    const blob = await api.admin.feedbackScreenshot(item.id);
    setShotUrl(URL.createObjectURL(blob));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
        data-testid="triage-dialog"
      >
        <DialogHeader>
          <DialogTitle>Triage report</DialogTitle>
          <DialogDescription>
            {item.reporterName} ({item.reporterRoles}) · {absoluteTime(item.createdAt)} ·{' '}
            <code>{item.route}</code>
            {item.quoteNumber ? ` · ${item.quoteNumber}` : ''}
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-md border px-3 py-2 text-sm whitespace-pre-wrap">
          {item.description}
        </p>
        <p className="text-muted-foreground text-xs">
          {item.userAgent ?? 'Unknown browser'} · {item.viewport ?? '?'} · build{' '}
          {item.appVersion ?? '?'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void copyIssue()}>
            <ClipboardCopyIcon aria-hidden="true" /> Copy GitHub issue
          </Button>
          {item.hasScreenshot && !shotUrl && (
            <Button type="button" variant="outline" size="sm" onClick={() => void showScreenshot()}>
              <ImageIcon aria-hidden="true" /> Show screenshot
            </Button>
          )}
        </div>
        {shotUrl && (
          <a href={shotUrl} target="_blank" rel="noreferrer">
            <img
              src={shotUrl}
              alt="Screenshot from the reporter"
              className="max-h-80 rounded-md border"
            />
          </a>
        )}
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({
              status,
              severity,
              ownerId: ownerId || null,
              githubIssueUrl: githubIssueUrl.trim() || null,
              triageNote: triageNote.trim() || null,
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Status">
              {(id) => (
                <NativeSelect
                  id={id}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as FeedbackStatus)}
                >
                  {FEEDBACK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {FEEDBACK_STATUS_LABELS[s]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Severity">
              {(id) => (
                <NativeSelect
                  id={id}
                  value={severity}
                  onChange={(e) => setSeverity(Number(e.target.value))}
                >
                  {([1, 2, 3, 4] as const).map((s) => (
                    <option key={s} value={s}>
                      {FEEDBACK_SEVERITY_LABELS[s]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Owner">
              {(id) => (
                <NativeSelect id={id} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                  <option value="">Nobody yet</option>
                  {(users.data?.items ?? [])
                    .filter((u) => u.active)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName}
                      </option>
                    ))}
                </NativeSelect>
              )}
            </Field>
          </div>
          <Field label="GitHub issue" hint="https://github.com/… after you raise it">
            {(id) => (
              <Input
                id={id}
                type="url"
                value={githubIssueUrl}
                onChange={(e) => setGithubIssueUrl(e.target.value)}
              />
            )}
          </Field>
          <Field label="Triage notes">
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                maxLength={2000}
                value={triageNote}
                onChange={(e) => setTriageNote(e.target.value)}
              />
            )}
          </Field>
          <FormErrors errors={errors} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="action"
              disabled={save.isPending}
              aria-busy={save.isPending}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
