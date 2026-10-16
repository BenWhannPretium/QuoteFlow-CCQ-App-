import {
  ADVISORY_LOCKS,
  withAdvisoryLock,
  withSystemContext,
  type Database,
  type DbOrTx,
} from '@ccq/db';
import {
  finishIntegrationRun,
  getSetting,
  insertActivityEvent,
  insertNotification,
  lastSucceededRunStart,
  listActiveUserIdsWithRole,
  markSfOpportunitiesDeleted,
  refreshQuoteSfStatusFlags,
  startIntegrationRun,
  upsertSfCustomers,
  upsertSfOpportunities,
  type NewSfOpportunitySnapshot,
  type SfCustomerRow,
} from '@ccq/db/repos';
import {
  DEFAULT_SUSPECT_AMOUNT_BELOW,
  opportunityQualityFlags,
  sfErrorCode,
  type SalesforceReader,
  type SfLogger,
  type SfOpportunityRecord,
} from '@ccq/integrations';
import type { Sql } from 'postgres';

/**
 * Salesforce delta sync (B-06). Every 15 min, in-process, on one instance only
 * (`pg_try_advisory_lock`):
 *
 * 1. read opportunities with `SystemModstamp >` the last succeeded run (minus a small overlap),
 * 2. upsert `sf_opportunity_snapshot` (raw payload kept) and `customer` (existing + default ship-to),
 * 3. mark opportunities deleted in SF (snapshots are kept, never deleted),
 * 4. flag CCQ quotes whose opportunity was closed or deleted in SF (`quote.sf_status_flag`),
 * 5. write `integration_run` with counts.
 *
 * On failure it alerts the owners only (an in-app notification to each Admin and an error log) and
 * returns: it never throws into the scheduler and never blocks the UI. Logs carry ids and counts,
 * never record contents.
 */

export const SF_SYNC_SOURCE = 'salesforce';
/** Re-read this much before the watermark, to absorb clock skew between SF and us. Upserts skip unchanged rows. */
export const SF_SYNC_OVERLAP_MS = 5 * 60_000;

export interface SfSyncDeps {
  database: Database;
  /** The postgres.js client (the advisory lock needs its own reserved session). */
  sql: Sql;
  reader: SalesforceReader;
  logger: SfLogger;
  now?: () => Date;
}

export interface SfSyncCounts {
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: number;
  customersInserted: number;
  customersUpdated: number;
  deleted: number;
  quotesFlagged: number;
  quotesUnflagged: number;
}

export interface SfSyncResult {
  outcome: 'succeeded' | 'partial' | 'failed' | 'skipped';
  runId: string | null;
  counts: Partial<SfSyncCounts>;
}

const emptyCounts = (): SfSyncCounts => ({
  fetched: 0,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  errors: 0,
  customersInserted: 0,
  customersUpdated: 0,
  deleted: 0,
  quotesFlagged: 0,
  quotesUnflagged: 0,
});

/** Snapshot row for a mapped opportunity. Quality flags use the configured suspect threshold. */
export function snapshotRow(
  rec: SfOpportunityRecord,
  syncedAt: Date,
  suspectAmountBelow: number,
): NewSfOpportunitySnapshot {
  const o = rec.opportunity;
  return {
    sfOpportunityId: o.id,
    name: o.name,
    accountId: o.accountId,
    accountName: o.accountName,
    ownerAlias: o.ownerAlias,
    ownerEmail: o.ownerEmail,
    ownerName: o.ownerName,
    amount: o.amount,
    closeDate: o.closeDate,
    sfStage: o.stage,
    isClosed: o.isClosed,
    isWon: o.isWon,
    erfNumberSf: o.erfNumber,
    quoteSourceSf: o.quoteSource,
    systemModstamp: o.systemModstamp ? new Date(o.systemModstamp) : null,
    deletedInSfAt: null,
    dataQuality: opportunityQualityFlags(o, { suspectAmountBelow }),
    raw: rec.raw,
    syncedAt,
  };
}

/** One customer per account on the page (last one wins). */
export function customerRows(page: SfOpportunityRecord[]): SfCustomerRow[] {
  const byId = new Map<string, SfCustomerRow>();
  for (const { account } of page) {
    if (!account) continue;
    byId.set(account.id, {
      sfAccountId: account.id,
      name: account.name,
      defaultShipTo: account.shipTo,
    });
  }
  return [...byId.values()];
}

async function suspectThreshold(db: DbOrTx): Promise<number> {
  const value = await getSetting<number | null>(db, 'sf_amount_suspect_below_usd');
  return typeof value === 'number' ? value : DEFAULT_SUSPECT_AMOUNT_BELOW;
}

/** Alert the owners: an in-app notification for each active Admin. Best effort. */
async function alertOwners(deps: SfSyncDeps, runId: string, code: string, at: Date) {
  try {
    await withSystemContext(deps.database, async (tx) => {
      for (const userId of await listActiveUserIdsWithRole(tx, 'Admin')) {
        await insertNotification(tx, {
          userId,
          type: 'integration.failed',
          title: 'Salesforce sync failed',
          body: `The Salesforce sync run ${runId} failed (${code}). Quotes and intake keep working from the last snapshot. See Admin → Integrations.`,
          channel: 'in_app',
          createdAt: at,
          updatedAt: at,
        });
      }
    });
  } catch (err) {
    deps.logger.error({ runId, code: sfErrorCode(err) }, 'sf sync: could not notify admins');
  }
}

async function syncLocked(deps: SfSyncDeps): Promise<SfSyncResult> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const { database, reader, logger } = deps;

  const { run, since, threshold } = await withSystemContext(database, async (tx) => ({
    run: await startIntegrationRun(tx, SF_SYNC_SOURCE, startedAt),
    since: await lastSucceededRunStart(tx, SF_SYNC_SOURCE),
    threshold: await suspectThreshold(tx),
  }));
  const window = since ? new Date(since.getTime() - SF_SYNC_OVERLAP_MS) : null;
  const counts = emptyCounts();
  logger.info(
    { runId: run.id, mode: reader.mode, since: window?.toISOString() ?? null },
    'sf sync started',
  );

  try {
    for await (const page of reader.listChangedOpportunities(window)) {
      counts.fetched += page.length;
      try {
        await withSystemContext(database, async (tx) => {
          const syncedAt = now();
          const opp = await upsertSfOpportunities(
            tx,
            page.map((rec) => snapshotRow(rec, syncedAt, threshold)),
          );
          const cust = await upsertSfCustomers(tx, customerRows(page), syncedAt);
          counts.inserted += opp.inserted;
          counts.updated += opp.updated;
          counts.unchanged += opp.unchanged;
          counts.customersInserted += cust.inserted;
          counts.customersUpdated += cust.updated;
        });
      } catch (err) {
        // A bad page is counted and skipped; the run ends `partial` and the next run re-reads it.
        counts.errors += page.length;
        logger.error(
          { runId: run.id, page: page.length, code: sfErrorCode(err) },
          'sf sync: page failed',
        );
      }
    }

    if (window) {
      const deletedIds = await reader.listDeletedOpportunityIds(window, startedAt);
      counts.deleted = await withSystemContext(database, (tx) =>
        markSfOpportunitiesDeleted(tx, deletedIds, now()),
      );
    }

    await withSystemContext(database, async (tx) => {
      const at = now();
      const changes = await refreshQuoteSfStatusFlags(tx, at);
      for (const change of changes) {
        if (change.flag) counts.quotesFlagged += 1;
        else counts.quotesUnflagged += 1;
        await insertActivityEvent(tx, {
          quoteId: change.quoteId,
          type: 'sf_status_changed',
          actorId: null,
          at,
          payload: { sfOpportunityId: change.sfOpportunityId, sfStatusFlag: change.flag },
        });
      }
    });

    const outcome = counts.errors > 0 ? 'partial' : 'succeeded';
    await withSystemContext(database, (tx) =>
      finishIntegrationRun(tx, run.id, {
        status: outcome,
        finishedAt: now(),
        counts: { ...counts },
        error: counts.errors > 0 ? `${counts.errors} records failed to save` : null,
      }),
    );
    logger.info({ runId: run.id, outcome, ...counts }, 'sf sync finished');
    return { outcome, runId: run.id, counts };
  } catch (err) {
    const code = sfErrorCode(err);
    logger.error({ runId: run.id, code, ...counts }, 'sf sync failed');
    await withSystemContext(database, (tx) =>
      finishIntegrationRun(tx, run.id, {
        status: 'failed',
        finishedAt: now(),
        counts: { ...counts },
        error: `Salesforce sync failed: ${code}`,
      }),
    ).catch((e: unknown) =>
      logger.error({ runId: run.id, code: sfErrorCode(e) }, 'sf sync: could not record failure'),
    );
    await alertOwners(deps, run.id, code, now());
    return { outcome: 'failed', runId: run.id, counts };
  }
}

/** One sync run, if no other instance is running one. Never throws. */
export async function runSfSync(deps: SfSyncDeps): Promise<SfSyncResult> {
  try {
    const lock = await withAdvisoryLock(deps.sql, ADVISORY_LOCKS.sfSync, () => syncLocked(deps));
    if (!lock.acquired) {
      deps.logger.info({}, 'sf sync skipped: another instance holds the lock');
      return { outcome: 'skipped', runId: null, counts: {} };
    }
    return lock.result;
  } catch (err) {
    // Only reachable if the database itself is unavailable (no run row could be written).
    deps.logger.error({ code: sfErrorCode(err) }, 'sf sync could not start');
    return { outcome: 'failed', runId: null, counts: {} };
  }
}

export interface SfSyncScheduler {
  /** Run now (also used by POST /admin/salesforce/sync). */
  runNow(): Promise<SfSyncResult>;
  start(): void;
  stop(): Promise<void>;
}

/** In-process schedule. `intervalMinutes` 0 = no schedule (manual runs only). */
export function createSfSyncScheduler(deps: SfSyncDeps, intervalMinutes: number): SfSyncScheduler {
  let timer: NodeJS.Timeout | undefined;
  let first: NodeJS.Timeout | undefined;
  let inFlight: Promise<SfSyncResult> | null = null;
  const runNow = () => {
    // Coalesce overlapping triggers in this process; the advisory lock covers other instances.
    inFlight ??= runSfSync(deps).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
  return {
    runNow,
    start() {
      if (intervalMinutes <= 0 || timer) return;
      const tick = () => void runNow();
      // First run shortly after boot, then on the interval. unref: never keeps the process alive.
      first = setTimeout(tick, 10_000);
      first.unref();
      timer = setInterval(tick, intervalMinutes * 60_000);
      timer.unref();
    },
    async stop() {
      clearTimeout(first);
      clearInterval(timer);
      timer = undefined;
      await inFlight?.catch(() => undefined);
    },
  };
}
