import { FEEDBACK_STATUSES, FEEDBACK_TYPES } from '@ccq/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  customType,
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
      changeReason: c(
        text('change_reason'),
        'B-19: why a config change was made (required on every config_change row; the F-21 decision log).',
      ),
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

/**
 * B-27 (L-8): Fabric mirroring drops array and jsonb columns, and audit rows are never updated, so
 * audit_event's JSON copies live here: one row per audit row, written by an AFTER INSERT trigger on
 * audit_event (migration 0022). Insert-only; the app never reads it. See src/fabric.ts.
 */
export const auditEventFabric = documented(
  pgTable('audit_event_fabric', {
    auditEventId: c(
      uuid('audit_event_id')
        .primaryKey()
        .references(() => auditEvent.id, { onDelete: 'restrict' }),
      'The audit_event row these copies belong to.',
    ),
    actorRolesJson: c(text('actor_roles_json'), 'audit_event.actor_roles as a JSON array.'),
    beforeJson: c(text('before_json'), 'audit_event.before as JSON text.'),
    afterJson: c(text('after_json'), 'audit_event.after as JSON text.'),
  }),
  {
    area: 'events',
    owner: SYSTEM,
    description:
      'B-27: Fabric-mirrorable JSON text copies of audit_event’s array and jsonb columns, written by trigger. Append-only like audit_event; not read by the app.',
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

/** Raw bytes (`bytea`); Fabric mirrors it. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

const FEEDBACK = 'Reporter (UAT cohort); triage by Admin';

/**
 * B-23: the in-app "Report an issue" button. One row per report, with the page and quote it came
 * from. Triage (status, owner, GitHub issue) on Admin → Feedback; `pnpm uat:defects` renders the UAT
 * defect log from it. RLS: a user inserts their own; only Admin (feedback.triage) reads or updates.
 */
export const feedback = documented(
  pgTable(
    'feedback',
    {
      ...baseColumns(),
      reporterId: c(
        uuid('reporter_id')
          .notNull()
          .references(() => appUser.id, { onDelete: 'restrict' }),
        'Who reported it.',
      ),
      reporterRoles: c(
        text('reporter_roles').notNull(),
        'Their CCQ roles at the time, comma-separated (text, not an array: Fabric mirrors text).',
      ),
      type: c(text('type').notNull(), 'bug | confusing | missing | idea.'),
      severity: c(
        integer('severity').notNull(),
        '1 blocks a core flow · 2 wrong data or permission · 3 usability · 4 cosmetic (as reported; Admin may change it).',
      ),
      description: c(text('description').notNull(), 'What happened, in the reporter’s words.'),
      route: c(text('route').notNull(), 'App path the report was raised from (no query string).'),
      quoteNumber: c(text('quote_number'), 'CCQ quote number in context, if any.'),
      appVersion: c(text('app_version'), 'Build (git SHA) the reporter was running.'),
      userAgent: c(text('user_agent'), 'Browser user agent.'),
      viewport: c(text('viewport'), 'Window size, e.g. 390x844.'),
      screenshot: c(
        bytea('screenshot'),
        'Optional screenshot (≤ 2 MB). May show commercial figures: Admin-only, like the row.',
      ),
      screenshotType: c(text('screenshot_type'), 'image/png | image/jpeg | image/webp.'),
      status: c(
        text('status').notNull().default('new'),
        'new | triaged | fixing | fixed | wont_fix.',
        'Admin',
      ),
      ownerId: c(
        uuid('owner_id').references(() => appUser.id, { onDelete: 'set null' }),
        'Who is fixing it.',
        'Admin',
      ),
      githubIssueUrl: c(
        text('github_issue_url'),
        'Linked GitHub issue, if one was raised.',
        'Admin',
      ),
      triageNote: c(text('triage_note'), 'Triage notes.', 'Admin'),
    },
    (t) => [
      check('feedback_type_check', inList(t.type, FEEDBACK_TYPES)),
      check('feedback_status_check', inList(t.status, FEEDBACK_STATUSES)),
      check('feedback_severity_check', sql`${t.severity} between 1 and 4`),
      check(
        'feedback_screenshot_type_check',
        sql`(${t.screenshot} is null) = (${t.screenshotType} is null) and (${t.screenshotType} is null or ${t.screenshotType} in ('image/png', 'image/jpeg', 'image/webp'))`,
      ),
      index('feedback_status_severity_idx').on(t.status, t.severity, t.createdAt),
    ],
  ),
  {
    area: 'events',
    owner: FEEDBACK,
    description: 'B-23 in-app feedback and UAT defects ("Report an issue").',
  },
);
