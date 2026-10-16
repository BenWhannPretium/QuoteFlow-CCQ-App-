import type {
  CommentMention,
  PublicConfigResponse,
  TimelineFilter,
  TimelineItem as TimelineEntry,
} from '@ccq/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareIcon, RotateCcwIcon } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { stageLabel, usePublicConfig } from '@/config/public-config';
import { api, isApiError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { CommentBody } from './CommentBody';
import { ConfirmDialog } from './ConfirmDialog';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { quoteQueryKey } from './GateDecisionDialog';
import { formatOverrideValue, overrideInboxQueryKey, timelineQueryKey } from './Overrides';
import { SkeletonRows } from './Skeletons';
import { Timeline, type TimelineItem } from './Timeline';

const FILTERS: { key: TimelineFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'decisions', label: 'Decisions' },
  { key: 'overrides', label: 'Overrides' },
  { key: 'files', label: 'Files' },
  { key: 'comments', label: 'Comments' },
];

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const humanize = (type: string) => type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Title, detail and marker colour for one activity event, from config labels. */
export function describeEvent(
  e: TimelineEntry,
  config: PublicConfigResponse | undefined,
): Pick<TimelineItem, 'title' | 'detail' | 'kind'> {
  const p = e.payload;
  const field = str(p.field) ?? '';
  const fieldLabel = str(p.fieldLabel) ?? humanize(field);
  const value = (v: unknown) => formatOverrideValue(field, v, config);
  const note = (text: string | null) =>
    text ? <p className="whitespace-pre-line">{text}</p> : undefined;
  switch (e.type) {
    case 'quote_created':
      return { title: 'Quote created from the Salesforce opportunity', kind: 'stage' };
    case 'quote_resubmitted':
      return { title: 'Resubmitted after rework', kind: 'stage' };
    case 'gate_decided': {
      const gate = str(p.gateKey) ?? '';
      const outcome = config?.outcomes.find((o) => o.gateKey === gate && o.key === p.outcomeKey);
      const reason = config?.reasonCodes.find(
        (r) => r.code === p.reasonCode && r.context === outcome?.reasonContext,
      );
      return {
        title:
          `${gate} ${config?.gates.find((g) => g.key === gate)?.label ?? ''} → ${outcome?.label ?? str(p.outcomeKey) ?? ''}`.replace(
            /\s+/g,
            ' ',
          ),
        detail:
          reason || p.note ? (
            <>
              {reason && <p>Reason: {reason.label}</p>}
              {note(str(p.note))}
            </>
          ) : undefined,
        kind: 'gate',
      };
    }
    case 'stage_changed':
      return {
        title: `Moved to ${stageLabel(config, str(p.to) ?? '')}`,
        detail: p.from ? <p>From {stageLabel(config, str(p.from) ?? '')}</p> : undefined,
        kind: 'stage',
      };
    case 'hold_started':
      return { title: 'Put on hold', kind: 'stage' };
    case 'hold_ended':
      return { title: 'Hold ended', kind: 'stage' };
    case 'version_bumped':
      return { title: `New version: v${String(p.from)} → v${String(p.to)}`, kind: 'system' };
    case 'quote_closed':
      return {
        title: `Closed${str(p.closeAs) ? ` (${humanize(str(p.closeAs)!)})` : ''}`,
        kind: 'stage',
      };
    case 'priority_tier_changed':
      return {
        title: `Priority tier ${value(p.from)} → ${value(p.to)}`,
        detail: p.overridden ? <p>The displayed tier stays overridden.</p> : undefined,
        kind: 'system',
      };
    case 'override_requested':
      return {
        title: `${fieldLabel} override requested: ${value(p.from)} → ${value(p.to)}`,
        detail: note(str(p.justification)),
        kind: 'override',
      };
    case 'override_applied':
      return {
        title: `${fieldLabel} overridden: ${value(p.from)} → ${value(p.to)}`,
        detail: (
          <>
            {note(str(p.justification))}
            {p.approvalMode === 'self' && (
              <p className="text-muted-foreground text-xs">
                Self-applied{p.source === 'intake' ? ' at intake' : ''}, logged.
              </p>
            )}
            {str(p.note) && (
              <p className="text-muted-foreground text-xs">Approver: {str(p.note)}</p>
            )}
          </>
        ),
        kind: 'override',
      };
    case 'override_rejected':
      return {
        title: `${fieldLabel} override rejected (${value(p.to)})`,
        detail: note(str(p.note)),
        kind: 'override',
      };
    case 'override_reverted':
      return {
        title: `${fieldLabel} override reverted: back to ${value(p.to)}`,
        kind: 'override',
      };
    case 'ship_to_overridden':
      return {
        title: 'Ship-to overridden at intake',
        detail: note(str(p.reason)),
        kind: 'override',
      };
    case 'attachment_uploaded':
      return { title: `File uploaded: ${str(p.fileName) ?? 'file'}`, kind: 'file' };
    case 'attachment_removed':
      return { title: `File removed: ${str(p.fileName) ?? 'file'}`, kind: 'file' };
    // B-10 engineering queue and review. Payloads carry field names only (never commercial values).
    case 'engineer_assigned':
      return {
        title: str(p.from)
          ? `Reassigned from ${str(p.fromName) ?? 'an engineer'} to ${str(p.toName) ?? 'an engineer'}`
          : `Assigned to ${str(p.toName) ?? 'an engineer'}`,
        kind: 'system',
      };
    case 'eng_review_accepted':
      return { title: 'Engineering review accepted', kind: 'system' };
    case 'eng_review_updated': {
      const fields = Array.isArray(p.fields)
        ? (p.fields as unknown[]).filter((f) => typeof f === 'string')
        : [];
      return {
        title: 'Engineering review updated',
        detail: fields.length ? (
          <p>
            {fields
              .map((f) =>
                humanize(
                  String(f)
                    .replace(/([a-z])([A-Z])/g, '$1_$2')
                    .toLowerCase(),
                ),
              )
              .join(', ')}
          </p>
        ) : undefined,
        kind: 'system',
      };
    }
    case 'capacity_evidence_updated':
      return {
        title: 'Capacity evidence updated',
        detail: (
          <p>
            {[
              Number(p.added) > 0 && `${Number(p.added)} added`,
              Number(p.updated) > 0 && `${Number(p.updated)} updated`,
              Number(p.removed) > 0 && `${Number(p.removed)} removed`,
            ]
              .filter(Boolean)
              .join(', ') || 'No rows'}
          </p>
        ),
        kind: 'system',
      };
    case 'sf_status_changed':
      return {
        title: str(p.sfStatusFlag)
          ? `Salesforce: opportunity ${humanize(str(p.sfStatusFlag)!).toLowerCase()}`
          : 'Salesforce: opportunity open again',
        kind: 'system',
      };
    default:
      return { title: humanize(e.type), kind: 'system' };
  }
}

/** The quote's timeline (F-08): filter chips, newest first, "Load older", comments and revert. */
export function QuoteTimeline({ quoteNumber }: { quoteNumber: string }) {
  const { data: config } = usePublicConfig();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [reverting, setReverting] = useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: [...timelineQueryKey(quoteNumber), filter],
    queryFn: ({ pageParam }) => api.timeline(quoteNumber, { filter, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const revert = useMutation({
    mutationFn: (id: string) => api.revertOverride(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: quoteQueryKey(quoteNumber) }),
        queryClient.invalidateQueries({ queryKey: timelineQueryKey(quoteNumber) }),
        queryClient.invalidateQueries({ queryKey: overrideInboxQueryKey }),
      ]);
      toast.success({ title: 'Override reverted', description: 'The original value is back.' });
      setReverting(null);
    },
    onError: (err) => {
      // 5xx and network failures already toast globally; 4xx (409: changed since) are explained here.
      if (isApiError(err) && err.status < 500) {
        toast.error({ title: 'Could not revert', description: describeError(err).message });
      }
      setReverting(null);
    },
  });

  const entries = query.data?.pages.flatMap((p) => p.items) ?? [];
  const items: TimelineItem[] = entries.map((e) => {
    if (e.kind === 'comment') {
      return {
        id: e.id,
        at: e.at,
        title: (
          <span className="inline-flex items-center gap-1.5">
            <MessageSquareIcon className="text-muted-foreground size-3.5" aria-hidden="true" />
            Comment
          </span>
        ),
        actor: e.actorName ?? 'Someone',
        detail: <CommentBody body={e.comment?.body ?? ''} mentions={e.comment?.mentions ?? []} />,
        kind: 'note',
      };
    }
    return {
      id: e.id,
      at: e.at,
      actor: e.actorName ?? 'System',
      ...describeEvent(e, config),
      action: e.override?.canRevert ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setReverting(e.override!.id)}
          data-testid="revert-override"
        >
          <RotateCcwIcon aria-hidden="true" />
          Revert
        </Button>
      ) : undefined,
    };
  });

  return (
    <section className="grid gap-4" aria-labelledby="timeline-heading" data-testid="quote-timeline">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="timeline-heading" className="text-base font-semibold">
          Timeline
        </h2>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'min-h-9 rounded-full border px-3 text-xs font-medium sm:min-h-8',
                filter === f.key
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-line-strong bg-card hover:bg-accent',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <CommentComposer quoteNumber={quoteNumber} />

      {query.isPending && <SkeletonRows rows={4} />}
      {query.error && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data && items.length === 0 && (
        <EmptyState
          icon={MessageSquareIcon}
          title="Nothing here yet"
          description={
            filter === 'all'
              ? 'Events and comments appear as the quote moves.'
              : 'Nothing of this kind yet.'
          }
        />
      )}
      {items.length > 0 && <Timeline items={items} label={`Timeline for ${quoteNumber}`} />}
      {query.hasNextPage && (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            Load older
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={reverting !== null}
        onOpenChange={(open) => !open && setReverting(null)}
        title="Revert this override?"
        description="The value goes back to exactly what it was before the override. This is logged."
        confirmLabel="Revert"
        busy={revert.isPending}
        onConfirm={() => reverting && revert.mutate(reverting)}
      />
    </section>
  );
}

/** "@ana" at the caret: the text being typed after an @, for the picker. */
const mentionQuery = (text: string, caret: number) =>
  /(?:^|\s)@([^\s@]{1,30})$/.exec(text.slice(0, caret))?.[1] ?? null;

/** Comment box with an @mention picker. Mentioned users are notified (B-18 delivers email). */
function CommentComposer({ quoteNumber }: { quoteNumber: string }) {
  const queryClient = useQueryClient();
  const ids = { box: useId(), list: useId() };
  const ref = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<CommentMention[]>([]);
  const [q, setQ] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const users = useQuery({
    queryKey: ['users', q],
    queryFn: () => api.searchUsers(q!),
    enabled: !!q && q.length >= 1,
    staleTime: 60_000,
  });
  const options = q ? (users.data?.items ?? []) : [];

  const send = useMutation({
    mutationFn: () =>
      api.addComment(quoteNumber, {
        body,
        mentions: mentions.filter((m) => body.includes(`@${m.name}`)).map((m) => m.userId),
      }),
    onSuccess: async () => {
      setBody('');
      setMentions([]);
      await queryClient.invalidateQueries({ queryKey: timelineQueryKey(quoteNumber) });
    },
    onError: (err) => {
      if (isApiError(err) && err.status < 500) {
        toast.error({
          title: 'Could not post the comment',
          description: describeError(err).message,
        });
      }
    },
  });

  const pick = (u: { id: string; displayName: string }) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? body.length;
    const before = body.slice(0, caret).replace(/@[^\s@]{1,30}$/, `@${u.displayName} `);
    const next = before + body.slice(caret);
    setBody(next);
    setMentions((m) =>
      m.some((x) => x.userId === u.id) ? m : [...m, { userId: u.id, name: u.displayName }],
    );
    setQ(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (options.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(options[Math.min(active, options.length - 1)]!);
        return;
      }
      if (e.key === 'Escape') {
        setQ(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) send.mutate();
  };

  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) send.mutate();
      }}
    >
      <label htmlFor={ids.box} className="sr-only">
        Add a comment
      </label>
      <div className="relative">
        <Textarea
          ref={ref}
          id={ids.box}
          value={body}
          maxLength={4000}
          placeholder="Add a comment. Type @ to mention someone; **bold**, _italic_ and - lists work."
          onChange={(e) => {
            setBody(e.target.value);
            setQ(mentionQuery(e.target.value, e.target.selectionStart));
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setQ(null), 150)}
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={ids.list}
          aria-autocomplete="list"
          aria-activedescendant={options.length > 0 ? `${ids.list}-${active}` : undefined}
          className="min-h-20"
          data-testid="comment-box"
        />
        {options.length > 0 && (
          <ul
            id={ids.list}
            role="listbox"
            aria-label="People"
            className="bg-popover text-popover-foreground absolute top-full left-0 z-20 mt-1 grid w-full max-w-sm rounded-md border p-1 shadow-md"
          >
            {options.map((u, i) => (
              <li
                key={u.id}
                id={`${ids.list}-${i}`}
                role="option"
                aria-selected={i === active}
                className={cn(
                  'cursor-pointer rounded px-2 py-1.5 text-sm',
                  i === active && 'bg-accent',
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(u);
                }}
              >
                <span className="font-medium">{u.displayName}</span>{' '}
                <span className="text-muted-foreground text-xs">{u.upn}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!body.trim() || send.isPending}>
          Comment
        </Button>
      </div>
    </form>
  );
}
