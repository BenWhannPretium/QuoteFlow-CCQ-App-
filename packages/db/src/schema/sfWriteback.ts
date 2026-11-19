import {
  SF_WRITEBACK_EVENTS,
  SF_WRITEBACK_OBJECTS,
  SF_WRITEBACK_SKIP_REASONS,
  SF_WRITEBACK_STATUSES,
} from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { c, documented, inList } from './_doc';
import { baseColumns, timestamptz } from './identity';
import { quote } from './workflow';

const SF = 'Salesforce write-back (FB-29)';

/**
 * FB-29 (N19-01, N19-02; D-16w, F-035): the durable outbox of writes to Salesforce. A row is written in
 * the same transaction as the QuoteFlow change that causes it (a rolled-back decision leaves none) and
 * sent later by the write-back worker, so nothing in a quote's workflow waits for Salesforce.
 *
 * Fabric (rule 10): the payload and the response are `text` (JSON as text), no jsonb, no arrays, no
 * numeric. The app never truncates it.
 */
export const sfWritebackOutbox = documented(
  pgTable(
    'sf_writeback_outbox',
    {
      ...baseColumns(),
      quoteId: c(
        uuid('quote_id')
          .notNull()
          .references(() => quote.id, { onDelete: 'restrict' }),
        'The quote whose change caused the write.',
        SF,
      ),
      sfOpportunityId: c(
        text('sf_opportunity_id').notNull(),
        'The Salesforce Opportunity written to (the quote’s).',
        SF,
      ),
      event: c(
        text('event').notNull(),
        'outcome_recorded | requote_started | stage_changed | quote_link.',
        SF,
      ),
      sfObject: c(text('sf_object').notNull(), 'Always Opportunity.', SF),
      sfField: c(
        text('sf_field').notNull(),
        'The field API name, from sf_writeback_map (on the writer’s allow-list).',
        SF,
      ),
      value: c(text('value').notNull(), 'The value to write (a stage name, never a figure).', SF),
      payload: c(text('payload').notNull(), 'The JSON that is (or would be) sent, as text.', SF),
      dedupeKey: c(
        text('dedupe_key').notNull(),
        'Quote, event, value and the decision or draft id. Local only: Salesforce’s update has no idempotency key.',
        SF,
      ),
      status: c(
        text('status').notNull().default('pending'),
        'pending | sent | failed | skipped | dry_run (recorded, never sent).',
        SF,
      ),
      closing: c(
        boolean('closing').notNull().default(false),
        'The value closes the opportunity (skipped while another quote still needs it).',
        SF,
      ),
      reopens: c(
        boolean('reopens').notNull().default(false),
        'A reopen after a linked re-quote: sent only over a close QuoteFlow wrote.',
        SF,
      ),
      attempts: c(integer('attempts').notNull().default(0), 'Send attempts so far.', SF),
      nextAttemptAt: c(timestamptz('next_attempt_at'), 'When a pending row may be tried next.', SF),
      sentAt: c(
        timestamptz('sent_at'),
        'When Salesforce accepted it (or was found already to hold it).',
        SF,
      ),
      failedAt: c(timestamptz('failed_at'), 'When it failed for good (Admins were told).', SF),
      lastError: c(
        text('last_error'),
        'The last error: a code and a short message, at most 500 characters, never a token.',
        SF,
      ),
      skippedReason: c(
        text('skipped_reason'),
        'Why it was not written (superseded, regression, other_active_quote, …); null otherwise.',
        SF,
      ),
      response: c(
        text('response'),
        'What the worker learned, as JSON text: the stage Salesforce held, confirmed_existing.',
        SF,
      ),
    },
    (t) => [
      check('sf_writeback_outbox_event_check', inList(t.event, SF_WRITEBACK_EVENTS)),
      check('sf_writeback_outbox_object_check', inList(t.sfObject, SF_WRITEBACK_OBJECTS)),
      check('sf_writeback_outbox_status_check', inList(t.status, SF_WRITEBACK_STATUSES)),
      check(
        'sf_writeback_outbox_skipped_reason_check',
        sql`${t.skippedReason} is null or ${inList(t.skippedReason, SF_WRITEBACK_SKIP_REASONS)}`,
      ),
      check(
        'sf_writeback_outbox_last_error_check',
        sql`${t.lastError} is null or char_length(${t.lastError}) <= 500`,
      ),
      uniqueIndex('sf_writeback_outbox_dedupe_key_uq').on(t.dedupeKey),
      index('sf_writeback_outbox_due_idx')
        .on(t.nextAttemptAt)
        .where(sql`${t.status} = 'pending'`),
      index('sf_writeback_outbox_opportunity_idx').on(t.sfOpportunityId, t.createdAt),
      index('sf_writeback_outbox_quote_idx').on(t.quoteId, t.createdAt),
      index('sf_writeback_outbox_created_idx').on(t.createdAt),
    ],
  ),
  {
    area: 'integration',
    owner: 'CCQ (system)',
    description:
      'FB-29: writes to Salesforce, queued with the change that causes them and sent by a worker (switched off by default).',
  },
);
