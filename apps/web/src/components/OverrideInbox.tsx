import type { OverrideDto } from '@ccq/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon, InboxIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { usePublicConfig } from '@/config/public-config';
import { api, isApiError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { absoluteTime, relativeTime } from '@/lib/time';
import { toast } from '@/lib/toast';

import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { quoteQueryKey } from './GateDecisionDialog';
import { formatOverrideValue, overrideInboxQueryKey, timelineQueryKey } from './Overrides';
import { SkeletonRows } from './Skeletons';

/** Approvals → "Override requests": the open requests the signed-in approver may decide. */
export function OverrideInbox() {
  const inbox = useQuery({ queryKey: overrideInboxQueryKey, queryFn: api.overrideInbox });
  return (
    <section
      className="grid gap-3"
      aria-labelledby="override-inbox-heading"
      data-testid="override-inbox"
    >
      <h2 id="override-inbox-heading" className="text-base font-semibold">
        Override requests
        {inbox.data && inbox.data.items.length > 0 && (
          <span className="bg-action text-action-foreground ml-2 rounded-full px-2 py-0.5 text-xs">
            {inbox.data.items.length}
          </span>
        )}
      </h2>
      {inbox.isPending && <SkeletonRows rows={2} />}
      {inbox.error && <ErrorState error={inbox.error} onRetry={() => void inbox.refetch()} />}
      {inbox.data?.items.length === 0 && (
        <EmptyState
          icon={InboxIcon}
          title="No override requests"
          description="Requests to change a priority tier appear here for you to approve or reject."
        />
      )}
      {inbox.data && inbox.data.items.length > 0 && (
        <ul className="grid gap-3">
          {inbox.data.items.map((o) => (
            <InboxItem key={o.id} override={o} />
          ))}
        </ul>
      )}
    </section>
  );
}

function InboxItem({ override: o }: { override: OverrideDto }) {
  const { data: config } = usePublicConfig();
  const queryClient = useQueryClient();
  const noteId = useId();
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      decision === 'approve'
        ? api.approveOverride(o.id, note.trim())
        : api.rejectOverride(o.id, note.trim()),
    onSuccess: async ({ override }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: overrideInboxQueryKey }),
        queryClient.invalidateQueries({ queryKey: quoteQueryKey(o.quoteNumber) }),
        queryClient.invalidateQueries({ queryKey: timelineQueryKey(o.quoteNumber) }),
      ]);
      toast.success({
        title:
          override.status === 'applied' ? 'Override approved and applied' : 'Override rejected',
        description: `${o.quoteNumber}: ${o.fieldLabel}`,
      });
    },
    onError: async (err) => {
      if (isApiError(err) && err.status < 500) {
        toast.error({
          title: 'Could not record the decision',
          description: describeError(err).message,
        });
        await queryClient.invalidateQueries({ queryKey: overrideInboxQueryKey });
      }
    },
  });
  const value = (v: unknown) => formatOverrideValue(o.field, v, config);

  return (
    <li
      className="bg-card rounded-card grid gap-3 border p-4"
      data-testid="override-request"
      data-override={o.id}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          to="/quotes/$quoteNumber"
          params={{ quoteNumber: o.quoteNumber }}
          className="font-semibold underline-offset-4 hover:underline"
        >
          {o.quoteNumber}
        </Link>
        <span className="text-muted-foreground text-xs">
          {o.requestedByName ?? 'Someone'} ·{' '}
          <time dateTime={o.requestedAt} title={absoluteTime(o.requestedAt)}>
            {relativeTime(o.requestedAt)}
          </time>
        </span>
      </div>
      {o.customerName && <p className="text-muted-foreground -mt-2 text-sm">{o.customerName}</p>}
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{o.fieldLabel}:</span>
        <span>{value(o.originalValue)}</span>
        <ArrowRightIcon className="size-4" aria-label="to" />
        <span className="font-semibold">{value(o.requestedValue)}</span>
      </p>
      <p className="text-foreground-2 text-sm whitespace-pre-line">{o.justification}</p>
      <div className="grid gap-1.5">
        <label htmlFor={noteId} className="text-xs font-medium">
          Note {rejecting ? '(required to reject)' : '(optional)'}
        </label>
        <Textarea
          id={noteId}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-16"
          aria-invalid={rejecting && !note.trim()}
        />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          disabled={decide.isPending}
          onClick={() => {
            setRejecting(true);
            if (note.trim()) decide.mutate('reject');
          }}
        >
          Reject
        </Button>
        <Button disabled={decide.isPending} onClick={() => decide.mutate('approve')}>
          Approve
        </Button>
      </div>
    </li>
  );
}
