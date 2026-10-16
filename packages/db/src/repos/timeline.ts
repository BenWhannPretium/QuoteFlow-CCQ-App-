import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { activityEvent, appUser, comment } from '../schema/index';

export interface TimelineQuery {
  quoteId: string;
  /** Activity types to include; null = every type, [] = none. */
  types: readonly string[] | null;
  /** Include comment rows. */
  comments: boolean;
  /** Keyset: items strictly older than (at, id). */
  before?: { at: Date; id: string } | undefined;
  limit: number;
}

export interface TimelineRow {
  kind: 'activity' | 'comment';
  id: string;
  type: string;
  actorId: string | null;
  actorName: string | null;
  at: Date;
  payload: Record<string, unknown>;
}

/**
 * The quote timeline (F-08): `activity_event` and `comment` rows merged newest first, keyset-paged on
 * (at, id). Both tables are under RLS, so the caller only ever sees a quote they may read.
 */
export async function listTimeline(db: DbOrTx, q: TimelineQuery): Promise<TimelineRow[]> {
  const parts: SQL[] = [];
  if (q.types === null || q.types.length > 0) {
    const typeFilter =
      q.types === null
        ? sql``
        : sql` and a.type in (${sql.join(
            q.types.map((t) => sql`${t}`),
            sql`, `,
          )})`;
    parts.push(sql`
      select 'activity' as kind, a.id, a.type, a.actor_id, a.at, a.payload
      from ${activityEvent} a where a.quote_id = ${q.quoteId}${typeFilter}`);
  }
  if (q.comments) {
    parts.push(sql`
      select 'comment' as kind, c.id, 'comment_added' as type, c.author_id as actor_id, c.created_at as at,
        jsonb_build_object('body', c.body, 'mentions', to_jsonb(c.mentions)) as payload
      from ${comment} c where c.quote_id = ${q.quoteId}`);
  }
  if (parts.length === 0) return [];

  const cursor = q.before
    ? sql`where (t.at, t.id) < (${q.before.at.toISOString()}::timestamptz, ${q.before.id}::uuid)`
    : sql``;
  const rows = await db.execute<{
    kind: 'activity' | 'comment';
    id: string;
    type: string;
    actor_id: string | null;
    actor_name: string | null;
    at: string | Date;
    payload: Record<string, unknown> | null;
  }>(sql`
    select t.kind, t.id, t.type, t.actor_id, u.display_name as actor_name, t.at, t.payload
    from (${sql.join(parts, sql` union all `)}) t
    left join ${appUser} u on u.id = t.actor_id
    ${cursor}
    order by t.at desc, t.id desc
    limit ${q.limit}`);
  return [...rows].map((r) => ({
    kind: r.kind,
    id: r.id,
    type: r.type,
    actorId: r.actor_id,
    actorName: r.actor_name,
    at: new Date(r.at),
    payload: r.payload ?? {},
  }));
}
