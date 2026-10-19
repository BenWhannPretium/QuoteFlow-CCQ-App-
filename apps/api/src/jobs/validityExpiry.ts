import { ADVISORY_LOCKS, withAdvisoryLock, withSystemContext, type Database } from '@ccq/db';
import {
  getSetting,
  insertActivityEvent,
  listUnflaggedValidityQuotes,
  updateQuote,
} from '@ccq/db/repos';
import {
  CUSTOMER_DECISION_STAGE_KEY,
  parseValidityWarningDays,
  quotesToFlagExpired,
  quotesToWarnExpiring,
} from '@ccq/domain';
import type { Sql } from 'postgres';

import { createNotifications } from '../services/notificationService';

/**
 * Proposal validity expiry (B-13). Once a day, in-process, on one instance only
 * (`pg_try_advisory_lock`): every open quote in Customer Decision whose `validity_until` has passed
 * (US Central calendar) and has not been flagged yet gets
 *
 *   1. `quote.validity_expired_flagged_at` (so it is flagged once per validity date),
 *   2. a `validity_expired` activity event (the timeline), and
 *   3. a notification to its KAM (in-app + email, B-18): "Revalidate or record the outcome".
 *
 * It never changes the stage or status: an expired proposal is not a lost one, and whether CCQ should
 * ever auto-close is D-12 (open). Logs carry ids and counts only. Never throws into the scheduler.
 *
 * B-18: the same run warns the KAM once when a validity date comes within `validity_warning_days` (7 in
 * the seed) and tells them by email as well as in-app. Both are once per state: the notification's
 * dedupe key carries the quote and the validity date, so a re-run, a restart or a second instance
 * writes nothing twice, and a new validity date (a revalidation) starts the states over.
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
  /** B-18: KAMs warned that a validity date is close (new warnings only). */
  warned: number;
  warnedQuoteNumbers: string[];
}

const daysPhrase = (daysLeft: number) =>
  daysLeft === 0
    ? 'today is its last valid day'
    : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;

async function expireLocked(deps: ValidityExpiryDeps): Promise<ValidityExpiryResult> {
  const at = (deps.now ?? (() => new Date()))();
  return withSystemContext(deps.database, async (tx) => {
    const candidates = await listUnflaggedValidityQuotes(tx, CUSTOMER_DECISION_STAGE_KEY);

    // B-18: the pre-expiry warning, once per validity date (the dedupe key skips a repeat).
    const warningDays = parseValidityWarningDays(await getSetting(tx, 'validity_warning_days'));
    const expiring = quotesToWarnExpiring(candidates, at, warningDays);
    const warnedQuoteNumbers: string[] = [];
    for (const q of expiring) {
      const created = await createNotifications(
        tx,
        [
          {
            userId: q.kamUserId,
            type: 'quote.validity_expiring',
            quoteId: q.id,
            title: `${q.quoteNumber}: the proposal validity is running out`,
            body: `Valid until ${q.validityUntil} (${daysPhrase(q.daysLeft)}). Revalidate it or record the outcome.`,
            payload: { validityUntil: q.validityUntil!, daysLeft: String(q.daysLeft) },
            dedupeKey: `quote.validity_expiring:${q.id}:${q.validityUntil}`,
            at,
          },
        ],
        undefined,
        { counted: true },
      );
      if (created > 0) warnedQuoteNumbers.push(q.quoteNumber);
    }

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
      await createNotifications(tx, [
        {
          userId: q.kamUserId,
          type: 'quote.validity_expired',
          quoteId: q.id,
          title: `${q.quoteNumber}: the proposal validity has passed`,
          body: `It was valid until ${q.validityUntil}. Revalidate or record the outcome.`,
          payload: { validityUntil: q.validityUntil! },
          dedupeKey: `quote.validity_expired:${q.id}:${q.validityUntil}`,
          at,
        },
      ]);
    }
    return {
      outcome: 'succeeded' as const,
      flagged: due.length,
      quoteNumbers: due.map((q) => q.quoteNumber),
      warned: warnedQuoteNumbers.length,
      warnedQuoteNumbers,
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
      return {
        outcome: 'skipped',
        flagged: 0,
        quoteNumbers: [],
        warned: 0,
        warnedQuoteNumbers: [],
      };
    }
    deps.logger.info(
      { flagged: lock.result.flagged, warned: lock.result.warned },
      'validity expiry finished',
    );
    return lock.result;
  } catch (err) {
    deps.logger.error(
      { code: (err as { code?: string }).code ?? 'unknown' },
      'validity expiry failed',
    );
    return { outcome: 'failed', flagged: 0, quoteNumbers: [], warned: 0, warnedQuoteNumbers: [] };
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
