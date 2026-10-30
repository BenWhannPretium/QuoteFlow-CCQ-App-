import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { c, documented, inList } from './_doc';
import {
  INTEGRATION_SOURCES,
  INTEGRATION_STATUSES,
  PRICING_HISTORY_KINDS,
  PRICING_HISTORY_STATUSES,
} from './enums';
import { baseColumns, timestamptz } from './identity';

export const integrationRun = documented(
  pgTable(
    'integration_run',
    {
      ...baseColumns(),
      source: c(
        text('source').notNull(),
        'salesforce | pricing | sharepoint | fabric (B-27 mirroring status).',
      ),
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
    description:
      'One row per sync job (Salesforce) or pricing-history import (B-15); failures alert owners.',
  },
);

const PRICING = 'Pricing (legacy pricing-app export)';
const COMMERCIAL =
  ' Commercial tag: stripped for roles without quote.read.commercialFields (every role holds it since 2026-10-30).';
// The export holds junk figures of $1T and more, kept as history (the raw value is in `fields`). B-27:
// bounded at precision 38 so Fabric mirroring keeps the decimals (an unbounded numeric lands as
// Decimal(38, 0)); the mapper drops anything over 1e30 (`MAX_FIGURE`).
const figure = (name: string) => numeric(name, { precision: 38, scale: 4, mode: 'number' });

/**
 * B-15 (revised 2026-10-22): the legacy pricing application's records, imported from Cory McGahan's
 * back-end export (ERF, BPR, SPR sheets). Read-only history: CCQ never edits a row, an Admin re-imports
 * a corrected export instead (upsert by kind + request id). RLS: only commercial roles read it.
 */
export const pricingHistoryRecord = documented(
  pgTable(
    'pricing_history_record',
    {
      ...baseColumns(),
      kind: c(text('kind').notNull(), 'erf | bpr | spr (the export sheet).', PRICING),
      requestId: c(
        integer('request_id').notNull(),
        'Request_ID in the legacy app: unique per kind (request numbers are not).',
        PRICING,
      ),
      requestNumber: c(
        text('request_number').notNull(),
        'Request_Number, e.g. ERF25-123 (EP… for older ERFs).',
        PRICING,
      ),
      requestNumberKey: c(
        text('request_number_key').notNull(),
        'Request number upper-cased without spaces, for lookups.',
        PRICING,
      ),
      fiscalYear: c(integer('fiscal_year').notNull(), 'Fiscal_Year.', PRICING),
      status: c(
        text('status').notNull(),
        'Derived from the flags: open | on_hold | accepted | rejected | abandoned | completed.',
        PRICING,
      ),
      displayStatus: c(text('display_status'), "The legacy app's own status label.", PRICING),
      isOpen: c(boolean('is_open').notNull().default(false), 'Is_Open.', PRICING),
      customer: c(text('customer'), 'Customer as typed in the legacy app.', PRICING),
      customerKey: c(
        text('customer_key'),
        'Customer normalised for matching (case, punctuation, legal suffix): the export has no SF id.',
        PRICING,
      ),
      productDescription: c(text('product_description'), 'Product_Description.', PRICING),
      itemNumber: c(text('item_number'), 'Item_Number (BPR, SPR).', PRICING),
      salesPerson: c(text('sales_person'), 'Sales_Person.', PRICING),
      market: c(text('market'), 'Market.', PRICING),
      process: c(text('process'), 'Process.', PRICING),
      resin: c(text('resin'), 'Resin.', PRICING),
      plantCode: c(text('plant_code'), 'Plant_Code.', PRICING),
      plantName: c(text('plant_name'), 'Plant_Name.', PRICING),
      submittedOn: c(
        date('submitted_on', { mode: 'string' }),
        'Sales_Submitted_Date, else Created_Date.',
        PRICING,
      ),
      estRevenueUsd: c(
        figure('est_revenue_usd'),
        `Est_Revenue / Est_Annual_Revenue; null when blank or 0 (the legacy app wrote 0 for blank).${COMMERCIAL}`,
        PRICING,
      ),
      estVolume: c(
        figure('est_volume'),
        `Est_Volume / Est_Annual_Unit_Volume; null when blank or 0.${COMMERCIAL}`,
        PRICING,
      ),
      comments: c(text('comments'), 'Comments (free text, kept for context).', PRICING),
      fields: c(
        jsonb('fields').notNull().default({}),
        `Every non-empty column of the export row, free text included (decision 2026-10-22).${COMMERCIAL}`,
        PRICING,
      ),
      importRunId: c(
        uuid('import_run_id').references(() => integrationRun.id, { onDelete: 'set null' }),
        'The integration_run of the import that last wrote the row.',
        'CCQ (system)',
      ),
    },
    (t) => [
      check('pricing_history_record_kind_check', inList(t.kind, PRICING_HISTORY_KINDS)),
      check('pricing_history_record_status_check', inList(t.status, PRICING_HISTORY_STATUSES)),
      uniqueIndex('pricing_history_record_kind_request_uq').on(t.kind, t.requestId),
      index('pricing_history_record_number_idx').on(t.kind, t.requestNumberKey),
      index('pricing_history_record_customer_idx').on(t.kind, t.customerKey, t.submittedOn),
      index('pricing_history_record_customer_trgm_idx').using('gin', t.customer.op('gin_trgm_ops')),
      index('pricing_history_record_description_trgm_idx').using(
        'gin',
        t.productDescription.op('gin_trgm_ops'),
      ),
    ],
  ),
  {
    area: 'integration',
    owner: 'Pricing (Gemma Cebolla); export from IT (Cory McGahan)',
    description:
      'B-15: read-only history from the retired pricing app (ERF, BPR, SPR), imported by an Admin from the export. Commercial.',
  },
);
