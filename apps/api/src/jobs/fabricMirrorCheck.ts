import { ADVISORY_LOCKS, withAdvisoryLock, withSystemContext, type Database } from '@ccq/db';
import {
  finishIntegrationRun,
  insertNotification,
  listActiveUserIdsWithRole,
  listIntegrationRuns,
  startIntegrationRun,
} from '@ccq/db/repos';
import { FabricApiError, fabricMirrorHealth, type FabricMirrorReader } from '@ccq/integrations';
import type { Sql } from 'postgres';

/**
 * Fabric mirror health check (B-27, L-8). Hourly, in-process, on one instance only
 * (`pg_try_advisory_lock`): asks the Fabric REST API whether the mirror of this database is Running
 * and every table is replicating, and writes an `integration_run` (source `fabric`) with the counts.
 *
 * An unhealthy mirror is a `failed` run, and Admins get an in-app alert when the mirror **becomes**
 * unhealthy (not every hour while it stays so). The app keeps working either way: the mirror is a
 * copy, and Fabric reseeds every table when mirroring restarts, so no data is lost while it's down.
 * Never throws into the scheduler. Logs carry codes and counts only.
 */

export const FABRIC_SOURCE = 'fabric';

export interface FabricMirrorCheckLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface FabricMirrorCheckDeps {
  database: Database;
  /** The postgres.js client (the advisory lock needs its own reserved session). */
  sql: Sql;
  reader: FabricMirrorReader;
  logger: FabricMirrorCheckLogger;
  now?: () => Date;
}

export interface FabricMirrorCheckResult {
  outcome: 'succeeded' | 'failed' | 'skipped';
  runId: string | null;
  error: string | null;
}

const errorCode = (err: unknown) =>
  err instanceof FabricApiError ? err.code : ((err as { code?: string }).code ?? 'unknown');

async function checkLocked(deps: FabricMirrorCheckDeps): Promise<FabricMirrorCheckResult> {
  const now = deps.now ?? (() => new Date());
  const { run, wasFailing } = await withSystemContext(deps.database, async (tx) => {
    const [previous] = await listIntegrationRuns(tx, { source: FABRIC_SOURCE, limit: 1 });
    return {
      wasFailing: previous?.status === 'failed',
      run: await startIntegrationRun(tx, FABRIC_SOURCE, now()),
    };
  });

  let counts: Record<string, number> = {};
  let error: string | null;
  try {
    const [status, tables] = await Promise.all([
      deps.reader.mirroringStatus(),
      deps.reader.tablesStatus(),
    ]);
    const health = fabricMirrorHealth(status, tables);
    counts = health.counts;
    error = health.error;
  } catch (err) {
    error = `Fabric API unavailable (${errorCode(err)})`;
  }

  const at = now();
  await withSystemContext(deps.database, async (tx) => {
    await finishIntegrationRun(tx, run.id, {
      status: error ? 'failed' : 'succeeded',
      finishedAt: at,
      counts,
      error,
    });
    if (error && !wasFailing) {
      for (const userId of await listActiveUserIdsWithRole(tx, 'Admin')) {
        await insertNotification(tx, {
          userId,
          type: 'integration.failed',
          title: 'The Fabric copy of QuoteFlow data is not up to date',
          body: `Fabric mirroring check ${run.id}: ${error}. QuoteFlow keeps working; Fabric catches up when mirroring restarts. See Admin → Integrations and the B-27 runbook.`,
          channel: 'in_app',
          createdAt: at,
          updatedAt: at,
        });
      }
    }
  });
  if (error) deps.logger.error({ runId: run.id, ...counts }, 'fabric mirror unhealthy');
  else deps.logger.info({ runId: run.id, ...counts }, 'fabric mirror healthy');
  return { outcome: error ? 'failed' : 'succeeded', runId: run.id, error };
}

/** One check, if no other instance is running one. Never throws. */
export async function runFabricMirrorCheck(
  deps: FabricMirrorCheckDeps,
): Promise<FabricMirrorCheckResult> {
  try {
    const lock = await withAdvisoryLock(deps.sql, ADVISORY_LOCKS.fabricMirrorCheck, () =>
      checkLocked(deps),
    );
    if (!lock.acquired) return { outcome: 'skipped', runId: null, error: null };
    return lock.result;
  } catch (err) {
    deps.logger.error({ code: errorCode(err) }, 'fabric mirror check could not run');
    return { outcome: 'failed', runId: null, error: 'check could not run' };
  }
}

export interface FabricMirrorCheckScheduler {
  runNow(): Promise<FabricMirrorCheckResult>;
  start(): void;
  stop(): Promise<void>;
}

/** In-process schedule. `intervalMinutes` 0 = no schedule. */
export function createFabricMirrorCheckScheduler(
  deps: FabricMirrorCheckDeps,
  intervalMinutes: number,
): FabricMirrorCheckScheduler {
  let timer: NodeJS.Timeout | undefined;
  let first: NodeJS.Timeout | undefined;
  let inFlight: Promise<FabricMirrorCheckResult> | null = null;
  const runNow = () => {
    inFlight ??= runFabricMirrorCheck(deps).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
  return {
    runNow,
    start() {
      if (intervalMinutes <= 0 || timer) return;
      const tick = () => void runNow();
      // First check a few minutes after boot (a deploy restarts mirroring around migrations).
      first = setTimeout(tick, 5 * 60_000);
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
