import {
  PRICING_PROBLEM_CODES,
  type CapitalReadinessBody,
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
  insertActivityEvent,
  listActiveUsersWithRoles,
  listHoldsForQuotes,
  listPricingQueueRows,
  listUsersByIds,
  loadQuoteState,
  loadWorkflowConfigInput,
  upsertPricingRecord,
  type PricingQueueRow,
  type Quote,
} from '@ccq/db/repos';
import {
  EMPTY_PRICING_RECORD,
  FLAGGED_G2_OUTCOMES,
  PRICING_QUEUE_STAGE_KEY,
  asUserId,
  can,
  canEditQuoting,
  computeTimeInStage,
  filterPricingQueue,
  parseWorkflowConfig,
  planCapitalReadiness,
  planPricingRecord,
  priceApprovalStatus,
  redact,
  sortPricingQueue,
  type Actor,
  type DomainError,
  type PricingQueueEntry,
  type PricingRecordPlan,
  type PricingRecordValues,
  type QuoteState,
  type WorkflowConfig,
} from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

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
  erfRefs: 'ERF references',
  bprRefs: 'BPR references',
  noPricingAppRecordNote: 'no pricing-app record note',
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
          searchText: [
            q.quoteNumber,
            q.sfOpportunityId,
            row.customerName,
            row.opportunityName,
            row.kamName,
            row.assignedEngineerName,
            ...(values?.erfRefs ?? []),
            ...(values?.bprRefs ?? []),
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
        g2Outcomes: workflow.outcomes
          .filter((o) => o.gateKey === 'G2')
          .map((o) => ({ key: o.key, label: o.label })),
        // Belt and braces: everyone on this route reads commercial fields, but redact anyway.
        items: filtered.map((e) => redact(e.item, actor)),
      };
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
          bprRefs: body.bprRefs,
          noPricingAppRecordNote: body.noPricingAppRecordNote,
          costingCompleted: body.costingCompleted,
        },
        { formats, pricingUserIds: new Set(team.map((u) => u.id)), now },
      );
      if (!plan.ok) fail(plan.errors);
      await this.apply(tx, actor, meta, loaded, plan, now);
      return this.detail(tx, actor, quoteNumber);
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
