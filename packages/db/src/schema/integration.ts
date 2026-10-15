import { check, index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

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
    ],
  ),
  {
    area: 'integration',
    owner: 'CCQ (system)',
    description: 'One row per integration call or sync job; failures alert owners.',
  },
);
