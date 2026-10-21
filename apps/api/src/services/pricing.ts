import {
  PRICING_PROBLEM_CODES,
  type BulkReassignBody,
  type BulkReassignResponse,
  type CapitalReadinessBody,
  type PricerAssignmentResponse,
  type PricingQueueFilters,
  type PricingQueueItem,
  type PricingQueueResponse,
  type PricingRecordBody,
  type QuotingDetail,
} from '@ccq/contracts';
import type { Tx } from '@ccq/db';
import {
  getPricingRecord,
  getQuoteByNumber,
  getUserWithRoles,
  insertActivityEvent,
  listActiveUsersWithRoles,
  listHoldsForQuotes,
  listPricingQueueRows,
  listUsersByIds,
  loadQuoteState,
  loadWorkflowConfigInput,
  updateQuote,
  upsertPricingRecord,
  type PricingQueueRow,
  type Quote,
} from '@ccq/db/repos';
import {
  EMPTY_PRICING_RECORD,
  FLAGGED_G2_OUTCOMES,
  PRICING_ASSIGNABLE_ROLES,
  PRICING_QUEUE_STAGE_KEY,
  asUserId,
  can,
  canEditQuoting,
  computeTimeInStage,
  filterPricingQueue,
  parseWorkflowConfig,
  planCapitalReadiness,
  planPricerAssignment,
  planPricingRecord,
  priceApprovalStatus,
  redact,
  sortPricingQueue,
  type Actor,
  DomainError as DomainErrorClass,
  type DomainError,
  type PricingQueueEntry,
  type PricingRecordPlan,
  type PricingRecordValues,
  type QuoteState,
  type Role,
  type WorkflowConfig,
} from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

import { persistNotifications } from './notificationService';
import {
  loadPricingRefFormats,
  pricingRoles,
  quotingView,
  recordColumns,
  recordValues,
} from './pricing-view';
import { ServiceProblem, problemErrors } from './problem';
import { summaryDto, type QuoteReadService } from './quotes';
import { recordAudit, type AuditMeta } from '../plugins/audit';

export type PricingWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

/** A failure the route turns into problem+json (via `handleProblems`). */
export class PricingError extends ServiceProblem {
  override name = 'PricingError';
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const CONFLICT_CODES = new Set(['WRONG_STAGE', 'QUOTE_CLOSED']);

/** Domain errors → 403 (not permitted), 409 (wrong state) or 422 (bad input, every error listed). */
function fail(errors: readonly DomainError[]): never {
  const forbidden = errors.filter((e) => e.code === 'NOT_PERMITTED');
  if (forbidden.length > 0) {
    throw new PricingError(
      403,
      PRICING_PROBLEM_CODES.notPermitted,
      forbidden.map((e) => e.message).join('; '),
    );
  }
  const conflict = errors.find((e) => CONFLICT_CODES.has(e.code));
  if (conflict) throw new PricingError(409, PRICING_PROBLEM_CODES.conflict, conflict.message);
  throw new PricingError(422, PRICING_PROBLEM_CODES.rejected, 'The change was not accepted', {
    errors: problemErrors(errors),
  });
}

export interface PricingServiceOptions {
  quotes: QuoteReadService;
  log?: FastifyBaseLogger;
  now?: () => Date;
}

/** "Product summary" for the queue: the standard description, else the free text, truncated. */
function productSummary(q: Quote): string | null {
  const structured = (q.structuredDescription ?? {}) as { standard?: string | null };
  const text = structured.standard?.trim() || q.description?.trim() || null;
  return text && text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

/** The record's fields named on the timeline. Names only: timeline payloads go to every reader. */
const TIMELINE_FIELDS: Record<keyof PricingRecordValues, string | null> = {
  priceApprovedBy: 'approver',
  priceApprovedAt: 'approval time',
  pricingBasisNote: 'pricing basis',
  approvedRangeNote: 'approved range',
  erfRefs: 'legacy ERF numbers',
  costingCompleted: 'costing attestation',
  costingAttestedBy: null,
  costingAttestedAt: null,
  capitalReadiness: 'capital readiness',
  cerReference: 'CER reference',
  capitalNotes: 'capital notes',
  capitalPendingJustification: 'pending-capital justification',
};

/**
 * B-11 pricing queue and the Quoting tab (CR-25/26, DEC-19/20/23). The rules are the domain's
 * (`pricing/`): who edits, the approver and reference checks, capital readiness after a G2
 * "Capital required". G3 itself goes through the generic gate route. No price figure is ever stored.
 */
export class PricingService {
  private readonly now: () => Date;

  constructor(private readonly opts: PricingServiceOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  /** GET /queue/pricing: every open quote in Quoting (in scope, RLS), ordered and filtered. */
  async queue(
    withTx: PricingWithTx,
    actor: Actor,
    query: PricingQueueFilters,
  ): Promise<PricingQueueResponse> {
    const now = this.now();
    return withTx(async (tx) => {
      const [ctx, workflow] = await Promise.all([
        this.opts.quotes.context(tx, actor, now),
        loadWorkflowConfigInput(tx).then(parseWorkflowConfig),
      ]);
      const tierOrder = [...(ctx.model?.tiers ?? [])]
        .sort((a, b) => b.min - a.min)
        .map((t) => t.key);
      const rows = await listPricingQueueRows(tx, PRICING_QUEUE_STAGE_KEY);
      const holds = await listHoldsForQuotes(
        tx,
        rows.map((r) => r.quote.id),
      );
      // B-26: who each quote is assigned to (the pricing lead triages the queue).
      const pricerIds = [
        ...new Set(rows.map((r) => r.quote.assignedPricerId).filter((id): id is string => !!id)),
      ];
      const pricerNames = new Map(
        (await listUsersByIds(tx, pricerIds)).map((u) => [u.id, u.displayName]),
      );
      const canAssign = can(actor, 'pricingQueue.assign');
      const g2Label = (key: string | null) =>
        key
          ? (workflow.outcomes.find((o) => o.gateKey === 'G2' && o.key === key)?.label ?? key)
          : null;

      const all = rows.map((row: PricingQueueRow) => {
        const q = row.quote;
        const summary = summaryDto(row, ctx);
        const entered = row.enteredStageAt ?? q.updatedAt;
        const [stay] = computeTimeInStage(
          [{ stageKey: q.stageKey, enteredAt: entered, exitedAt: null }],
          holds.filter((h) => h.quoteId === q.id),
          now,
        );
        const values = recordValues(row.pricing);
        const status = priceApprovalStatus(values);
        const state = {
          stageKey: q.stageKey,
          status: q.status as QuoteState['status'],
          kamUserId: asUserId(q.kamUserId),
          assignedEngineerId: q.assignedEngineerId ? asUserId(q.assignedEngineerId) : null,
          ...(q.region ? { region: q.region } : {}),
        };
        const item: PricingQueueItem = {
          ...summary,
          enteredStageAt: iso(entered),
          activeMsInStage: stay?.activeMs ?? 0,
          productSummary: productSummary(q),
          g2Outcome: row.g2Outcome,
          g2OutcomeLabel: g2Label(row.g2Outcome),
          g2Flag: (FLAGGED_G2_OUTCOMES as readonly string[]).includes(row.g2Outcome ?? ''),
          capitalReadiness: values?.capitalReadiness ?? null,
          priceApproved: status.approved,
          priceApprovedAt: iso(status.approvedAt),
          assignedEngineerId: q.assignedEngineerId,
          assignedEngineerName: row.assignedEngineerName ?? null,
          assignedPricerId: q.assignedPricerId,
          assignedPricerName: q.assignedPricerId
            ? (pricerNames.get(q.assignedPricerId) ?? null)
            : null,
          pricerAssignedAt: iso(q.pricerAssignedAt),
          canEdit: canEditQuoting(actor, state),
        };
        const entry: PricingQueueEntry = {
          quoteNumber: q.quoteNumber,
          tier: summary.priority.tier,
          score: summary.priority.score,
          activeMsInStage: item.activeMsInStage,
          g2Outcome: row.g2Outcome,
          capitalReadiness: item.capitalReadiness ?? null,
          priceApproved: status.approved,
          productFamily: q.productFamily,
          kamUserId: q.kamUserId,
          assignedPricerId: q.assignedPricerId,
          searchText: [
            q.quoteNumber,
            q.sfOpportunityId,
            row.customerName,
            row.opportunityName,
            row.kamName,
            row.assignedEngineerName,
            item.assignedPricerName,
            ...(values?.erfRefs ?? []),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase(),
        };
        return { ...entry, item };
      });

      const sorted = sortPricingQueue(all, tierOrder);
      const filtered = filterPricingQueue(sorted, {
        ...(query.tier ? { tiers: query.tier } : {}),
        ...(query.g2 ? { g2Outcomes: query.g2 } : {}),
        ...(query.capital ? { capitalReadiness: query.capital } : {}),
        ...(query.approved ? { priceApproved: query.approved === 'yes' } : {}),
        ...(query.productFamily ? { productFamilies: query.productFamily } : {}),
        ...(query.kam ? { kamUserId: query.kam === 'me' ? actor.userId : query.kam } : {}),
        ...(query.pricer ? { pricerId: query.pricer === 'me' ? actor.userId : query.pricer } : {}),
        ...(query.q ? { q: query.q } : {}),
      });

      return {
        stage: {
          key: PRICING_QUEUE_STAGE_KEY,
          label:
            workflow.stages.find((s) => s.key === PRICING_QUEUE_STAGE_KEY)?.label ??
            PRICING_QUEUE_STAGE_KEY,
        },
        total: all.length,
        counts: {
          awaitingApproval: all.filter((e) => !e.priceApproved).length,
          capitalPending: all.filter((e) => e.capitalReadiness === 'pending').length,
          flagged: all.filter((e) => e.item.g2Flag).length,
        },
        canEdit: can(actor, 'quoting.edit'),
        canDecide: can(actor, 'gate.G3.submit'),
        canAssign,
        pricers: canAssign
          ? (await listActiveUsersWithRoles(tx, PRICING_ASSIGNABLE_ROLES)).map((u) => ({
              ...u,
              openAssigned: all.filter((e) => e.assignedPricerId === u.id).length,
            }))
          : [],
        g2Outcomes: workflow.outcomes
          .filter((o) => o.gateKey === 'G2')
          .map((o) => ({ key: o.key, label: o.label })),
        // Belt and braces: everyone on this route reads commercial fields, but redact anyway.
        items: filtered.map((e) => redact(e.item, actor)),
      };
    });
  }

  /**
   * B-26: POST /quotes/:qn/pricing-assignment. The pricing lead (or Admin) assigns the Quoting work to a
   * pricer; recorded on the timeline, audited, and the pricer is told (in-app + email).
   */
  async assignPricer(
    withTx: PricingWithTx,
    actor: Actor,
    quoteNumber: string,
    pricerId: string,
    meta: AuditMeta,
  ): Promise<PricerAssignmentResponse> {
    const now = this.now();
    return withTx(async (tx) => {
      const q = await getQuoteByNumber(tx, quoteNumber);
      if (!q)
        throw new PricingError(404, PRICING_PROBLEM_CODES.notFound, `No quote ${quoteNumber}`);
      return this.assignOne(tx, actor, q, pricerId, meta, now);
    });
  }

  private async assignOne(
    tx: Tx,
    actor: Actor,
    q: Quote,
    pricerId: string,
    meta: AuditMeta,
    now: Date,
  ): Promise<PricerAssignmentResponse> {
    const state = (await loadQuoteState(tx, q.id))!;
    const user = await getUserWithRoles(tx, pricerId);
    const plan = planPricerAssignment(
      actor,
      { ...state, assignedPricerId: q.assignedPricerId },
      user ? { id: user.id, roles: user.roles as Role[], active: user.active } : undefined,
    );
    if (!plan.ok) fail(plan.errors);
    if (!plan.changed) {
      return {
        quoteNumber: q.quoteNumber,
        assignedPricerId: plan.to,
        assignedPricerName: user!.displayName,
        pricerAssignedAt: iso(q.pricerAssignedAt),
        changed: false,
      };
    }
    const names = await listUsersByIds(
      tx,
      [plan.from, plan.to].filter((x): x is string => !!x),
    );
    const nameOf = (id: string | null) => names.find((u) => u.id === id)?.displayName ?? null;
    await updateQuote(tx, q.id, { assignedPricerId: plan.to, pricerAssignedAt: now });
    await insertActivityEvent(tx, {
      quoteId: q.id,
      type: 'pricer_assigned',
      actorId: actor.userId,
      at: now,
      payload: {
        from: plan.from,
        fromName: nameOf(plan.from),
        to: plan.to,
        toName: nameOf(plan.to),
      },
      createdBy: actor.userId,
    });
    await recordAudit(tx, actor, meta, {
      action: 'update',
      entity: 'quote',
      entityId: q.id,
      quoteId: q.id,
      before: { assignedPricerId: plan.from, pricerAssignedAt: iso(q.pricerAssignedAt) },
      after: { assignedPricerId: plan.to, pricerAssignedAt: now.toISOString() },
      at: now,
    });
    await persistNotifications(
      tx,
      [{ type: 'quote.pricing_assigned', recipient: { kind: 'user', userId: asUserId(plan.to) } }],
      {
        quoteId: q.id,
        title: `${q.quoteNumber} is assigned to you for pricing`,
        body: plan.from
          ? 'The Quoting work was reassigned to you.'
          : 'You have a new quote to price. Open the pricing queue.',
        excludeUserId: actor.userId,
        payload: { reassigned: plan.from ? 'yes' : 'no' },
      },
      this.opts.log,
    );
    return {
      quoteNumber: q.quoteNumber,
      assignedPricerId: plan.to,
      assignedPricerName: nameOf(plan.to),
      pricerAssignedAt: now.toISOString(),
      changed: true,
    };
  }

  /**
   * B-26: POST /queue/pricing/reassign. Move a pricer's open Quoting work (all of it, or the listed
   * quotes) to another pricer in one transaction: each move is recorded, audited and announced like a
   * single assignment. Listed quotes not in Quoting or not assigned to `fromUserId` are skipped.
   */
  async bulkReassign(
    withTx: PricingWithTx,
    actor: Actor,
    body: BulkReassignBody,
    meta: AuditMeta,
  ): Promise<BulkReassignResponse> {
    const now = this.now();
    return withTx(async (tx) => {
      if (!can(actor, 'pricingQueue.assign')) {
        fail([new DomainErrorClass('NOT_PERMITTED', 'Requires pricingQueue.assign')]);
      }
      const rows = await listPricingQueueRows(tx, PRICING_QUEUE_STAGE_KEY);
      const held = rows.filter((r) => r.quote.assignedPricerId === body.fromUserId);
      const wanted = body.quoteNumbers ? new Set(body.quoteNumbers) : null;
      const skipped: BulkReassignResponse['skipped'] = [];
      for (const n of wanted ?? []) {
        if (!held.some((r) => r.quote.quoteNumber === n)) {
          skipped.push({ quoteNumber: n, reason: 'Not in Quoting with this pricer' });
        }
      }
      const reassigned: string[] = [];
      for (const row of held) {
        if (wanted && !wanted.has(row.quote.quoteNumber)) continue;
        const r = await this.assignOne(tx, actor, row.quote, body.toUserId, meta, now);
        if (r.changed) reassigned.push(r.quoteNumber);
      }
      const [to] = await listUsersByIds(tx, [body.toUserId]);
      return { reassigned, skipped, toUserName: to?.displayName ?? null };
    });
  }

  private async load(tx: Tx, quoteNumber: string) {
    const q = await getQuoteByNumber(tx, quoteNumber);
    if (!q) throw new PricingError(404, PRICING_PROBLEM_CODES.notFound, `No quote ${quoteNumber}`);
    const state = (await loadQuoteState(tx, q.id))!;
    const row = await getPricingRecord(tx, q.id);
    return { q, state, row, current: recordValues(row) ?? EMPTY_PRICING_RECORD };
  }

  private async detail(tx: Tx, actor: Actor, quoteNumber: string): Promise<QuotingDetail> {
    const q = (await getQuoteByNumber(tx, quoteNumber))!;
    const state = (await loadQuoteState(tx, q.id))!;
    const workflow: WorkflowConfig = parseWorkflowConfig(await loadWorkflowConfigInput(tx));
    return quotingView(tx, actor, workflow, q, state);
  }

  /** Persist a plan for the current version: row, timeline (field names only), audit (values). */
  private async apply(
    tx: Tx,
    actor: Actor,
    meta: AuditMeta,
    loaded: Awaited<ReturnType<PricingService['load']>>,
    plan: Extract<PricingRecordPlan, { ok: true }>,
    now: Date,
  ) {
    const { q, row, current } = loaded;
    if (plan.changed.length === 0) return;
    const saved = await upsertPricingRecord(tx, {
      ...recordColumns(plan.next),
      quoteId: q.id,
      quoteVersion: q.version,
      createdBy: row?.createdBy ?? actor.userId,
    });
    const before = priceApprovalStatus(current);
    const after = priceApprovalStatus(plan.next);
    const approvalChanged =
      before.approvedById !== after.approvedById ||
      before.approvedAt?.getTime() !== after.approvedAt?.getTime();
    const fields = [
      ...new Set(plan.changed.map((k) => TIMELINE_FIELDS[k]).filter((f): f is string => !!f)),
    ];
    if (approvalChanged && after.approved) {
      const [approver] = await listUsersByIds(tx, [after.approvedById!]);
      // The approval status is not commercial: every reader sees who approved and when.
      await insertActivityEvent(tx, {
        quoteId: q.id,
        type: 'price_approval_recorded',
        actorId: actor.userId,
        at: now,
        payload: {
          approvedByName: approver?.displayName ?? null,
          approvedAt: after.approvedAt!.toISOString(),
          quoteVersion: q.version,
        },
        createdBy: actor.userId,
      });
    } else if (approvalChanged) {
      await insertActivityEvent(tx, {
        quoteId: q.id,
        type: 'price_approval_cleared',
        actorId: actor.userId,
        at: now,
        payload: { quoteVersion: q.version },
        createdBy: actor.userId,
      });
    }
    const otherFields = fields.filter((f) => f !== 'approver' && f !== 'approval time');
    if (otherFields.length > 0) {
      await insertActivityEvent(tx, {
        quoteId: q.id,
        type: 'pricing_record_updated',
        actorId: actor.userId,
        at: now,
        payload: { fields: otherFields, quoteVersion: q.version },
        createdBy: actor.userId,
      });
    }
    const pick = (v: PricingRecordValues) =>
      Object.fromEntries(
        plan.changed.map((k) => [k, v[k] instanceof Date ? (v[k] as Date).toISOString() : v[k]]),
      );
    await recordAudit(tx, actor, meta, {
      action: 'update',
      entity: 'pricing_record',
      entityId: saved.id,
      quoteId: q.id,
      before: { quoteVersion: q.version, ...pick(current) },
      after: { quoteVersion: q.version, ...pick(plan.next) },
      at: now,
    });
  }

  /** PUT /quotes/:qn/pricing-record: the price approval record (only the keys sent change). */
  async updateRecord(
    withTx: PricingWithTx,
    actor: Actor,
    quoteNumber: string,
    body: PricingRecordBody,
    meta: AuditMeta,
  ): Promise<QuotingDetail> {
    const now = this.now();
    return withTx(async (tx) => {
      const loaded = await this.load(tx, quoteNumber);
      const [formats, team] = await Promise.all([
        loadPricingRefFormats(tx),
        listActiveUsersWithRoles(tx, pricingRoles()),
      ]);
      const plan = planPricingRecord(
        actor,
        loaded.state,
        loaded.current,
        {
          approvedBy: body.approvedBy,
          approvedAt:
            body.approvedAt === undefined
              ? undefined
              : body.approvedAt === null
                ? null
                : new Date(body.approvedAt),
          pricingBasisNote: body.pricingBasisNote,
          approvedRangeNote: body.approvedRangeNote,
          erfRefs: body.erfRefs,
          costingCompleted: body.costingCompleted,
        },
        { formats, pricingUserIds: new Set(team.map((u) => u.id)), now },
      );
      if (!plan.ok) fail(plan.errors);
      await this.apply(tx, actor, meta, loaded, plan, now);
      await this.linkErf(
        tx,
        actor,
        meta,
        loaded.q,
        plan.changed.includes('erfRefs') ? plan.next.erfRefs : [],
        now,
      );
      return this.detail(tx, actor, quoteNumber);
    });
  }

  /**
   * B-15 linkage: the first ERF reference recorded (typed, or picked with "Use as reference") becomes
   * `quote.erf_number` when the quote has none yet. An existing one is never overwritten; a
   * difference from the SF ERF number shows as a mismatch on the pricing context and the ERF linkage
   * report.
   */
  private async linkErf(
    tx: Tx,
    actor: Actor,
    meta: AuditMeta,
    q: Quote,
    erfRefs: readonly string[],
    now: Date,
  ) {
    const erfNumber = erfRefs[0]?.trim();
    if (q.erfNumber || !erfNumber) return;
    await updateQuote(tx, q.id, { erfNumber, updatedAt: now });
    await recordAudit(tx, actor, meta, {
      action: 'update',
      entity: 'quote',
      entityId: q.id,
      quoteId: q.id,
      before: { erfNumber: null },
      after: { erfNumber },
      at: now,
    });
  }

  /** PUT /quotes/:qn/capital-readiness: status, CER reference, notes, pending justification. */
  async updateCapital(
    withTx: PricingWithTx,
    actor: Actor,
    quoteNumber: string,
    body: CapitalReadinessBody,
    meta: AuditMeta,
  ): Promise<QuotingDetail> {
    const now = this.now();
    return withTx(async (tx) => {
      const loaded = await this.load(tx, quoteNumber);
      const plan = planCapitalReadiness(
        actor,
        loaded.state,
        loaded.current,
        body,
        (loaded.state.fields.g2_outcome as string | null | undefined) ?? null,
      );
      if (!plan.ok) fail(plan.errors);
      await this.apply(tx, actor, meta, loaded, plan, now);
      return this.detail(tx, actor, quoteNumber);
    });
  }
}
