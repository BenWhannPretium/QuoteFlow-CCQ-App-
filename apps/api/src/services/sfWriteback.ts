import type {
  SfWritebackPreview,
  SfWritebackRow,
  SfWritebackSummary,
  SfWritebackSwitchBody,
} from '@ccq/contracts';
import { schema, type Tx } from '@ccq/db';
import {
  findSettingByKey,
  getQuoteByNumber,
  loadWorkflowConfigInput,
  updateVersioned,
} from '@ccq/db/repos';
import {
  CUSTOMER_DECISION_STAGE_KEY,
  parseSfWritebackMap,
  parseWorkflowConfig,
  planDecisionWrites,
  planRequoteWrite,
  type Actor,
  type PlannedSfWrite,
  type SfWriteAllowList,
  type SfWritebackMode,
  type SfWritebackSkipReason,
  type SfWritebackStatus,
} from '@ccq/domain';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { ServiceProblem } from './problem';
import {
  SF_WRITEBACK_SETTING_KEYS,
  getOutboxRow,
  insertOutboxRow,
  lastClosingWritten,
  latestDecisionId,
  listOutbox,
  loadWritebackSettings,
  otherActiveOnOpportunity,
  outboxCounts,
  pendingClosingRows,
  updateOutboxRow,
  type LoadedWritebackSettings,
  type OutboxRow,
} from './sfWritebackStore';
import { recordAudit, type AuditMeta } from '../plugins/audit';

/**
 * FB-29 (N19-01, N19-02; D-16w, F-035): the Salesforce write-back.
 *
 * Writes are QUEUED in the transaction of the QuoteFlow change that causes them (a gate decision, a linked
 * re-quote) and SENT later by the worker (`jobs/sfWriteback.ts`). Nothing in a quote's workflow waits for
 * Salesforce, and nothing here may abort the user's change: every check runs before the insert, the insert
 * ignores a repeated dedupe key, and the whole enqueue runs in a savepoint, so even an unexpected database
 * error rolls back only the write-back (a failed statement would otherwise leave the decision's transaction
 * aborted, 25P02, even when caught). A skip is logged and audited.
 *
 * Switched off (`sf_writeback_enabled` false) nothing is queued. In `dry_run` the row is recorded as
 * `dry_run` and never sent. Live sending also needs this environment's write connection (`SF_WRITE_MODE`).
 */

type SystemTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
export type SfWritebackWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export interface SfWritebackServiceOptions {
  /** The writer's allow-list (`writeMap.ts`): every configured field must be on it. */
  allowList: SfWriteAllowList;
  /** `SF_WRITE_MODE` and why live is not allowed here (null when it is). */
  writerMode: 'off' | 'fake' | 'live';
  liveBlockedReason: string | null;
  /** For `quote_url` values: APP_BASE_URL. */
  appBaseUrl: string;
  /**
   * A read in the system context, on its own pool (committed data only): the other quotes and re-quote
   * drafts on an opportunity that the deciding user's row-level security may hide.
   */
  systemTx?: SystemTx;
  log?: FastifyBaseLogger;
  now?: () => Date;
}

export interface DecisionWriteContext {
  quote: { id: string; quoteNumber: string; sfOpportunityId: string };
  gateKey: string;
  gateStageKey: string;
  outcomeKey: string;
  enteredStageKey: string | null;
  actor: Actor;
  meta: AuditMeta;
  at: Date;
}

export interface RequoteWriteContext {
  quote: { id: string; quoteNumber: string; sfOpportunityId: string };
  draftId: string;
  actor: Actor;
  meta: AuditMeta;
  at: Date;
}

const ROWS_SHOWN = 50;
const DAY_MS = 86_400_000;

export function outboxRowDto(r: OutboxRow, quoteNumber: string): SfWritebackRow {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    id: r.id,
    quoteNumber,
    sfOpportunityId: r.sfOpportunityId,
    event: r.event as SfWritebackRow['event'],
    sfObject: r.sfObject,
    sfField: r.sfField,
    value: r.value,
    payload: r.payload,
    status: r.status as SfWritebackStatus,
    skippedReason: (r.skippedReason as SfWritebackSkipReason | null) ?? null,
    closing: r.closing,
    reopens: r.reopens,
    attempts: r.attempts,
    createdAt: r.createdAt.toISOString(),
    nextAttemptAt: iso(r.nextAttemptAt),
    sentAt: iso(r.sentAt),
    failedAt: iso(r.failedAt),
    lastError: r.lastError,
    response: r.response,
  };
}

export class SfWritebackService {
  private readonly now: () => Date;

  constructor(private readonly opts: SfWritebackServiceOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  get writerMode() {
    return this.opts.writerMode;
  }

  /**
   * Why `mode` cannot be live here, or null. Live needs a write connection (`SF_WRITE_MODE` fake or live;
   * the boot guards refused one this environment may not use).
   */
  liveBlockedReason(): string | null {
    return this.opts.liveBlockedReason;
  }

  /**
   * The admin console's extra check for the write-back keys (the settings screen saves them too): live
   * only where allowed, and the map against the writer's allow-list. Null when the value may be saved.
   */
  settingProblem(key: string, value: unknown): string | null {
    if (key === SF_WRITEBACK_SETTING_KEYS.mode && value === 'live') return this.liveBlockedReason();
    if (key === SF_WRITEBACK_SETTING_KEYS.map && value !== undefined && value !== null) {
      try {
        parseSfWritebackMap(value, this.opts.allowList);
      } catch (err) {
        return err instanceof Error ? err.message : 'sf_writeback_map is invalid';
      }
    }
    return null;
  }

  private quoteUrl(quoteNumber: string): string {
    return `${this.opts.appBaseUrl.replace(/\/+$/, '')}/quotes/${encodeURIComponent(quoteNumber)}`;
  }

  /** Whether another quote or an open re-quote draft needs the opportunity (in-transaction, then system). */
  private async otherActive(tx: Tx, sfOpportunityId: string, quoteId: string): Promise<boolean> {
    if (await otherActiveOnOpportunity(tx, sfOpportunityId, quoteId)) return true;
    if (!this.opts.systemTx) return false;
    return this.opts.systemTx((sys) => otherActiveOnOpportunity(sys, sfOpportunityId, quoteId));
  }

  /** Run the enqueue in a savepoint; any error is logged and audited, never thrown into the user's change. */
  private async guarded(
    tx: Tx,
    ctx: { quoteId: string; actor: Actor; meta: AuditMeta; at: Date; event: string },
    fn: (sp: Tx) => Promise<void>,
  ): Promise<void> {
    try {
      await tx.transaction(fn);
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      this.opts.log?.error(
        {
          quoteId: ctx.quoteId,
          event: ctx.event,
          code: typeof code === 'string' ? code : 'unknown',
        },
        'salesforce write-back: could not queue the write (the change itself is saved)',
      );
      await this.skipAudit(tx, ctx, 'error', 'could not queue the write; see the application log');
    }
  }

  private skipAudit(
    tx: Tx,
    ctx: { quoteId: string; actor: Actor; meta: AuditMeta; at: Date; event: string },
    reason: string,
    detail: string,
  ) {
    return recordAudit(tx, ctx.actor, ctx.meta, {
      action: 'create',
      entity: 'sf_writeback',
      entityId: null,
      quoteId: ctx.quoteId,
      after: { event: ctx.event, queued: false, reason, detail },
      at: ctx.at,
    });
  }

  /** Insert one planned write as pending, dry_run or skipped (other_active_quote), and audit it. */
  private async enqueue(
    tx: Tx,
    ctx: {
      quote: { id: string; sfOpportunityId: string };
      actor: Actor;
      meta: AuditMeta;
      at: Date;
    },
    write: PlannedSfWrite,
    mode: SfWritebackMode,
    skippedReason: SfWritebackSkipReason | null,
  ): Promise<string | null> {
    const status: SfWritebackStatus = skippedReason
      ? 'skipped'
      : mode === 'dry_run'
        ? 'dry_run'
        : 'pending';
    const id = await insertOutboxRow(tx, {
      quoteId: ctx.quote.id,
      sfOpportunityId: ctx.quote.sfOpportunityId,
      event: write.event,
      sfObject: write.sfObject,
      sfField: write.sfField,
      value: write.value,
      payload: write.payload,
      dedupeKey: write.dedupeKey,
      status,
      closing: write.closing,
      reopens: write.reopens,
      nextAttemptAt: status === 'pending' ? ctx.at : null,
      skippedReason,
      createdAt: ctx.at,
      updatedAt: ctx.at,
      createdBy: ctx.actor.userId,
    });
    if (!id) return null; // the same event again: one row
    await recordAudit(tx, ctx.actor, ctx.meta, {
      action: 'create',
      entity: 'sf_writeback',
      entityId: id,
      quoteId: ctx.quote.id,
      after: {
        event: write.event,
        sfObject: write.sfObject,
        sfField: write.sfField,
        value: write.value,
        sfOpportunityId: ctx.quote.sfOpportunityId,
        status,
        mode,
        closing: write.closing,
        reopens: write.reopens,
        ...(skippedReason ? { skippedReason } : {}),
      },
      at: ctx.at,
    });
    return id;
  }

  /**
   * Called by `GateService.decide` inside the decision's transaction, after the notifications. Queues the
   * writes the map asks for (only while switched on). Never throws.
   */
  async onGateDecision(tx: Tx, ctx: DecisionWriteContext): Promise<void> {
    const audit = { quoteId: ctx.quote.id, actor: ctx.actor, meta: ctx.meta, at: ctx.at };
    await this.guarded(tx, { ...audit, event: `gate:${ctx.gateKey}` }, async (sp) => {
      const loaded = await loadWritebackSettings(sp, this.opts.allowList);
      if (!loaded.enabled) return;
      if (!loaded.settings || loaded.error) {
        this.opts.log?.warn(
          { quoteId: ctx.quote.id, gateKey: ctx.gateKey },
          'salesforce write-back: settings invalid; nothing queued',
        );
        await this.skipAudit(
          sp,
          { ...audit, event: `gate:${ctx.gateKey}` },
          'invalid_config',
          loaded.error ?? 'invalid settings',
        );
        return;
      }
      const decisionId = await latestDecisionId(sp, ctx.quote.id);
      if (!decisionId) return;
      const writes = planDecisionWrites({
        map: loaded.settings.map,
        outcomeNames: loaded.outcomeNames,
        subject: {
          quoteId: ctx.quote.id,
          quoteNumber: ctx.quote.quoteNumber,
          sfOpportunityId: ctx.quote.sfOpportunityId,
          quoteUrl: this.quoteUrl(ctx.quote.quoteNumber),
        },
        gateStageKey: ctx.gateStageKey,
        outcomeKey: ctx.outcomeKey,
        enteredStageKey: ctx.enteredStageKey,
        decisionId,
      });
      for (const write of writes) {
        // Never close an opportunity another quote (or an open re-quote) still needs.
        const blocked =
          write.closing && (await this.otherActive(sp, ctx.quote.sfOpportunityId, ctx.quote.id));
        await this.enqueue(
          sp,
          ctx,
          write,
          loaded.settings.mode,
          blocked ? 'other_active_quote' : null,
        );
      }
    });
  }

  /**
   * Called where a linked re-quote draft is created (`RequoteService.start`), in its transaction. A
   * pending closing write for the opportunity is superseded (skipped: the opportunity is needed again);
   * the reopen is queued only when QuoteFlow's last stage write to the opportunity closed it, and the
   * worker sends it only if Salesforce still holds that closed stage. Never throws.
   */
  async onRequoteStarted(tx: Tx, ctx: RequoteWriteContext): Promise<void> {
    const audit = { quoteId: ctx.quote.id, actor: ctx.actor, meta: ctx.meta, at: ctx.at };
    await this.guarded(tx, { ...audit, event: 'requote_started' }, async (sp) => {
      const loaded = await loadWritebackSettings(sp, this.opts.allowList);
      if (!loaded.enabled) return;
      if (!loaded.settings || loaded.error) {
        await this.skipAudit(
          sp,
          { ...audit, event: 'requote_started' },
          'invalid_config',
          loaded.error ?? 'invalid settings',
        );
        return;
      }
      // 1. A closing write still waiting is superseded: the opportunity is needed again.
      for (const row of await pendingClosingRows(sp, ctx.quote.sfOpportunityId)) {
        await updateOutboxRow(
          sp,
          row.id,
          { status: 'skipped', skippedReason: 'other_active_quote', nextAttemptAt: null },
          ctx.at,
        );
        await recordAudit(sp, ctx.actor, ctx.meta, {
          action: 'update',
          entity: 'sf_writeback',
          entityId: row.id,
          quoteId: row.quoteId,
          before: { status: 'pending' },
          after: {
            status: 'skipped',
            skippedReason: 'other_active_quote',
            supersededBy: 'requote_started',
            draftId: ctx.draftId,
            sfField: row.sfField,
            value: row.value,
          },
          at: ctx.at,
        });
      }
      // 2. The reopen, over a close QuoteFlow wrote (dry run: over the close it recorded).
      const write = planRequoteWrite({
        map: loaded.settings.map,
        outcomeNames: loaded.outcomeNames,
        subject: {
          quoteId: ctx.quote.id,
          quoteNumber: ctx.quote.quoteNumber,
          sfOpportunityId: ctx.quote.sfOpportunityId,
          quoteUrl: this.quoteUrl(ctx.quote.quoteNumber),
        },
        draftId: ctx.draftId,
      });
      if (!write) return;
      const mode = loaded.settings.mode;
      const closed = await lastClosingWritten(
        sp,
        ctx.quote.sfOpportunityId,
        mode === 'dry_run' ? ['sent', 'dry_run'] : ['sent'],
      );
      await this.enqueue(sp, ctx, write, mode, closed === null ? 'nothing_to_reopen' : null);
    });
  }

  // ── Admin → Integrations ────────────────────────────────────────────────────────────────────

  private statusText(loaded: LoadedWritebackSettings, mode: SfWritebackMode): string {
    if (!loaded.enabled) {
      return 'Write-back is switched off: QuoteFlow writes nothing to Salesforce, and KAMs are reminded to update the opportunity by hand.';
    }
    if (!loaded.settings || loaded.error) {
      return `Write-back is switched on but its settings are invalid, so nothing is queued: ${loaded.error ?? 'invalid settings'}`;
    }
    if (mode === 'dry_run') {
      return 'Dry run: QuoteFlow records below what it would send, and sends nothing.';
    }
    if (this.opts.writerMode === 'off') {
      return `Live is set, but nothing is sent: ${this.opts.liveBlockedReason ?? 'no write connection'}`;
    }
    return this.opts.writerMode === 'fake'
      ? 'Live, through the fake writer of this environment: nothing reaches a real Salesforce org.'
      : 'Live: QuoteFlow sends the writes below to Salesforce.';
  }

  async summary(withTx: SfWritebackWithTx, actor: Actor): Promise<SfWritebackSummary> {
    const at = this.now();
    return withTx(async (tx) => {
      const loaded = await loadWritebackSettings(tx, this.opts.allowList);
      const [mode, rows, counts] = await Promise.all([
        findSettingByKey(tx, SF_WRITEBACK_SETTING_KEYS.mode),
        listOutbox(tx, ROWS_SHOWN),
        outboxCounts(tx, new Date(at.getTime() - DAY_MS)),
      ]);
      const currentMode: SfWritebackMode = mode?.value === 'live' ? 'live' : 'dry_run';
      return {
        enabled: loaded.enabled,
        mode: currentMode,
        writerMode: this.opts.writerMode,
        liveAllowed: this.opts.liveBlockedReason === null,
        liveBlockedReason: this.opts.liveBlockedReason,
        sending:
          loaded.enabled &&
          !!loaded.settings &&
          !loaded.error &&
          currentMode === 'live' &&
          this.opts.writerMode !== 'off',
        statusText: this.statusText(loaded, currentMode),
        settingsError: loaded.error,
        provisional: true,
        counts,
        rows: rows.map((r) => outboxRowDto(r.row, r.quoteNumber)),
        canManage: actor.roles.includes('Admin'),
      };
    });
  }

  /** The switch and the mode (Admin). Live is refused here with the reason when it is not allowed. */
  async setSwitch(
    withTx: SfWritebackWithTx,
    actor: Actor,
    meta: AuditMeta,
    body: SfWritebackSwitchBody,
  ): Promise<SfWritebackSummary> {
    if (body.mode === 'live' && this.opts.liveBlockedReason) {
      throw new ServiceProblem(422, 'live_not_allowed', this.opts.liveBlockedReason);
    }
    const at = this.now();
    await withTx(async (tx) => {
      const changes: [key: string, value: unknown][] = [];
      if (body.enabled !== undefined)
        changes.push([SF_WRITEBACK_SETTING_KEYS.enabled, body.enabled]);
      if (body.mode !== undefined) changes.push([SF_WRITEBACK_SETTING_KEYS.mode, body.mode]);
      for (const [key, value] of changes) {
        const before = await findSettingByKey(tx, key);
        if (!before) {
          throw new ServiceProblem(404, 'not_found', `The setting ${key} does not exist yet`);
        }
        if (before.value === value) continue;
        const result = await updateVersioned(tx, schema.appSetting, before.id, before.version, {
          value,
        });
        if (!result.ok) {
          throw new ServiceProblem(409, 'stale', `${key} was changed by someone else. Reload.`);
        }
        await recordAudit(tx, actor, meta, {
          action: 'config_change',
          entity: 'sf_writeback',
          entityId: before.id,
          before: { key, value: before.value ?? null },
          after: { key, value },
          changeReason: body.changeReason ?? null,
          at,
        });
      }
    });
    return this.summary(withTx, actor);
  }

  /** Retry a failed row (Admin): pending again, tries counted from zero. Audited. */
  async retry(
    withTx: SfWritebackWithTx,
    actor: Actor,
    meta: AuditMeta,
    id: string,
  ): Promise<SfWritebackRow> {
    return this.act(withTx, actor, meta, id, ['failed'], (at) => ({
      status: 'pending' as const,
      attempts: 0,
      nextAttemptAt: at,
      failedAt: null,
      skippedReason: null,
    }));
  }

  /** Skip a failed (or still pending) row (Admin): it will not be sent. Audited. */
  async skip(
    withTx: SfWritebackWithTx,
    actor: Actor,
    meta: AuditMeta,
    id: string,
  ): Promise<SfWritebackRow> {
    return this.act(withTx, actor, meta, id, ['failed', 'pending'], () => ({
      status: 'skipped' as const,
      skippedReason: 'admin_skip' as const,
      nextAttemptAt: null,
    }));
  }

  private async act(
    withTx: SfWritebackWithTx,
    actor: Actor,
    meta: AuditMeta,
    id: string,
    from: readonly SfWritebackStatus[],
    patch: (at: Date) => Parameters<typeof updateOutboxRow>[2],
  ): Promise<SfWritebackRow> {
    const at = this.now();
    return withTx(async (tx) => {
      const [locked] = await tx
        .select()
        .from(schema.sfWritebackOutbox)
        .where(eq(schema.sfWritebackOutbox.id, id))
        .for('update');
      const row = locked ?? (await getOutboxRow(tx, id));
      if (!row) throw new ServiceProblem(404, 'not_found', 'No such write-back row');
      if (!from.includes(row.status as SfWritebackStatus)) {
        throw new ServiceProblem(
          409,
          'wrong_state',
          `This write is ${row.status}; only a ${from.join(' or ')} one can be changed here`,
        );
      }
      const fields = patch(at);
      const updated = (await updateOutboxRow(tx, row.id, fields, at))!;
      await recordAudit(tx, actor, meta, {
        action: 'update',
        entity: 'sf_writeback',
        entityId: row.id,
        quoteId: row.quoteId,
        before: { status: row.status, attempts: row.attempts, lastError: row.lastError },
        after: {
          status: updated.status,
          by: fields.status === 'pending' ? 'admin_retry' : 'admin_skip',
          sfField: row.sfField,
          value: row.value,
        },
        at,
      });
      const [q] = await tx
        .select({ quoteNumber: schema.quote.quoteNumber })
        .from(schema.quote)
        .where(eq(schema.quote.id, row.quoteId));
      return outboxRowDto(updated, q?.quoteNumber ?? '');
    });
  }

  /**
   * What the current map would send for a quote as it stands (its latest customer outcome and its stage),
   * without queuing anything. Works whether the switch is on or off.
   */
  async preview(withTx: SfWritebackWithTx, quoteNumber: string): Promise<SfWritebackPreview> {
    return withTx(async (tx) => {
      const q = await getQuoteByNumber(tx, quoteNumber);
      if (!q) throw new ServiceProblem(404, 'not_found', `No quote ${quoteNumber}`);
      const loaded = await loadWritebackSettings(tx, this.opts.allowList);
      const notes: string[] = [];
      if (!loaded.settings || loaded.error) {
        return {
          quoteNumber,
          sfOpportunityId: q.sfOpportunityId,
          enabled: loaded.enabled,
          mode: 'dry_run',
          writes: [],
          notes: [`The write-back settings are invalid: ${loaded.error ?? 'invalid settings'}`],
        };
      }
      const workflow = parseWorkflowConfig(await loadWorkflowConfigInput(tx));
      const customerGates = workflow.gates
        .filter((g) => g.stageKey === CUSTOMER_DECISION_STAGE_KEY)
        .map((g) => g.key);
      const [latestOutcome] = customerGates.length
        ? await tx
            .select({ id: schema.gateDecision.id, outcomeKey: schema.gateDecision.outcomeKey })
            .from(schema.gateDecision)
            .where(
              and(
                eq(schema.gateDecision.quoteId, q.id),
                inArray(schema.gateDecision.gateKey, customerGates),
              ),
            )
            .orderBy(desc(schema.gateDecision.createdAt), desc(schema.gateDecision.id))
            .limit(1)
        : [];
      const subject = {
        quoteId: q.id,
        quoteNumber,
        sfOpportunityId: q.sfOpportunityId,
        quoteUrl: this.quoteUrl(quoteNumber),
      };
      const writes = planDecisionWrites({
        map: loaded.settings.map,
        outcomeNames: loaded.outcomeNames,
        subject,
        gateStageKey: latestOutcome ? CUSTOMER_DECISION_STAGE_KEY : q.stageKey,
        outcomeKey: latestOutcome?.outcomeKey ?? '',
        enteredStageKey: q.stageKey,
        decisionId: latestOutcome?.id ?? 'preview',
      });
      if (!latestOutcome) notes.push('No customer outcome is recorded on this quote yet.');
      if (!loaded.enabled) notes.push('Write-back is switched off: nothing would be queued now.');
      const out = [];
      for (const w of writes) {
        const blocked = w.closing && (await this.otherActive(tx, q.sfOpportunityId, q.id));
        out.push({
          event: w.event,
          sfObject: w.sfObject,
          sfField: w.sfField,
          value: w.value,
          closing: w.closing,
          reopens: w.reopens,
          payload: w.payload,
          note: blocked
            ? 'Another quote or an open re-quote needs this opportunity: this closing write would be skipped.'
            : null,
        });
      }
      if (writes.length === 0) {
        notes.push('The current map writes nothing for this quote as it stands.');
      }
      return {
        quoteNumber,
        sfOpportunityId: q.sfOpportunityId,
        enabled: loaded.enabled,
        mode: loaded.settings.mode,
        writes: out,
        notes,
      };
    });
  }
}
