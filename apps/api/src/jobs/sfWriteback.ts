import {
  ADVISORY_LOCKS,
  withAdvisoryLock,
  withSystemContext,
  type Database,
  type Tx,
} from '@ccq/db';
import { listActiveUserIdsWithRole } from '@ccq/db/repos';
import {
  SF_STAGE_FIELD,
  decideSend,
  latestPerField,
  sfWritebackRetryDelayMs,
  truncateSfError,
  type SfWriteAllowList,
  type SfWritebackSettings,
  type SfWritebackSkipReason,
} from '@ccq/domain';
import type { SalesforceWriter } from '@ccq/integrations';
import type { Sql } from 'postgres';

import { createNotifications } from '../services/notificationService';
import {
  closingPossiblyWritten,
  insertSystemAudit,
  lastClosingWritten,
  loadWritebackSettings,
  lockPendingForOpportunity,
  nextDueOpportunity,
  otherActiveOnOpportunity,
  updateOutboxRow,
  type OutboxRow,
} from '../services/sfWritebackStore';

/**
 * FB-29 (N19-01): the Salesforce write-back worker. Every minute, in-process, on one instance only
 * (`pg_try_advisory_lock`), in the system context:
 *
 *   1. only while the write-back is switched on, live, with valid settings and a write connection;
 *   2. per opportunity (oldest due first), lock its pending rows (`FOR UPDATE SKIP LOCKED`, held while the
 *      row is sent, so a re-quote that supersedes a closing write waits for it), keep only the latest value
 *      per field (the older are `skipped`, superseded);
 *   3. a closing write is skipped while another quote or an open re-quote needs the opportunity;
 *   4. a stage write reads the stage Salesforce holds first, through the WRITER's session: already there →
 *      `sent` (confirmed_existing; a retry after a timeout that reached Salesforce); a reopen only over the
 *      close QuoteFlow last wrote (else skipped: nothing_to_reopen or moved_in_salesforce); a move to an
 *      earlier stage is skipped while `sf_writeback_stage_regression` is skip;
 *   5. send; a retryable failure backs off (`sf_writeback_retry_minutes`) up to `sf_writeback_max_attempts`,
 *      then `failed` and every Admin is told once (dedupe key = the row id); a non-retryable one fails at once.
 *
 * Every outcome writes an audit row (actor null). The worker never touches a quote. It never throws into the
 * scheduler. Logs carry ids, field names and codes, never values or tokens.
 */

export interface SfWritebackLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface SfWritebackDeps {
  database: Database;
  sql: Sql;
  /** Null when SF_WRITE_MODE=off: the worker then sends nothing. */
  writer: SalesforceWriter | null;
  allowList: SfWriteAllowList;
  logger: SfWritebackLogger;
  now?: () => Date;
  /** Opportunities per run. */
  batchSize?: number;
  /** Shutting down: finish the opportunity in hand, start no other. */
  shouldStop?: () => boolean;
}

export interface SfWritebackRunResult {
  outcome: 'succeeded' | 'failed' | 'skipped' | 'idle';
  sent: number;
  confirmed: number;
  skipped: number;
  retrying: number;
  failed: number;
}

const EMPTY: SfWritebackRunResult = {
  outcome: 'succeeded',
  sent: 0,
  confirmed: 0,
  skipped: 0,
  retrying: 0,
  failed: 0,
};
const DEFAULT_BATCH = 25;

interface FinalFailure {
  id: string;
  quoteId: string;
  sfOpportunityId: string;
  code: string;
}

/** Send (or settle) one row. Runs inside the opportunity's transaction, holding the row's lock. */
async function processRow(
  deps: SfWritebackDeps & { writer: SalesforceWriter },
  tx: Tx,
  row: OutboxRow,
  settings: SfWritebackSettings,
  result: SfWritebackRunResult,
  failures: FinalFailure[],
  at: Date,
): Promise<void> {
  const audit = (after: Record<string, unknown>) =>
    insertSystemAudit(tx, {
      action: 'update',
      entityId: row.id,
      quoteId: row.quoteId,
      before: { status: row.status, attempts: row.attempts },
      after: {
        sfField: row.sfField,
        value: row.value,
        sfOpportunityId: row.sfOpportunityId,
        ...after,
      },
      at,
    });
  const skip = async (reason: SfWritebackSkipReason, response?: Record<string, unknown>) => {
    await updateOutboxRow(
      tx,
      row.id,
      {
        status: 'skipped',
        skippedReason: reason,
        nextAttemptAt: null,
        ...(response ? { response: JSON.stringify(response) } : {}),
      },
      at,
    );
    await audit({ status: 'skipped', skippedReason: reason, ...(response ?? {}) });
    result.skipped++;
  };
  const fail = async (err: { retryable: boolean; code: string; message: string }) => {
    const attempts = row.attempts + 1;
    const delay = err.retryable
      ? sfWritebackRetryDelayMs(attempts, settings.maxAttempts, settings.retryMinutes)
      : null;
    const lastError = truncateSfError(`${err.code}: ${err.message}`);
    await updateOutboxRow(
      tx,
      row.id,
      delay === null
        ? { status: 'failed', attempts, lastError, failedAt: at, nextAttemptAt: null }
        : { attempts, lastError, nextAttemptAt: new Date(at.getTime() + delay) },
      at,
    );
    await audit({
      status: delay === null ? 'failed' : 'pending',
      attempts,
      code: err.code,
      retryable: err.retryable,
      ...(delay === null ? {} : { nextAttemptAt: new Date(at.getTime() + delay).toISOString() }),
    });
    if (delay === null) {
      result.failed++;
      failures.push({
        id: row.id,
        quoteId: row.quoteId,
        sfOpportunityId: row.sfOpportunityId,
        code: err.code,
      });
    } else {
      result.retrying++;
    }
  };

  // 3. Never close an opportunity another quote still needs (re-checked here, seeing every quote).
  if (row.closing && (await otherActiveOnOpportunity(tx, row.sfOpportunityId, row.quoteId))) {
    return skip('other_active_quote');
  }

  // 4. What Salesforce holds now, through the writer's own session.
  let current: string | null | undefined;
  if (row.sfField === SF_STAGE_FIELD) {
    const stage = await deps.writer.getCurrentStage(row.sfOpportunityId);
    if (!stage.ok) return fail(stage);
    current = stage.stage;
  }
  // A reopen goes over the close QuoteFlow wrote; failing that, over a close a re-quote superseded after
  // an attempt that may have reached Salesforce (the stage read above shows whether it did).
  const written = row.reopens
    ? await lastClosingWritten(tx, row.sfOpportunityId, ['sent'], row.id)
    : null;
  const possible =
    row.reopens && written === null
      ? await closingPossiblyWritten(tx, row.sfOpportunityId, row.id)
      : null;
  const decision = decideSend({
    row: { sfField: row.sfField, value: row.value, reopens: row.reopens },
    current,
    regression: settings.regression,
    stageRank: settings.map.stageRank,
    lastClosingWritten: written ?? possible,
  });
  const held = current === undefined ? {} : { salesforceStage: current };
  if (decision.action === 'skip') {
    // The uncertain close never reached Salesforce: there is nothing of QuoteFlow's to reopen.
    const reason =
      decision.reason === 'moved_in_salesforce' && written === null
        ? 'nothing_to_reopen'
        : decision.reason;
    return skip(reason, held);
  }
  if (decision.action === 'confirmed_existing') {
    await updateOutboxRow(
      tx,
      row.id,
      {
        status: 'sent',
        sentAt: at,
        attempts: row.attempts,
        nextAttemptAt: null,
        lastError: null,
        response: JSON.stringify({ ...held, confirmedExisting: true }),
      },
      at,
    );
    await audit({ status: 'sent', confirmed_existing: true, ...held });
    result.confirmed++;
    return;
  }

  // 5. Send.
  const sent = await deps.writer.updateOpportunity(
    row.sfOpportunityId,
    { [row.sfField]: row.value },
    { dedupeKey: row.dedupeKey },
  );
  if (!sent.ok) return fail(sent);
  await updateOutboxRow(
    tx,
    row.id,
    {
      status: 'sent',
      sentAt: at,
      attempts: row.attempts + 1,
      nextAttemptAt: null,
      lastError: null,
      response: JSON.stringify({ ...held, success: true }),
    },
    at,
  );
  await audit({ status: 'sent', attempts: row.attempts + 1, payload: row.payload, ...held });
  result.sent++;
}

/** One opportunity's due rows, in one transaction. False when nothing was due. */
async function processNextOpportunity(
  deps: SfWritebackDeps & { writer: SalesforceWriter },
  settings: SfWritebackSettings,
  result: SfWritebackRunResult,
  failures: FinalFailure[],
  clock: () => Date,
): Promise<boolean> {
  return withSystemContext(deps.database, async (tx) => {
    const at = clock();
    const opportunity = await nextDueOpportunity(tx, at);
    if (!opportunity) return false;
    const rows = await lockPendingForOpportunity(tx, opportunity);
    const { send, superseded } = latestPerField(rows);
    for (const old of superseded) {
      await updateOutboxRow(
        tx,
        old.id,
        { status: 'skipped', skippedReason: 'superseded', nextAttemptAt: null },
        at,
      );
      await insertSystemAudit(tx, {
        action: 'update',
        entityId: old.id,
        quoteId: old.quoteId,
        before: { status: old.status },
        after: {
          status: 'skipped',
          skippedReason: 'superseded',
          sfField: old.sfField,
          value: old.value,
        },
        at,
      });
      result.skipped++;
    }
    for (const row of send) {
      if (!row.nextAttemptAt || row.nextAttemptAt.getTime() > at.getTime()) continue; // not due yet
      await processRow(deps, tx, row, settings, result, failures, clock());
    }
    return true;
  });
}

/** Tell every Admin, once per failed row (in-app; the dedupe key is the row id). */
async function alertAdmins(deps: SfWritebackDeps, failures: FinalFailure[], at: Date) {
  for (const f of failures) {
    deps.logger.error(
      { outboxId: f.id, quoteId: f.quoteId, sfOpportunityId: f.sfOpportunityId, code: f.code },
      'salesforce write-back failed after every retry',
    );
  }
  await withSystemContext(deps.database, async (tx) => {
    const admins = await listActiveUserIdsWithRole(tx, 'Admin');
    await createNotifications(
      tx,
      failures.flatMap((f) =>
        admins.map((userId) => ({
          userId,
          type: 'sf_writeback.failed',
          quoteId: f.quoteId,
          title: 'A Salesforce update failed',
          body: `QuoteFlow could not update Salesforce opportunity ${f.sfOpportunityId} (${f.code}). Retry or skip it in Admin → Integrations; the quote itself is unaffected.`,
          dedupeKey: `sf_writeback:${f.id}`,
          at,
        })),
      ),
    );
  });
}

async function runLocked(deps: SfWritebackDeps): Promise<SfWritebackRunResult> {
  const clock = deps.now ?? (() => new Date());
  const result = { ...EMPTY };
  const writer = deps.writer;
  if (!writer) return { ...result, outcome: 'idle' };
  const loaded = await withSystemContext(deps.database, (tx) =>
    loadWritebackSettings(tx, deps.allowList),
  );
  if (!loaded.enabled) return { ...result, outcome: 'idle' };
  if (!loaded.settings || loaded.error) {
    deps.logger.error(
      { code: 'INVALID_CONFIG' },
      'salesforce write-back: settings invalid; nothing sent',
    );
    return { ...result, outcome: 'failed' };
  }
  // A dry run records rows as `dry_run` and never sends; a row queued while live waits for live again.
  if (loaded.settings.mode !== 'live') return { ...result, outcome: 'idle' };
  const failures: FinalFailure[] = [];
  for (let i = 0; i < (deps.batchSize ?? DEFAULT_BATCH); i++) {
    if (deps.shouldStop?.()) break;
    const more = await processNextOpportunity(
      { ...deps, writer },
      loaded.settings,
      result,
      failures,
      clock,
    );
    if (!more) break;
  }
  if (failures.length > 0) {
    try {
      await alertAdmins(deps, failures, clock());
    } catch {
      deps.logger.error(
        { count: failures.length },
        'salesforce write-back: could not alert the Admins',
      );
    }
  }
  return result;
}

/** One run, if no other instance is running one. Never throws. */
export async function runSfWriteback(deps: SfWritebackDeps): Promise<SfWritebackRunResult> {
  try {
    const lock = await withAdvisoryLock(deps.sql, ADVISORY_LOCKS.sfWriteback, () =>
      runLocked(deps),
    );
    if (!lock.acquired) return { ...EMPTY, outcome: 'skipped' };
    const r = lock.result;
    if (r.sent + r.confirmed + r.skipped + r.retrying + r.failed > 0) {
      deps.logger.info(
        {
          sent: r.sent,
          confirmed: r.confirmed,
          skipped: r.skipped,
          retrying: r.retrying,
          failed: r.failed,
        },
        'salesforce write-back finished',
      );
    }
    return r;
  } catch (err) {
    deps.logger.error(
      { code: (err as { code?: string }).code ?? 'unknown' },
      'salesforce write-back failed',
    );
    return { ...EMPTY, outcome: 'failed' };
  }
}

export interface SfWritebackScheduler {
  runNow(): Promise<SfWritebackRunResult>;
  start(): void;
  stop(): Promise<void>;
}

/** In-process schedule. `intervalSeconds` 0 = no schedule (tests call `runNow`). */
export function createSfWritebackScheduler(
  deps: SfWritebackDeps,
  intervalSeconds: number,
): SfWritebackScheduler {
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<SfWritebackRunResult> | null = null;
  let stopping = false;
  const runNow = () => {
    inFlight ??= runSfWriteback({ ...deps, shouldStop: () => stopping }).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
  return {
    runNow,
    start() {
      if (intervalSeconds <= 0 || timer || !deps.writer) return;
      timer = setInterval(() => void runNow(), intervalSeconds * 1000);
      timer.unref();
    },
    async stop() {
      // A run mid-batch finishes the opportunity in hand (its rows' locks) and starts no other.
      stopping = true;
      clearInterval(timer);
      timer = undefined;
      await inFlight?.catch(() => undefined);
    },
  };
}
