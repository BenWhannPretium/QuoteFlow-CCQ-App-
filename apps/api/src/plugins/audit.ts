import { contextFromActor, withRequestContext, type Database, type DbOrTx } from '@ccq/db';
import { hasQuoteAuditSince, insertAuditEvent, lockKey, type NewAuditEvent } from '@ccq/db/repos';
import type { Actor } from '@ccq/domain';
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Usage audit log (F-12, B-09). Append-only `audit_event` rows for:
 *
 * - every **view** of a quote: a route sets `req.auditView`; after a successful response this plugin
 *   writes the row asynchronously, best effort (a failure is logged, never returned), debounced to one
 *   per user per quote per `viewDebounceMs` (10 min);
 * - every **mutation**, export, upload/download and config change: services call `recordAudit(tx, …)`
 *   inside the mutation's own transaction, so a failed mutation leaves no audit row;
 * - **sign-in**: the identity service (B-04).
 *
 * The database denies UPDATE/DELETE/TRUNCATE on audit_event for ccq_app and blocks them by trigger.
 */

export interface AuditMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

export const auditMeta = (req: FastifyRequest): AuditMeta => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  requestId: req.id,
});

export interface AuditEntry {
  action: NewAuditEvent['action'];
  entity: string;
  entityId?: string | null;
  quoteId?: string | null;
  before?: unknown;
  after?: unknown;
  at: Date;
}

/** Keys whose values never reach the audit log (tokens, secrets, credentials). */
const SECRET_KEY =
  /token|secret|password|passwd|authorization|cookie|private_?key|api_?key|assertion|credential/i;
export const REDACTED = '[redacted]';

/** Deep copy of `value` with secret-looking keys replaced by "[redacted]". */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth > 20) return REDACTED;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      SECRET_KEY.test(k) ? REDACTED : redactSecrets(v, depth + 1),
    ]),
  );
}

/** Insert one audit row in the caller's transaction (mutations: same transaction as the change). */
export async function recordAudit(db: DbOrTx, actor: Actor, meta: AuditMeta, entry: AuditEntry) {
  return insertAuditEvent(db, {
    at: entry.at,
    actorId: actor.userId,
    actorRoles: [...actor.roles],
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    quoteId: entry.quoteId ?? null,
    before: entry.before === undefined ? null : redactSecrets(entry.before),
    after: entry.after === undefined ? null : redactSecrets(entry.after),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
    requestId: meta.requestId ?? null,
    createdBy: actor.userId,
  });
}

export interface AuditViewTarget {
  entity: 'quote';
  entityId: string;
  quoteId: string;
}

export interface AuditRecorderOptions {
  database?: Database | undefined;
  log: FastifyBaseLogger;
  now?: (() => Date) | undefined;
  /** One view row per user per quote per window. Default 10 minutes. */
  viewDebounceMs?: number;
}

const MAX_TRACKED_VIEWS = 5_000;

export class AuditRecorder {
  readonly viewDebounceMs: number;
  private readonly now: () => Date;
  /** `${userId}:${quoteId}` → when this process last wrote (or is writing) that view. */
  private readonly recentViews = new Map<string, number>();
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly opts: AuditRecorderOptions) {
    this.now = opts.now ?? (() => new Date());
    this.viewDebounceMs = opts.viewDebounceMs ?? 10 * 60_000;
  }

  /**
   * Queue a view audit (fire-and-forget). Debounced in memory first, then re-checked in the database
   * under an advisory lock, so several API instances still write one row per window.
   */
  scheduleView(actor: Actor, meta: AuditMeta, target: AuditViewTarget): void {
    const database = this.opts.database;
    if (!database) return;
    const at = this.now();
    const key = `${actor.userId}:${target.quoteId}`;
    const last = this.recentViews.get(key);
    if (last !== undefined && at.getTime() - last < this.viewDebounceMs) return;
    this.recentViews.set(key, at.getTime());
    this.prune(at.getTime());

    const since = new Date(at.getTime() - this.viewDebounceMs);
    const write = withRequestContext(database, contextFromActor(actor), async (tx) => {
      await lockKey(tx, `audit-view:${key}`);
      if (await hasQuoteAuditSince(tx, actor.userId, target.quoteId, 'view', since)) return;
      await recordAudit(tx, actor, meta, {
        action: 'view',
        entity: target.entity,
        entityId: target.entityId,
        quoteId: target.quoteId,
        at,
      });
    }).catch((err: unknown) => {
      this.recentViews.delete(key);
      this.opts.log.warn({ err, quoteId: target.quoteId }, 'view audit failed (best effort)');
    });
    this.pending.add(write);
    void write.finally(() => this.pending.delete(write));
  }

  /** Wait for queued view audits (shutdown, tests). */
  async flush(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  private prune(nowMs: number) {
    if (this.recentViews.size <= MAX_TRACKED_VIEWS) return;
    for (const [key, ms] of this.recentViews) {
      if (nowMs - ms >= this.viewDebounceMs) this.recentViews.delete(key);
    }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    audit: AuditRecorder;
  }
  interface FastifyRequest {
    /** Set by a read route (GET /quotes/:qn): audited as a `view` after a successful response. */
    auditView: AuditViewTarget | null;
  }
}

export const auditPlugin = fp(
  (app: FastifyInstance, opts: Omit<AuditRecorderOptions, 'log'>) => {
    const recorder = new AuditRecorder({ ...opts, log: app.log.child({ component: 'audit' }) });
    app.decorate('audit', recorder);
    app.decorateRequest('auditView', null);
    app.addHook('onResponse', async (req, reply) => {
      if (req.auditView && req.actor && reply.statusCode < 400) {
        recorder.scheduleView(req.actor, auditMeta(req), req.auditView);
      }
    });
    app.addHook('onClose', async () => recorder.flush());
  },
  { name: 'audit', dependencies: ['auth'] },
);
