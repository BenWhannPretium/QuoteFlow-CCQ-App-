import { ADVISORY_LOCKS, withAdvisoryLock, withSystemContext, type Database } from '@ccq/db';
import {
  claimDueEmails,
  getSetting,
  listActiveUserIdsWithRole,
  listActiveUserIdsWithRoles,
  listEmailOptOuts,
  listGateQueue,
  listQuoteNumbersByIds,
  listUsersForEmail,
  loadWorkflowConfigInput,
  markEmailAttemptFailed,
  markEmailSent,
  markEmailSkipped,
} from '@ccq/db/repos';
import {
  EMAIL_MAX_ATTEMPTS,
  dueDigestDay,
  emailPreferenceKey,
  emailRetryDelayMs,
  parseWorkflowConfig,
  rolesWithPermission,
} from '@ccq/domain';
import { MailError, type MailTransport } from '@ccq/integrations';
import type { Sql } from 'postgres';

import { CommercialContentError, renderEmail } from '../emails';
import type { EmailContentBuilder } from '../services/emailContent';
import {
  EMAIL_ENABLED_SETTING,
  createNotifications,
  queueDigestEmails,
  type NotificationDraft,
} from '../services/notificationService';

/**
 * The email dispatcher (B-18). Every minute, in-process, on one instance only (`pg_try_advisory_lock`):
 *
 *   1. from 7:00 US Central (until 10:00, for a late restart), queue the day's **to-qualify digest**:
 *      one email per G1 decider listing everything waiting at G1 (once per day: a dedupe key);
 *   2. send every due email row (`channel = 'email'`). Each try is recorded on the row (`attempts`,
 *      `error`); a failure waits 1 minute, then 5, and the third failure is final (`failed_at`);
 *   3. for emails that failed for good, alert the **owners only**: an in-app notification to each Admin
 *      and an error log. Never the recipient, never the KAM.
 *
 * It never throws into the scheduler. Logs carry ids, types and error codes, never addresses or content.
 */

export interface DispatchLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface DispatchDeps {
  database: Database;
  /** The postgres.js client (the advisory lock needs its own reserved session). */
  sql: Sql;
  logger: DispatchLogger;
  transport: MailTransport;
  /** The shared mailbox. */
  from: string;
  content: EmailContentBuilder;
  now?: () => Date;
  /** Emails per run. */
  batchSize?: number;
}

export interface DispatchResult {
  outcome: 'succeeded' | 'failed' | 'skipped';
  sent: number;
  /** Failed this time, will be tried again. */
  retrying: number;
  /** Failed for good this time (the owners were alerted). */
  failed: number;
  /** Passed over: recipient gone or opted out, email switched off, empty digest. */
  skipped: number;
  digestsQueued: number;
}

const EMPTY: DispatchResult = {
  outcome: 'succeeded',
  sent: 0,
  retrying: 0,
  failed: 0,
  skipped: 0,
  digestsQueued: 0,
};

/** The G1 gate of the workflow config, when it exists and is enabled. */
const DIGEST_GATE_KEY = 'G1';
const DIGEST_TYPE = 'quote.to_qualify';
const DEFAULT_BATCH = 50;

/** A mail failure worth another try. A refused message (bad address) or a blocked one will not fix itself. */
const retryable = (err: unknown): boolean =>
  !(err instanceof CommercialContentError) &&
  !(err instanceof MailError && err.code === 'REJECTED');

/** A short, data-free description of why a send failed (stored on the row). */
function describeFailure(err: unknown): string {
  if (err instanceof MailError)
    return `${err.code}${err.status ? ` ${err.status}` : ''}: ${err.message}`;
  if (err instanceof CommercialContentError) return 'COMMERCIAL_CONTENT: blocked, not sent';
  return 'FAILED: could not build or send the email';
}

interface FinalFailure {
  id: string;
  type: string;
  quoteId: string | null;
  attempts: number;
  code: string;
}

type RowOutcome =
  | { kind: 'sent' }
  | { kind: 'skipped' }
  | { kind: 'retrying' }
  | { kind: 'failed'; failure: FinalFailure };

export interface DigestState {
  /** The Central day this process last evaluated the digest for. */
  evaluatedDay: string | null;
}

/** Step 1: the day's to-qualify digest. Returns the number of emails queued. */
async function enqueueDigest(deps: DispatchDeps, state: DigestState, now: Date): Promise<number> {
  const day = dueDigestDay(now);
  if (!day || state.evaluatedDay === day) return 0;
  const queued = await withSystemContext(deps.database, async (tx) => {
    const workflow = parseWorkflowConfig(await loadWorkflowConfigInput(tx));
    const gate = workflow.gates.find((g) => g.key === DIGEST_GATE_KEY);
    if (!gate?.enabled) return 0;
    const waiting = await listGateQueue(tx, {
      stageKey: gate.stageKey,
      submittedOnly: true,
      limit: 1,
    });
    if (waiting.length === 0) return 0;
    const deciders = await listActiveUserIdsWithRoles(
      tx,
      rolesWithPermission(gate.deciderPermission),
    );
    const drafts: NotificationDraft[] = deciders.map((userId) => ({
      userId,
      type: DIGEST_TYPE,
      quoteId: null,
      title: 'Quotes waiting to qualify',
      body: 'Daily summary of the quotes waiting at G1.',
      dedupeKey: `digest:${day}`,
      at: now,
    }));
    return queueDigestEmails(tx, drafts);
  });
  // Only once it worked: a database error leaves the day open for the next minute's run.
  state.evaluatedDay = day;
  return queued;
}

/** Try one due row inside its own transaction. Null when nothing is due. */
async function dispatchOne(deps: DispatchDeps, now: () => Date): Promise<RowOutcome | null> {
  return withSystemContext(deps.database, async (tx) => {
    const [row] = await claimDueEmails(tx, now(), 1);
    if (!row) return null;
    const at = now();

    const skip = async (reason: string): Promise<RowOutcome> => {
      await markEmailSkipped(tx, row.id, at, reason);
      return { kind: 'skipped' };
    };
    if (((await getSetting<boolean>(tx, EMAIL_ENABLED_SETTING)) ?? true) === false) {
      return skip('email notifications are switched off');
    }
    const [recipient] = await listUsersForEmail(tx, [row.userId]);
    if (!recipient?.active || !recipient.email) return skip('recipient has no active address');
    if ((await listEmailOptOuts(tx, [row.userId], emailPreferenceKey(row.type))).has(row.userId)) {
      return skip('recipient opted out');
    }

    const attempts = row.attempts + 1;
    try {
      const model = await deps.content.build(row);
      if (!model) return skip('nothing to send');
      const email = renderEmail(model);
      await deps.transport.send({
        from: deps.from,
        to: recipient.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
    } catch (err) {
      const delay = retryable(err) ? emailRetryDelayMs(attempts) : null;
      const error = describeFailure(err);
      await markEmailAttemptFailed(tx, row.id, at, {
        attempts,
        error,
        nextAttemptAt: delay === null ? null : new Date(at.getTime() + delay),
      });
      if (delay !== null) return { kind: 'retrying' };
      return {
        kind: 'failed',
        failure: {
          id: row.id,
          type: row.type,
          quoteId: row.quoteId,
          attempts,
          code: error.split(':')[0]!,
        },
      };
    }
    // Outside the try: a database error here must not be reported as a failed send (it was sent).
    await markEmailSent(tx, row.id, at, attempts);
    return { kind: 'sent' };
  });
}

/** Step 3: tell the owners (Admins) that emails failed for good. In-app only; the log has the ids. */
async function alertOwners(deps: DispatchDeps, failures: FinalFailure[], now: Date) {
  for (const f of failures) {
    deps.logger.error(
      { notificationId: f.id, type: f.type, attempts: f.attempts, code: f.code },
      'email delivery failed after every retry',
    );
  }
  await withSystemContext(deps.database, async (tx) => {
    const numbers = await listQuoteNumbersByIds(
      tx,
      failures.flatMap((f) => (f.quoteId ? [f.quoteId] : [])),
    );
    const shown = failures.slice(0, 5).map((f) => {
      const quote = f.quoteId ? numbers.get(f.quoteId) : undefined;
      return `${quote ?? 'digest'} (${f.type}, ${f.code})`;
    });
    const more = failures.length - shown.length;
    const admins = await listActiveUserIdsWithRole(tx, 'Admin');
    await createNotifications(
      tx,
      admins.map((userId) => ({
        userId,
        type: 'notification.delivery_failed',
        quoteId: null,
        title: `${failures.length} email${failures.length === 1 ? '' : 's'} could not be sent`,
        body: `Failed after ${EMAIL_MAX_ATTEMPTS} tries: ${shown.join('; ')}${more > 0 ? `; and ${more} more` : ''}. Check the shared mailbox and Graph settings; the application log has the details.`,
        at: now,
      })),
    );
  });
}

async function dispatchLocked(deps: DispatchDeps, state: DigestState): Promise<DispatchResult> {
  const clock = deps.now ?? (() => new Date());
  const result = { ...EMPTY };
  result.digestsQueued = await enqueueDigest(deps, state, clock());

  const failures: FinalFailure[] = [];
  for (let i = 0; i < (deps.batchSize ?? DEFAULT_BATCH); i++) {
    const outcome = await dispatchOne(deps, clock);
    if (!outcome) break;
    if (outcome.kind === 'sent') result.sent++;
    else if (outcome.kind === 'skipped') result.skipped++;
    else if (outcome.kind === 'retrying') result.retrying++;
    else {
      result.failed++;
      failures.push(outcome.failure);
    }
  }
  if (failures.length > 0) {
    try {
      await alertOwners(deps, failures, clock());
    } catch {
      deps.logger.error({ count: failures.length }, 'email dispatch: could not alert the owners');
    }
  }
  return result;
}

/** One run, if no other instance is running one. Never throws. */
export async function runNotificationDispatch(
  deps: DispatchDeps,
  state: DigestState = { evaluatedDay: null },
): Promise<DispatchResult> {
  try {
    const lock = await withAdvisoryLock(deps.sql, ADVISORY_LOCKS.notificationDispatch, () =>
      dispatchLocked(deps, state),
    );
    if (!lock.acquired) return { ...EMPTY, outcome: 'skipped' };
    const r = lock.result;
    if (r.sent + r.retrying + r.failed + r.skipped + r.digestsQueued > 0) {
      deps.logger.info(
        {
          sent: r.sent,
          retrying: r.retrying,
          failed: r.failed,
          skipped: r.skipped,
          digestsQueued: r.digestsQueued,
        },
        'email dispatch finished',
      );
    }
    return r;
  } catch (err) {
    deps.logger.error(
      { code: (err as { code?: string }).code ?? 'unknown' },
      'email dispatch failed',
    );
    return { ...EMPTY, outcome: 'failed' };
  }
}

export interface NotificationDispatchScheduler {
  runNow(): Promise<DispatchResult>;
  start(): void;
  stop(): Promise<void>;
}

/** In-process schedule. `intervalSeconds` 0 = no schedule (tests call `runNow`). */
export function createNotificationDispatchScheduler(
  deps: DispatchDeps,
  intervalSeconds: number,
): NotificationDispatchScheduler {
  const state: DigestState = { evaluatedDay: null };
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<DispatchResult> | null = null;
  const runNow = () => {
    inFlight ??= runNotificationDispatch(deps, state).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
  return {
    runNow,
    start() {
      if (intervalSeconds <= 0 || timer) return;
      timer = setInterval(() => void runNow(), intervalSeconds * 1000);
      timer.unref();
    },
    async stop() {
      clearInterval(timer);
      timer = undefined;
      await inFlight?.catch(() => undefined);
    },
  };
}
