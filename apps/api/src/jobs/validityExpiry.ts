import { ADVISORY_LOCKS, withAdvisoryLock, withSystemContext, type Database } from '@ccq/db';
import {
  insertActivityEvent,
  insertNotification,
  listUnflaggedValidityQuotes,
  updateQuote,
} from '@ccq/db/repos';
import { CUSTOMER_DECISION_STAGE_KEY, quotesToFlagExpired } from '@ccq/domain';
import type { Sql } from 'postgres';

/**
 * Proposal validity expiry (B-13). Once a day, in-process, on one instance only
 * (`pg_try_advisory_lock`): every open quote in Customer Decision whose `validity_until` has passed
 * (US Central calendar) and has not been flagged yet gets
 *
 *   1. `quote.validity_expired_flagged_at` (so it is flagged once per validity date),
 *   2. a `validity_expired` activity event (the timeline), and
 *   3. an in-app notification to its KAM: "Revalidate or record the outcome" (email is B-18).
 *
 * It never changes the stage or status: an expired proposal is not a lost one, and whether CCQ should
 * ever auto-close is D-12 (open). Logs carry ids and counts only. Never throws into the scheduler.
 */

export interface ValidityExpiryLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface ValidityExpiryDeps {
  database: Database;
  /** The postgres.js client (the advisory lock needs its own reserved session). */
  sql: Sql;
  logger: ValidityExpiryLogger;
  now?: () => Date;
}

export interface ValidityExpiryResult {
  outcome: 'succeeded' | 'failed' | 'skipped';
  flagged: number;
  quoteNumbers: string[];
}

async function expireLocked(deps: ValidityExpiryDeps): Promise<ValidityExpiryResult> {
  const at = (deps.now ?? (() => new Date()))();
  return withSystemContext(deps.database, async (tx) => {
    const candidates = await listUnflaggedValidityQuotes(tx, CUSTOMER_DECISION_STAGE_KEY);
    const due = quotesToFlagExpired(candidates, at);
    for (const q of due) {
      await updateQuote(tx, q.id, { validityExpiredFlaggedAt: at });
      await insertActivityEvent(tx, {
        quoteId: q.id,
        type: 'validity_expired',
        actorId: null,
        at,
        payload: { validityUntil: q.validityUntil },
      });
      await insertNotification(tx, {
        userId: q.kamUserId,
        type: 'quote.validity_expired',
        quoteId: q.id,
        title: `${q.quoteNumber}: the proposal validity has passed`,
        body: `It was valid until ${q.validityUntil}. Revalidate or record the outcome.`,
        channel: 'in_app',
        createdAt: at,
        updatedAt: at,
      });
    }
    return {
      outcome: 'succeeded' as const,
      flagged: due.length,
      quoteNumbers: due.map((q) => q.quoteNumber),
    };
  });
}

/** One run, if no other instance is running one. Never throws. */
export async function runValidityExpiry(deps: ValidityExpiryDeps): Promise<ValidityExpiryResult> {
  try {
    const lock = await withAdvisoryLock(deps.sql, ADVISORY_LOCKS.validityExpiry, () =>
      expireLocked(deps),
    );
    if (!lock.acquired) {
      deps.logger.info({}, 'validity expiry skipped: another instance holds the lock');
      return { outcome: 'skipped', flagged: 0, quoteNumbers: [] };
    }
    deps.logger.info({ flagged: lock.result.flagged }, 'validity expiry finished');
    return lock.result;
  } catch (err) {
    deps.logger.error(
      { code: (err as { code?: string }).code ?? 'unknown' },
      'validity expiry failed',
    );
    return { outcome: 'failed', flagged: 0, quoteNumbers: [] };
  }
}

export interface ValidityExpiryScheduler {
  runNow(): Promise<ValidityExpiryResult>;
  start(): void;
  stop(): Promise<void>;
}

/** In-process daily schedule. `intervalHours` 0 = no schedule. */
export function createValidityExpiryScheduler(
  deps: ValidityExpiryDeps,
  intervalHours: number,
): ValidityExpiryScheduler {
  let timer: NodeJS.Timeout | undefined;
  let first: NodeJS.Timeout | undefined;
  let inFlight: Promise<ValidityExpiryResult> | null = null;
  const runNow = () => {
    inFlight ??= runValidityExpiry(deps).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
  return {
    runNow,
    start() {
      if (intervalHours <= 0 || timer) return;
      const tick = () => void runNow();
      // First run a minute after boot (a restart never skips a day), then on the interval.
      first = setTimeout(tick, 60_000);
      first.unref();
      timer = setInterval(tick, intervalHours * 3_600_000);
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
