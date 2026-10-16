import { z } from 'zod';

// ── Quote timeline and comments (F-08, B-09) ─────────────────────────────────────────────────────

export const TIMELINE_FILTER_VALUES = [
  'all',
  'decisions',
  'overrides',
  'files',
  'comments',
] as const;
export const TimelineFilter = z.enum(TIMELINE_FILTER_VALUES);
export type TimelineFilter = z.infer<typeof TimelineFilter>;

export const TimelineCategory = z.enum(['decision', 'override', 'file', 'comment', 'other']);
export type TimelineCategory = z.infer<typeof TimelineCategory>;

export const CommentMention = z.object({ userId: z.uuid(), name: z.string() });
export type CommentMention = z.infer<typeof CommentMention>;

/**
 * One timeline entry: an `activity_event` (stage change, gate decision, override, upload, assignment,
 * SF flag change, …) or a comment. `payload` is the event's details, already redacted for the caller.
 */
export const TimelineItem = z.object({
  id: z.uuid(),
  kind: z.enum(['activity', 'comment']),
  type: z.string(),
  category: TimelineCategory,
  actorId: z.uuid().nullable(),
  /** Null for system jobs (SF sync). */
  actorName: z.string().nullable(),
  /** ISO 8601 UTC. */
  at: z.string(),
  payload: z.record(z.string(), z.unknown()),
  /** Comments: the sanitized markdown-lite body and the users it mentions. */
  comment: z.object({ body: z.string(), mentions: z.array(CommentMention) }).nullable(),
  /** Override events: the override and whether the caller may revert it now. */
  override: z.object({ id: z.uuid(), status: z.string(), canRevert: z.boolean() }).nullable(),
});
export type TimelineItem = z.infer<typeof TimelineItem>;

export const TimelineQuery = z.object({
  cursor: z.string().max(200).optional(),
  filter: TimelineFilter.default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type TimelineQuery = z.infer<typeof TimelineQuery>;

export const TimelineResponse = z.object({
  items: z.array(TimelineItem),
  /** Pass as `cursor` for the next (older) page; null on the last page. */
  nextCursor: z.string().nullable(),
});
export type TimelineResponse = z.infer<typeof TimelineResponse>;

export const COMMENT_BODY_MAX = 4000;

/** POST /api/v1/quotes/:quoteNumber/comments. `mentions` are the user ids picked in the composer. */
export const CreateCommentBody = z.object({
  body: z.string().min(1).max(COMMENT_BODY_MAX),
  mentions: z.array(z.uuid()).max(20).default([]),
});
export type CreateCommentBody = z.infer<typeof CreateCommentBody>;

export const CommentResponse = z.object({ item: TimelineItem });
export type CommentResponse = z.infer<typeof CommentResponse>;

/** GET /api/v1/users?q=: the @mention picker. */
export const UserSearchQuery = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
export const UserSearchResponse = z.object({
  items: z.array(z.object({ id: z.uuid(), displayName: z.string(), upn: z.string() })),
});
export type UserSearchResponse = z.infer<typeof UserSearchResponse>;

export const TIMELINE_PROBLEM_CODES = {
  notFound: 'not_found',
  badCursor: 'bad_cursor',
  rejected: 'comment_rejected',
} as const;
