import type {
  CommentMention,
  CreateCommentBody,
  TimelineItem,
  TimelineQuery,
  TimelineResponse,
  UserSearchResponse,
} from '@ccq/contracts';
import { TIMELINE_PROBLEM_CODES } from '@ccq/contracts';
import type { Tx } from '@ccq/db';
import {
  findUserById,
  getQuoteByNumber,
  insertComment,
  listOverridesWithContext,
  listTimeline,
  listUsersByIds,
  searchUsers,
  type TimelineRow,
} from '@ccq/db/repos';
import {
  asUserId,
  canSeePriorityScore,
  COMMENT_MAX_MENTIONS,
  overrideActions,
  plainTextOf,
  resolveMentions,
  sanitizeCommentBody,
  timelineCategory,
  timelineFilterTypes,
  type Actor,
} from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

import { decodeCursor, page } from './cursor';
import { persistNotifications } from './notificationService';
import { overrideQuoteOf, overrideRecordOf } from './overrides-view';
import { ServiceProblem } from './problem';
import type { QuoteReadService, QuoteViewContext } from './quotes';
import { recordAudit, type AuditMeta } from '../plugins/audit';

export type TimelineWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

/** Event types that reveal the priority score or tier (hidden by `kam_can_see_peer_scores`). */
const PRIORITY_TYPES = new Set(['priority_tier_changed']);
const OVERRIDE_TYPES = new Set([
  'override_requested',
  'override_applied',
  'override_rejected',
  'override_reverted',
]);

export interface TimelineServiceOptions {
  quotes: QuoteReadService;
  log?: FastifyBaseLogger;
  now?: () => Date;
}

const asMentionIds = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/**
 * The quote timeline (F-08): activity events and comments, newest first, with filter chips and keyset
 * paging; and comments with @mentions (sanitized markdown-lite; mentions notify the user).
 */
export class TimelineService {
  private readonly now: () => Date;

  constructor(private readonly opts: TimelineServiceOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  private async quoteOr404(tx: Tx, quoteNumber: string) {
    const quote = await getQuoteByNumber(tx, quoteNumber);
    if (!quote) {
      throw new ServiceProblem(404, TIMELINE_PROBLEM_CODES.notFound, `No quote ${quoteNumber}`);
    }
    return quote;
  }

  /** Map rows to DTOs: names for mentions, revert flags for override events, priority redaction. */
  private async items(
    tx: Tx,
    ctx: QuoteViewContext,
    quote: Awaited<ReturnType<typeof getQuoteByNumber>> & object,
    rows: TimelineRow[],
  ): Promise<TimelineItem[]> {
    const showPriority = canSeePriorityScore(
      ctx.actor,
      asUserId(quote.kamUserId),
      ctx.kamCanSeePeerScores,
    );
    const visible = rows.filter(
      (r) =>
        showPriority ||
        !(
          PRIORITY_TYPES.has(r.type) ||
          (OVERRIDE_TYPES.has(r.type) && r.payload.field === 'priority_tier')
        ),
    );

    const mentionIds = [
      ...new Set(
        visible.flatMap((r) => (r.kind === 'comment' ? asMentionIds(r.payload.mentions) : [])),
      ),
    ];
    const names = new Map(
      (await listUsersByIds(tx, mentionIds)).map((u) => [u.id, u.displayName] as const),
    );

    const overrideIds = [
      ...new Set(
        visible
          .filter((r) => OVERRIDE_TYPES.has(r.type) && typeof r.payload.overrideId === 'string')
          .map((r) => r.payload.overrideId as string),
      ),
    ];
    const overrides = new Map(
      overrideIds.length
        ? (await listOverridesWithContext(tx, { quoteId: quote.id, limit: 500 })).map(
            (o) => [o.override.id, o] as const,
          )
        : [],
    );

    return visible.map((r): TimelineItem => {
      const mentions: CommentMention[] = asMentionIds(r.payload.mentions)
        .filter((id) => names.has(id))
        .map((id) => ({ userId: id, name: names.get(id)! }));
      const o =
        typeof r.payload.overrideId === 'string' ? overrides.get(r.payload.overrideId) : undefined;
      return {
        id: r.id,
        kind: r.kind,
        type: r.type,
        category: r.kind === 'comment' ? 'comment' : timelineCategory(r.type),
        actorId: r.actorId,
        actorName: r.actorName,
        at: r.at.toISOString(),
        payload: r.kind === 'comment' ? {} : r.payload,
        comment:
          r.kind === 'comment'
            ? { body: typeof r.payload.body === 'string' ? r.payload.body : '', mentions }
            : null,
        override: o
          ? {
              id: o.override.id,
              status: o.override.status,
              canRevert:
                r.type === 'override_applied' &&
                overrideActions(
                  ctx.overrides,
                  ctx.actor,
                  overrideQuoteOf(o),
                  overrideRecordOf(o.override),
                ).canRevert,
            }
          : null,
      };
    });
  }

  async timeline(
    withTx: TimelineWithTx,
    actor: Actor,
    quoteNumber: string,
    query: TimelineQuery,
  ): Promise<TimelineResponse> {
    const before = query.cursor ? decodeCursor(query.cursor) : undefined;
    if (before === null) {
      throw new ServiceProblem(400, TIMELINE_PROBLEM_CODES.badCursor, 'The cursor is not valid');
    }
    const at = this.now();
    return withTx(async (tx) => {
      const quote = await this.quoteOr404(tx, quoteNumber);
      const ctx = await this.opts.quotes.context(tx, actor, at);
      const { types, comments } = timelineFilterTypes(query.filter);
      const rows = await listTimeline(tx, {
        quoteId: quote.id,
        types,
        comments,
        before,
        limit: query.limit + 1,
      });
      const { items, nextCursor } = page(rows, query.limit, (r) => ({ at: r.at, id: r.id }));
      return { items: await this.items(tx, ctx, quote, items), nextCursor };
    });
  }

  async comment(
    withTx: TimelineWithTx,
    actor: Actor,
    quoteNumber: string,
    body: CreateCommentBody,
    meta: AuditMeta,
  ): Promise<TimelineItem> {
    const text = sanitizeCommentBody(body.body);
    if (!text) {
      throw new ServiceProblem(422, TIMELINE_PROBLEM_CODES.rejected, 'Write a comment first', {
        errors: [{ path: '/body', message: 'Write a comment first', code: 'EMPTY' }],
      });
    }
    const at = this.now();
    return withTx(async (tx) => {
      const quote = await this.quoteOr404(tx, quoteNumber);
      const ctx = await this.opts.quotes.context(tx, actor, at);
      const picked = await listUsersByIds(
        tx,
        [...new Set(body.mentions)].slice(0, COMMENT_MAX_MENTIONS),
      );
      // Only people still @named in the text are mentioned (and notified).
      const mentions = resolveMentions(
        text,
        picked.filter((u) => u.active).map((u) => ({ userId: u.id, name: u.displayName })),
      );
      const row = await insertComment(tx, {
        quoteId: quote.id,
        authorId: actor.userId,
        body: text,
        mentions: mentions.map((m) => m.userId),
        createdAt: at,
        createdBy: actor.userId,
      });
      await recordAudit(tx, actor, meta, {
        at,
        action: 'create',
        entity: 'comment',
        entityId: row.id,
        quoteId: quote.id,
        after: { mentions: mentions.map((m) => m.userId), length: text.length },
      });
      const author = (await findUserById(tx, actor.userId))?.displayName ?? 'Someone';
      const excerpt = plainTextOf(text, mentions);
      await persistNotifications(
        tx,
        mentions.map((m) => ({
          type: 'comment.mention',
          recipient: { kind: 'user', userId: asUserId(m.userId) },
        })),
        {
          quoteId: quote.id,
          title: `${author} mentioned you on ${quote.quoteNumber}`,
          body: excerpt.length > 280 ? `${excerpt.slice(0, 277)}…` : excerpt,
          excludeUserId: actor.userId,
          // The email says who and where, never what: the comment may mention prices.
          payload: { actor: author },
        },
        this.opts.log,
      );
      const [item] = await this.items(tx, ctx, quote, [
        {
          kind: 'comment',
          id: row.id,
          type: 'comment_added',
          actorId: actor.userId,
          actorName: author,
          at: row.createdAt,
          payload: { body: row.body, mentions: row.mentions },
        },
      ]);
      return item!;
    });
  }

  /** The @mention picker: active users by name / UPN / email. */
  async users(withTx: TimelineWithTx, q: string, limit: number): Promise<UserSearchResponse> {
    return withTx(async (tx) => ({
      items: (await searchUsers(tx, q, limit)).map((u) => ({
        id: u.id,
        displayName: u.displayName,
        upn: u.upn,
      })),
    }));
  }
}
