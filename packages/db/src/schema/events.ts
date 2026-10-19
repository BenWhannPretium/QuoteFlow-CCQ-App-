import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { c, documented, inList } from './_doc';
import { AUDIT_ACTIONS, NOTIFICATION_CHANNELS } from './enums';
import { appUser, baseColumns, timestamptz } from './identity';
import { quote } from './workflow';

const SYSTEM = 'CCQ (system)';

export const activityEvent = documented(
  pgTable(
    'activity_event',
    {
      ...baseColumns(),
      quoteId: c(
        uuid('quote_id')
          .notNull()
          .references(() => quote.id, { onDelete: 'restrict' }),
        'Quote.',
      ),
      type: c(
        text('type').notNull(),
        'Event type: gate_decided, stage_changed, hold_started, comment_added, …',
      ),
      actorId: c(
        uuid('actor_id').references(() => appUser.id, { onDelete: 'restrict' }),
        'Who did it; null for system jobs.',
      ),
      at: c(timestamptz('at').notNull(), 'When it happened.'),
      payload: c(jsonb('payload').notNull().default({}), 'Event details for the timeline.'),
    },
    (t) => [index('activity_event_quote_at_idx').on(t.quoteId, t.at)],
  ),
  {
    area: 'events',
    owner: SYSTEM,
    description: 'User-facing quote timeline (F-08). Insert-only for the app role.',
  },
);

export const auditEvent = documented(
  pgTable(
    'audit_event',
    {
      ...baseColumns(),
      at: c(timestamptz('at').notNull().defaultNow(), 'When it happened.'),
      actorId: c(
        uuid('actor_id').references(() => appUser.id, { onDelete: 'restrict' }),
        'Acting user; null before sign-in.',
      ),
      actorRoles: c(text('actor_roles').array().notNull().default([]), 'Roles held at the time.'),
      action: c(
        text('action').notNull(),
        'view | create | update | stage_change | gate_decision | override_* | upload | download | export | config_change | sign_in.',
      ),
      entity: c(text('entity').notNull(), 'Table / entity name acted on.'),
      entityId: c(text('entity_id'), 'Id of the entity acted on.'),
      quoteId: c(
        uuid('quote_id').references(() => quote.id, { onDelete: 'restrict' }),
        'Quote involved, if any.',
      ),
      before: c(jsonb('before'), 'State before the change.'),
      after: c(jsonb('after'), 'State after the change.'),
      ip: c(text('ip'), 'Client IP address.'),
      userAgent: c(text('user_agent'), 'Client user agent.'),
      requestId: c(text('request_id'), 'API request id, for log correlation.'),
    },
    (t) => [
      check('audit_event_action_check', inList(t.action, AUDIT_ACTIONS)),
      index('audit_event_quote_at_idx').on(t.quoteId, t.at),
      index('audit_event_actor_at_idx').on(t.actorId, t.at),
      index('audit_event_at_idx').on(t.at),
    ],
  ),
  {
    area: 'events',
    owner: SYSTEM,
    description:
      'Append-only usage and change audit (F-12). UPDATE/DELETE revoked from ccq_app and blocked by trigger. Retain ≥ 7 years.',
  },
);

export const notification = documented(
  pgTable(
    'notification',
    {
      ...baseColumns(),
      userId: c(
        uuid('user_id')
          .notNull()
          .references(() => appUser.id, { onDelete: 'restrict' }),
        'Recipient.',
      ),
      type: c(text('type').notNull(), 'Notification type (quote.ready_for_eng_review, …).'),
      quoteId: c(
        uuid('quote_id').references(() => quote.id, { onDelete: 'restrict' }),
        'Quote, if any.',
      ),
      title: c(text('title').notNull(), 'Title.'),
      body: c(text('body').notNull(), 'Body text.'),
      readAt: c(timestamptz('read_at'), 'When the recipient read it.'),
      channel: c(text('channel').notNull().default('in_app'), 'in_app | email.'),
      sentAt: c(timestamptz('sent_at'), 'When delivered (email).'),
      error: c(
        text('error'),
        'Last delivery error (a code and a short message; never the content).',
      ),
      dedupeKey: c(
        text('dedupe_key'),
        'Once-per-state key (e.g. quote.validity_expiring:<quote>:<date>, digest:<date>). Unique per user and channel when set.',
      ),
      payload: c(
        jsonb('payload').notNull().default({}),
        'Non-commercial facts the email is built from (actor name, reason label, validity date). Never prices or capital.',
      ),
      attempts: c(
        integer('attempts').notNull().default(0),
        'Email send attempts so far (3 tries, then failed_at).',
      ),
      nextAttemptAt: c(
        timestamptz('next_attempt_at'),
        'Email: when the dispatcher may try next. Null for in-app rows.',
      ),
      failedAt: c(
        timestamptz('failed_at'),
        'Email: set when the last retry failed; the owners were alerted.',
      ),
    },
    (t) => [
      check('notification_channel_check', inList(t.channel, NOTIFICATION_CHANNELS)),
      check(
        'notification_delivery_state_check',
        sql`not (${t.sentAt} is not null and ${t.failedAt} is not null)`,
      ),
      index('notification_user_unread_idx').on(t.userId, t.readAt),
      index('notification_user_created_idx').on(t.userId, t.channel, t.createdAt),
      uniqueIndex('notification_dedupe_idx')
        .on(t.userId, t.channel, t.dedupeKey)
        .where(sql`${t.dedupeKey} is not null`),
      index('notification_email_due_idx')
        .on(t.nextAttemptAt)
        .where(sql`${t.channel} = 'email' and ${t.sentAt} is null and ${t.failedAt} is null`),
    ],
  ),
  {
    area: 'events',
    owner: SYSTEM,
    description:
      'In-app notifications (channel in_app) and the email outbox (channel email, sent by the dispatcher with retries).',
  },
);
