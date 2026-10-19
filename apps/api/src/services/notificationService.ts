import { NOTIFICATION_PROBLEM_CODES } from '@ccq/contracts';
import type {
  MarkNotificationReadResponse,
  MarkNotificationsReadResponse,
  NotificationListQuery,
  NotificationListResponse,
  PreferencesResponse,
  UpdatePreferencesBody,
} from '@ccq/contracts';
import type { DbOrTx, Tx } from '@ccq/db';
import {
  countUnreadInApp,
  getSetting,
  insertNotificationRows,
  insertNotificationRowsCounted,
  listActiveUserIdsWithRoles,
  listEmailOptOuts,
  listNotificationFeed,
  listUserPreferences,
  listUsersForEmail,
  markAllInAppRead,
  markInAppRead,
  setUserPreference,
  type NewNotification,
} from '@ccq/db/repos';
import {
  emailDeliveryFor,
  emailPreferenceEvents,
  emailPreferenceKey,
  isEmailPreferenceType,
  type Actor,
  type PlannedNotification,
  type Role,
} from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

import { decodeCursor, page } from './cursor';
import { ServiceProblem } from './problem';
import { recordAudit, type AuditMeta } from '../plugins/audit';

// ── Writing notifications (B-18) ────────────────────────────────────────────────────────────────
//
// Every notification is written in the caller's transaction, so a rolled-back change leaves nothing
// behind. One draft becomes an in-app row (always) and, for types the catalogue emails immediately, an
// email row in the outbox (`channel = 'email'`) that the dispatcher job sends. Email is skipped when the
// app setting `email_notifications_enabled` is false, when the recipient has opted out of that type,
// or when the recipient is inactive or has no address.

/** A notification for one user. `payload` holds the non-commercial facts the email is built from. */
export interface NotificationDraft {
  userId: string;
  type: string;
  quoteId: string | null;
  title: string;
  body: string;
  /** Strings only: actor name, reason label, validity date. Never prices, margins or capital. */
  payload?: Record<string, string>;
  /** Once per (user, channel, key): a repeat is skipped. */
  dedupeKey?: string;
  /** The event time. Default: now. */
  at?: Date;
}

export const EMAIL_ENABLED_SETTING = 'email_notifications_enabled';

/** The app-wide email switch (a config row, so Admin can turn email off without a deploy). */
export async function emailNotificationsEnabled(db: DbOrTx): Promise<boolean> {
  return ((await getSetting<boolean>(db, EMAIL_ENABLED_SETTING)) ?? true) !== false;
}

/**
 * Who of `drafts`' recipients may be emailed for the types in `deliveries`: the app-wide switch is on,
 * the user is active with an address, and has not opted out of that type.
 */
async function emailEligibility(
  db: DbOrTx,
  drafts: readonly NotificationDraft[],
): Promise<(d: NotificationDraft) => boolean> {
  if (drafts.length === 0 || !(await emailNotificationsEnabled(db))) return () => false;
  const ids = [...new Set(drafts.map((d) => d.userId))];
  const emailable = new Map<string, { email: string | null; active: boolean }>();
  for (const u of await listUsersForEmail(db, ids)) {
    emailable.set(u.id, { email: u.email, active: u.active });
  }
  const optedOut = new Map<string, Set<string>>();
  for (const type of new Set(drafts.map((d) => d.type))) {
    optedOut.set(type, await listEmailOptOuts(db, ids, emailPreferenceKey(type)));
  }
  return (d) => {
    const to = emailable.get(d.userId);
    return Boolean(to?.email && to.active && !optedOut.get(d.type)?.has(d.userId));
  };
}

function rowFor(d: NotificationDraft, channel: 'in_app' | 'email'): NewNotification {
  const at = d.at ?? new Date();
  return {
    userId: d.userId,
    type: d.type,
    quoteId: d.quoteId,
    title: d.title,
    body: d.body,
    payload: d.payload ?? {},
    dedupeKey: d.dedupeKey ?? null,
    channel,
    createdAt: at,
    updatedAt: at,
    ...(channel === 'email' ? { nextAttemptAt: at } : {}),
  };
}

/**
 * Insert the in-app rows and the email rows for `drafts`. Returns how many in-app rows were written for
 * the drafts (not counting any a dedupe key skipped when `counted`).
 *
 * `counted` reads the inserted rows back, which only a context that can see every notification may do
 * (the system jobs: Admin). A request context (a KAM creating the EngLead's alert) must not use it.
 */
export async function createNotifications(
  db: DbOrTx,
  drafts: readonly NotificationDraft[],
  log?: FastifyBaseLogger,
  opts: { counted?: boolean } = {},
): Promise<number> {
  if (drafts.length === 0) return 0;
  const immediate = drafts.filter((d) => emailDeliveryFor(d.type) === 'immediate');
  const mayEmail = await emailEligibility(db, immediate);
  const rows: NewNotification[] = [];
  for (const d of drafts) {
    rows.push(rowFor(d, 'in_app'));
    if (emailDeliveryFor(d.type) === 'immediate' && mayEmail(d)) rows.push(rowFor(d, 'email'));
  }
  const emails = rows.filter((r) => r.channel === 'email').length;
  let inApp = drafts.length;
  if (opts.counted) {
    const inserted = await insertNotificationRowsCounted(db, rows);
    inApp = inserted.filter((r) => r.channel === 'in_app').length;
  } else {
    await insertNotificationRows(db, rows);
  }
  log?.info(
    { quoteId: drafts[0]?.quoteId ?? null, inApp: drafts.length, email: emails },
    'notifications queued',
  );
  return inApp;
}

/**
 * Queue the email for a `daily_digest` type: email only, no in-app row (each item already has its own).
 * Returns the number of emails queued; the same `dedupeKey` twice queues once. System context only.
 */
export async function queueDigestEmails(
  db: DbOrTx,
  drafts: readonly NotificationDraft[],
): Promise<number> {
  const digests = drafts.filter((d) => emailDeliveryFor(d.type) === 'daily_digest');
  const mayEmail = await emailEligibility(db, digests);
  const rows = digests.filter(mayEmail).map((d) => rowFor(d, 'email'));
  // System context only (the dispatcher): it can read every row back, so a repeat reports zero.
  return (await insertNotificationRowsCounted(db, rows)).length;
}

export interface NotificationContent {
  quoteId: string | null;
  title: string;
  body: string;
  /** Never notify the person who caused the event. */
  excludeUserId?: string;
  payload?: Record<string, string>;
  dedupeKey?: string;
  at?: Date;
}

/**
 * Notify what the domain planned (`effects.notifications`, or a hand-built list). A role recipient is
 * every active user holding the role; a user recipient is that user. One notification per person per
 * type. Written in the caller's transaction.
 */
export async function persistNotifications(
  db: DbOrTx,
  planned: readonly PlannedNotification[],
  content: NotificationContent,
  log?: FastifyBaseLogger,
): Promise<number> {
  const roles = [
    ...new Set(planned.flatMap((p) => (p.recipient.kind === 'role' ? [p.recipient.role] : []))),
  ] as Role[];
  const usersByRole = new Map<Role, string[]>();
  for (const role of roles) {
    usersByRole.set(role, await listActiveUserIdsWithRoles(db, [role]));
  }

  const recipients = new Map<string, string>(); // `${userId}|${type}` → userId
  const drafts: NotificationDraft[] = [];
  for (const p of planned) {
    const ids =
      p.recipient.kind === 'user' ? [p.recipient.userId] : usersByRole.get(p.recipient.role)!;
    for (const userId of ids) {
      if (userId === content.excludeUserId) continue;
      const key = `${userId}|${p.type}`;
      if (recipients.has(key)) continue;
      recipients.set(key, userId);
      drafts.push({
        userId,
        type: p.type,
        quoteId: content.quoteId,
        title: content.title,
        body: content.body,
        ...(content.payload ? { payload: content.payload } : {}),
        ...(content.dedupeKey ? { dedupeKey: content.dedupeKey } : {}),
        ...(content.at ? { at: content.at } : {}),
      });
    }
  }
  return createNotifications(db, drafts, log);
}

// ── Reading: the feed and preferences ───────────────────────────────────────────────────────────

export type NotificationWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export class NotificationError extends ServiceProblem {
  override name = 'NotificationError';
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export interface NotificationServiceOptions {
  now?: () => Date;
}

/** The caller's in-app feed, read state and email preferences. Everything is the caller's own. */
export class NotificationService {
  private readonly now: () => Date;

  constructor(opts: NotificationServiceOptions = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  async list(
    withTx: NotificationWithTx,
    actor: Actor,
    query: NotificationListQuery,
  ): Promise<NotificationListResponse> {
    const before = query.cursor ? decodeCursor(query.cursor) : undefined;
    if (query.cursor && !before) {
      throw new NotificationError(400, NOTIFICATION_PROBLEM_CODES.badCursor, 'Unknown cursor');
    }
    return withTx(async (tx) => {
      const { items, unread } = await listNotificationFeed(tx, actor.userId, {
        limit: query.limit,
        before: before ? { createdAt: before.at, id: before.id } : undefined,
        unreadOnly: query.unread,
      });
      const { items: pageItems, nextCursor } = page(items, query.limit, (r) => ({
        at: r.notification.createdAt,
        id: r.notification.id,
      }));
      return {
        unread,
        items: pageItems.map(({ notification: n, quoteNumber }) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          quoteNumber: quoteNumber ?? null,
          createdAt: n.createdAt.toISOString(),
          readAt: iso(n.readAt),
        })),
        nextCursor,
      };
    });
  }

  async markRead(
    withTx: NotificationWithTx,
    actor: Actor,
    id: string,
  ): Promise<MarkNotificationReadResponse> {
    const at = this.now();
    return withTx(async (tx) => {
      if (!(await markInAppRead(tx, actor.userId, id, at))) {
        throw new NotificationError(
          404,
          NOTIFICATION_PROBLEM_CODES.notFound,
          'No such notification',
        );
      }
      return { unread: await countUnreadInApp(tx, actor.userId) };
    });
  }

  async markAllRead(
    withTx: NotificationWithTx,
    actor: Actor,
  ): Promise<MarkNotificationsReadResponse> {
    const at = this.now();
    return withTx(async (tx) => ({ marked: await markAllInAppRead(tx, actor.userId, at) }));
  }

  private async preferenceView(tx: Tx, actor: Actor): Promise<PreferencesResponse> {
    const stored = new Map(
      (await listUserPreferences(tx, actor.userId)).map((p) => [p.key, p.value]),
    );
    return {
      emailAvailable: await emailNotificationsEnabled(tx),
      email: emailPreferenceEvents().map((e) => ({
        type: e.type,
        label: e.label,
        description: e.description,
        delivery: e.email as 'immediate' | 'daily_digest',
        enabled: stored.get(emailPreferenceKey(e.type)) !== false,
      })),
    };
  }

  preferences(withTx: NotificationWithTx, actor: Actor): Promise<PreferencesResponse> {
    return withTx((tx) => this.preferenceView(tx, actor));
  }

  async updatePreferences(
    withTx: NotificationWithTx,
    actor: Actor,
    body: UpdatePreferencesBody,
    meta: AuditMeta,
  ): Promise<PreferencesResponse> {
    const unknown = Object.keys(body.email).filter((t) => !isEmailPreferenceType(t));
    if (unknown.length > 0) {
      throw new NotificationError(
        422,
        NOTIFICATION_PROBLEM_CODES.unknownType,
        `These notification types have no email to opt out of: ${unknown.join(', ')}`,
        { types: unknown },
      );
    }
    const at = this.now();
    return withTx(async (tx) => {
      const before = await this.preferenceView(tx, actor);
      const was = new Map(before.email.map((e) => [e.type, e.enabled]));
      const changed = Object.entries(body.email).filter(([type, on]) => was.get(type) !== on);
      for (const [type, on] of changed) {
        await setUserPreference(tx, actor.userId, emailPreferenceKey(type), on, at, actor.userId);
      }
      if (changed.length > 0) {
        await recordAudit(tx, actor, meta, {
          at,
          action: 'update',
          entity: 'user_preference',
          entityId: actor.userId,
          before: Object.fromEntries(changed.map(([t]) => [t, was.get(t)])),
          after: Object.fromEntries(changed),
        });
      }
      return this.preferenceView(tx, actor);
    });
  }
}
