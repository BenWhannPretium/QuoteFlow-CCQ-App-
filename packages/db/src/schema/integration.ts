import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { c, documented, inList } from './_doc';
import { INTEGRATION_SOURCES, INTEGRATION_STATUSES } from './enums';
import { baseColumns, timestamptz } from './identity';

export const integrationRun = documented(
  pgTable(
    'integration_run',
    {
      ...baseColumns(),
      source: c(text('source').notNull(), 'salesforce | pricing | sharepoint.'),
      startedAt: c(timestamptz('started_at').notNull(), 'Run start.'),
      finishedAt: c(timestamptz('finished_at'), 'Run end; null while running.'),
      status: c(
        text('status').notNull().default('running'),
        'running | succeeded | failed | partial.',
      ),
      counts: c(jsonb('counts').notNull().default({}), 'Counters, e.g. {read, upserted, skipped}.'),
      error: c(text('error'), 'Error summary (no secrets, no customer data).'),
    },
    (t) => [
      check('integration_run_source_check', inList(t.source, INTEGRATION_SOURCES)),
      check('integration_run_status_check', inList(t.status, INTEGRATION_STATUSES)),
      index('integration_run_source_started_idx').on(t.source, t.startedAt),
      // B-15: pricing-app reads are counted per hour, one row per hour (started_at = the hour).
      uniqueIndex('integration_run_pricing_hour_uq')
        .on(t.source, t.startedAt)
        .where(sql`${t.source} = 'pricing'`),
    ],
  ),
  {
    area: 'integration',
    owner: 'CCQ (system)',
    description:
      'One row per sync job (Salesforce), or per hour of on-demand reads (pricing app, B-15); failures alert owners.',
  },
);
