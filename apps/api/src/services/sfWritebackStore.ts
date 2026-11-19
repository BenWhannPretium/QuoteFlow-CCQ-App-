import { schema, type DbOrTx } from '@ccq/db';
import { getSetting, insertAuditEvent } from '@ccq/db/repos';
import {
  SF_STAGE_FIELD,
  parseSfOutcomeStageNames,
  parseSfWritebackSettings,
  type SfWriteAllowList,
  type SfWritebackSettings,
  type SfWritebackStatus,
} from '@ccq/domain';
import { and, desc, eq, gte, inArray, isNull, isNotNull, lte, ne, sql } from 'drizzle-orm';

/**
 * FB-29: the outbox's reads and writes (`sf_writeback_outbox`) and the write-back settings. Row-level
 * security applies: a request reads the rows of the quotes it can see; the worker runs in the system
 * context and sees every row.
 */

const { sfWritebackOutbox: outbox, quote, quoteDraft, gateDecision } = schema;

export type OutboxRow = typeof outbox.$inferSelect;
export type NewOutboxRow = typeof outbox.$inferInsert;

export const SF_WRITEBACK_SETTING_KEYS = {
  enabled: 'sf_writeback_enabled',
  mode: 'sf_writeback_mode',
  map: 'sf_writeback_map',
  regression: 'sf_writeback_stage_regression',
  maxAttempts: 'sf_writeback_max_attempts',
  retryMinutes: 'sf_writeback_retry_minutes',
} as const;

export interface LoadedWritebackSettings {
  /** The switch alone, readable even when the rest is invalid. */
  enabled: boolean;
  settings: SfWritebackSettings | null;
  /** Why the settings could not be used; null when they are valid. */
  error: string | null;
  /** `sf_outcome_stage_names` (FB-04); empty when invalid (the error says so). */
  outcomeNames: Record<string, string>;
}

/** The six write-back settings and the outcome stage names, validated against the writer's allow-list. */
export async function loadWritebackSettings(
  db: DbOrTx,
  allowList: SfWriteAllowList,
): Promise<LoadedWritebackSettings> {
  const k = SF_WRITEBACK_SETTING_KEYS;
  const [enabled, mode, map, regression, maxAttempts, retryMinutes, names] = await Promise.all([
    getSetting(db, k.enabled),
    getSetting(db, k.mode),
    getSetting(db, k.map),
    getSetting(db, k.regression),
    getSetting(db, k.maxAttempts),
    getSetting(db, k.retryMinutes),
    getSetting(db, 'sf_outcome_stage_names'),
  ]);
  const parsed = parseSfWritebackSettings(
    { enabled, mode, map, regression, maxAttempts, retryMinutes },
    allowList,
  );
  let outcomeNames: Record<string, string> = {};
  let namesError: string | null = null;
  try {
    outcomeNames = parseSfOutcomeStageNames(names ?? {});
  } catch (err) {
    namesError = err instanceof Error ? err.message : 'sf_outcome_stage_names is invalid';
  }
  return {
    enabled: enabled === true,
    settings: parsed.ok ? parsed.settings : null,
    error: parsed.ok ? namesError : parsed.error,
    outcomeNames,
  };
}

/** Insert one row; a repeat of the same dedupe key is ignored. Returns the new row's id, or null. */
export async function insertOutboxRow(db: DbOrTx, row: NewOutboxRow): Promise<string | null> {
  const [inserted] = await db
    .insert(outbox)
    .values(row)
    .onConflictDoNothing({ target: outbox.dedupeKey })
    .returning({ id: outbox.id });
  return inserted?.id ?? null;
}

/** The decision just recorded on the quote (UUID v7 ids are time-ordered). */
export async function latestDecisionId(db: DbOrTx, quoteId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: gateDecision.id })
    .from(gateDecision)
    .where(eq(gateDecision.quoteId, quoteId))
    .orderBy(desc(gateDecision.createdAt), desc(gateDecision.id))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Another QuoteFlow quote that is not closed, or an open (not submitted) linked re-quote draft, on the same
 * opportunity: a closing write would take the opportunity away from it. Under row-level security the
 * caller sees what it may; the service adds a system-context read and the worker re-checks in the system
 * context before sending.
 */
export async function otherActiveOnOpportunity(
  db: DbOrTx,
  sfOpportunityId: string,
  exceptQuoteId: string,
): Promise<boolean> {
  const [open] = await db
    .select({ id: quote.id })
    .from(quote)
    .where(
      and(
        eq(quote.sfOpportunityId, sfOpportunityId),
        ne(quote.id, exceptQuoteId),
        ne(quote.status, 'closed'),
      ),
    )
    .limit(1);
  if (open) return true;
  const [draft] = await db
    .select({ id: quoteDraft.id })
    .from(quoteDraft)
    .where(
      and(
        eq(quoteDraft.sfOpportunityId, sfOpportunityId),
        isNotNull(quoteDraft.requoteOfQuoteId),
        isNull(quoteDraft.submittedQuoteId),
      ),
    )
    .limit(1);
  return !!draft;
}

/** Pending closing rows for an opportunity (a re-quote supersedes them). Locked for the update. */
export function pendingClosingRows(db: DbOrTx, sfOpportunityId: string) {
  return db
    .select()
    .from(outbox)
    .where(
      and(
        eq(outbox.sfOpportunityId, sfOpportunityId),
        eq(outbox.status, 'pending'),
        eq(outbox.closing, true),
      ),
    )
    .for('update');
}

/**
 * The closing value of the last stage QuoteFlow wrote to this opportunity, or null when the last one it
 * wrote is not closing (or it wrote none). "Wrote" is `sent` (a `confirmed_existing` row is `sent` too);
 * a dry run also counts `dry_run` rows, so its reopen shows what live would do.
 */
export async function lastClosingWritten(
  db: DbOrTx,
  sfOpportunityId: string,
  statuses: readonly SfWritebackStatus[],
  exceptId?: string,
): Promise<string | null> {
  const [row] = await db
    .select({ value: outbox.value, closing: outbox.closing })
    .from(outbox)
    .where(
      and(
        eq(outbox.sfOpportunityId, sfOpportunityId),
        eq(outbox.sfField, SF_STAGE_FIELD),
        inArray(outbox.status, [...statuses]),
        ...(exceptId ? [ne(outbox.id, exceptId)] : []),
      ),
    )
    .orderBy(desc(sql`coalesce(${outbox.sentAt}, ${outbox.createdAt})`), desc(outbox.id))
    .limit(1);
  return row?.closing ? row.value : null;
}

/** The opportunity of the oldest due pending row not locked by another worker, or null. */
export async function nextDueOpportunity(db: DbOrTx, now: Date): Promise<string | null> {
  const [row] = await db
    .select({ sfOpportunityId: outbox.sfOpportunityId })
    .from(outbox)
    .where(and(eq(outbox.status, 'pending'), lte(outbox.nextAttemptAt, now)))
    .orderBy(outbox.createdAt, outbox.id)
    .limit(1)
    .for('update', { skipLocked: true });
  return row?.sfOpportunityId ?? null;
}

/** Every pending row of one opportunity, locked (`SKIP LOCKED`: another worker keeps its rows). */
export function lockPendingForOpportunity(db: DbOrTx, sfOpportunityId: string) {
  return db
    .select()
    .from(outbox)
    .where(and(eq(outbox.sfOpportunityId, sfOpportunityId), eq(outbox.status, 'pending')))
    .orderBy(outbox.createdAt, outbox.id)
    .for('update', { skipLocked: true });
}

export async function updateOutboxRow(
  db: DbOrTx,
  id: string,
  fields: Partial<
    Pick<
      NewOutboxRow,
      | 'status'
      | 'attempts'
      | 'nextAttemptAt'
      | 'sentAt'
      | 'failedAt'
      | 'lastError'
      | 'skippedReason'
      | 'response'
    >
  >,
  at: Date,
): Promise<OutboxRow | undefined> {
  const [row] = await db
    .update(outbox)
    .set({ ...fields, updatedAt: at })
    .where(eq(outbox.id, id))
    .returning();
  return row;
}

export async function getOutboxRow(db: DbOrTx, id: string): Promise<OutboxRow | undefined> {
  const [row] = await db.select().from(outbox).where(eq(outbox.id, id)).limit(1);
  return row;
}

/** The latest rows, newest first, with each quote's number. */
export function listOutbox(db: DbOrTx, limit: number) {
  return db
    .select({ row: outbox, quoteNumber: quote.quoteNumber })
    .from(outbox)
    .innerJoin(quote, eq(quote.id, outbox.quoteId))
    .orderBy(desc(outbox.createdAt), desc(outbox.id))
    .limit(limit);
}

/** Pending and failed counts, and rows sent since `since`. */
export async function outboxCounts(db: DbOrTx, since: Date) {
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${outbox.status} = 'pending')::int`,
      failed: sql<number>`count(*) filter (where ${outbox.status} = 'failed')::int`,
      sent24h: sql<number>`count(*) filter (where ${outbox.status} = 'sent' and ${outbox.sentAt} >= ${since.toISOString()}::timestamptz)::int`,
    })
    .from(outbox);
  return { pending: row?.pending ?? 0, failed: row?.failed ?? 0, sent24h: row?.sent24h ?? 0 };
}

/** The latest stage row for one quote (for the KAM's reminder). */
export async function latestStageRowForQuote(db: DbOrTx, quoteId: string) {
  const [row] = await db
    .select()
    .from(outbox)
    .where(
      and(
        eq(outbox.quoteId, quoteId),
        eq(outbox.sfField, SF_STAGE_FIELD),
        inArray(outbox.event, ['outcome_recorded', 'stage_changed']),
      ),
    )
    .orderBy(desc(outbox.createdAt), desc(outbox.id))
    .limit(1);
  return row;
}

/** Rows created for a quote since `since` (tests and the preview's notes). */
export const listOutboxForQuote = (db: DbOrTx, quoteId: string, since?: Date) =>
  db
    .select()
    .from(outbox)
    .where(and(eq(outbox.quoteId, quoteId), ...(since ? [gte(outbox.createdAt, since)] : [])))
    .orderBy(outbox.createdAt, outbox.id);

/**
 * An audit row written by the system (the worker has no signed-in user): actor null, as the directory's
 * provisioning rows. Field names and values only; nothing secret.
 */
export function insertSystemAudit(
  db: DbOrTx,
  entry: {
    action: 'create' | 'update';
    entityId: string | null;
    quoteId: string | null;
    before?: Record<string, unknown> | null;
    after: Record<string, unknown>;
    at: Date;
  },
) {
  return insertAuditEvent(db, {
    at: entry.at,
    actorId: null,
    actorRoles: [],
    action: entry.action,
    entity: 'sf_writeback',
    entityId: entry.entityId,
    quoteId: entry.quoteId,
    before: entry.before ?? null,
    after: entry.after,
    createdBy: null,
  });
}
