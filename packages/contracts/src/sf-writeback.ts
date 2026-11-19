import { z } from 'zod';

/**
 * FB-29 (N19-01, N19-02; D-16w): the Salesforce write-back, Admin → Integrations. The lists mirror the
 * domain's (`packages/domain/src/salesforce-writeback/config.ts`); a unit test keeps them equal.
 */
export const SF_WRITEBACK_EVENT_VALUES = [
  'outcome_recorded',
  'requote_started',
  'stage_changed',
  'quote_link',
] as const;
export const SF_WRITEBACK_STATUS_VALUES = [
  'pending',
  'sent',
  'failed',
  'skipped',
  'dry_run',
] as const;
export const SF_WRITEBACK_SKIP_REASON_VALUES = [
  'superseded',
  'regression',
  'other_active_quote',
  'nothing_to_reopen',
  'moved_in_salesforce',
  'admin_skip',
] as const;

export const SfWritebackMode = z.enum(['dry_run', 'live']);
export type SfWritebackMode = z.infer<typeof SfWritebackMode>;
export const SfWritebackStatus = z.enum(SF_WRITEBACK_STATUS_VALUES);
export type SfWritebackStatus = z.infer<typeof SfWritebackStatus>;

/** One outbox row as an Admin sees it. */
export const SfWritebackRow = z.object({
  id: z.string(),
  quoteNumber: z.string(),
  sfOpportunityId: z.string(),
  event: z.enum(SF_WRITEBACK_EVENT_VALUES),
  sfObject: z.string(),
  sfField: z.string(),
  value: z.string(),
  /** The JSON that is (or would be) sent. */
  payload: z.string(),
  status: SfWritebackStatus,
  skippedReason: z.enum(SF_WRITEBACK_SKIP_REASON_VALUES).nullable(),
  closing: z.boolean(),
  reopens: z.boolean(),
  attempts: z.number().int(),
  createdAt: z.string(),
  nextAttemptAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  /** What the worker learned (the stage Salesforce held, confirmed_existing), as JSON text. */
  response: z.string().nullable(),
});
export type SfWritebackRow = z.infer<typeof SfWritebackRow>;

export const SfWritebackSummary = z.object({
  /** `sf_writeback_enabled`. */
  enabled: z.boolean(),
  /** `sf_writeback_mode`. */
  mode: SfWritebackMode,
  /** This environment's write connection (`SF_WRITE_MODE`). */
  writerMode: z.enum(['off', 'fake', 'live']),
  liveAllowed: z.boolean(),
  /** Why live is refused here, in plain words; null when allowed. */
  liveBlockedReason: z.string().nullable(),
  /** Writes are actually being sent now (on, live, valid settings, a write connection). */
  sending: z.boolean(),
  /** One plain sentence: what is happening, and why nothing is written when nothing is. */
  statusText: z.string(),
  settingsError: z.string().nullable(),
  /** The mapping waits on the Salesforce owner's approval. */
  provisional: z.boolean(),
  counts: z.object({
    pending: z.number().int(),
    failed: z.number().int(),
    sent24h: z.number().int(),
  }),
  /** The latest 50 rows, newest first. */
  rows: z.array(SfWritebackRow),
  /** The caller may switch, retry and skip (config.manage). */
  canManage: z.boolean(),
});
export type SfWritebackSummary = z.infer<typeof SfWritebackSummary>;

export const SfWritebackSwitchBody = z
  .object({
    enabled: z.boolean().optional(),
    mode: SfWritebackMode.optional(),
    changeReason: z.string().trim().max(500).optional(),
  })
  .refine((b) => b.enabled !== undefined || b.mode !== undefined, {
    message: 'Change the switch, the mode or both',
  });
export type SfWritebackSwitchBody = z.infer<typeof SfWritebackSwitchBody>;

export const SfWritebackRowParams = z.object({ id: z.uuid() });

export const SfWritebackPreviewQuery = z.object({
  quoteNumber: z.string().regex(/^CCQ-\d{4}-\d{5}$/, 'A quote number looks like CCQ-2026-00001'),
});

export const SfWritebackPreview = z.object({
  quoteNumber: z.string(),
  sfOpportunityId: z.string(),
  enabled: z.boolean(),
  mode: SfWritebackMode,
  writes: z.array(
    z.object({
      event: z.enum(SF_WRITEBACK_EVENT_VALUES),
      sfObject: z.string(),
      sfField: z.string(),
      value: z.string(),
      closing: z.boolean(),
      reopens: z.boolean(),
      payload: z.string(),
      /** Why this write would not go out as it stands (e.g. another quote needs the opportunity). */
      note: z.string().nullable(),
    }),
  ),
  notes: z.array(z.string()),
});
export type SfWritebackPreview = z.infer<typeof SfWritebackPreview>;

/**
 * `CustomerDecisionDetail.sfWriteback`: whether QuoteFlow updates Salesforce for this quote, and the state
 * of its latest stage write. `on` = switched on, live, with a write connection: the KAM's reminder then
 * says QuoteFlow updates Salesforce instead of asking for it by hand.
 */
export const QuoteSfWriteback = z.object({
  on: z.boolean(),
  latest: z
    .object({
      status: SfWritebackStatus,
      value: z.string(),
      at: z.string(),
      skippedReason: z.enum(SF_WRITEBACK_SKIP_REASON_VALUES).nullable(),
    })
    .nullable(),
});
export type QuoteSfWriteback = z.infer<typeof QuoteSfWriteback>;
