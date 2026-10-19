import {
  ENGINEERING_PROBLEM_CODES,
  type AssignmentResponse,
  type CapacityEvidenceBody,
  type EngineeringDetail,
  type EngQueueFilters,
  type EngQueueItem,
  type EngQueueResponse,
  type EngReviewBody,
  type StageTimesResponse,
} from '@ccq/contracts';
import type { Tx } from '@ccq/db';
import {
  deleteCapacityEvidence,
  getEngReview,
  getQuoteByNumber,
  getUserWithRoles,
  insertActivityEvent,
  insertCapacityEvidence,
  listAssignableEngineers,
  listCapacityEvidence,
  listEngQueueRows,
  listHolds,
  listHoldsForQuotes,
  listStageHistory,
  listUsersByIds,
  listValueList,
  loadQuoteState,
  loadWorkflowConfigInput,
  resetEngReviewAcceptance,
  updateCapacityEvidence,
  updateQuote,
  upsertEngReview,
  type EngQueueRow,
  type Quote,
} from '@ccq/db/repos';
import {
  ASSIGNABLE_ROLES,
  ENG_QUEUE_STAGE_KEY,
  agingBucket,
  agingBucketLabels,
  asUserId,
  businessDaysBetween,
  can,
  canAssignEngQueue,
  canEditEngReview,
  computeTimeInStage,
  countByAgingBucket,
  engineeringCompleteness,
  filterEngQueue,
  holdsPermission,
  parseWorkflowConfig,
  planAccept,
  planAssignment,
  planCapacityEvidence,
  sortEngQueue,
  summarizeStageTimes,
  type Actor,
  type DomainError,
  type EngQueueEntry,
  type EngQueueSettings,
  type IntakeConfig,
  type QuoteState,
  type Role,
} from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

import { loadEngQueueSettings, engineeringView } from './engineering-view';
import { loadIntakeConfig } from './intake';
import { persistNotifications } from './notificationService';
import { ServiceProblem } from './problem';
import { summaryDto, type QuoteReadService, type QuoteViewContext } from './quotes';
import type { ScoringService } from './scoring';
import { recordAudit, type AuditMeta } from '../plugins/audit';

export type EngWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

/** A failure the route turns into problem+json (via `handleProblems`). */
export class EngineeringError extends ServiceProblem {
  override name = 'EngineeringError';
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const CONFLICT_CODES = new Set(['WRONG_STAGE', 'QUOTE_CLOSED', 'ALREADY_ACCEPTED']);

/** Domain errors → 403 (not permitted), 409 (wrong state) or 422 (bad input, every error listed). */
function fail(errors: readonly DomainError[]): never {
  const forbidden = errors.filter((e) => e.code === 'NOT_PERMITTED');
  if (forbidden.length > 0) {
    throw new EngineeringError(
      403,
      ENGINEERING_PROBLEM_CODES.notPermitted,
      forbidden.map((e) => e.message).join('; '),
    );
  }
  const conflict = errors.find((e) => CONFLICT_CODES.has(e.code));
  if (conflict) {
    throw new EngineeringError(409, ENGINEERING_PROBLEM_CODES.conflict, conflict.message);
  }
  throw new EngineeringError(
    422,
    ENGINEERING_PROBLEM_CODES.rejected,
    'The change was not accepted',
    {
      errors: errors.map((e) => ({
        path: e.field ? `/${e.field}` : '/',
        message: e.message,
        code: e.code,
      })),
    },
  );
}

const notFound = (quoteNumber: string) =>
  new EngineeringError(404, ENGINEERING_PROBLEM_CODES.notFound, `No quote ${quoteNumber}`);

export interface EngineeringServiceOptions {
  quotes: QuoteReadService;
  scoring: ScoringService;
  log?: FastifyBaseLogger;
  now?: () => Date;
}

interface QueueContext {
  ctx: QuoteViewContext;
  settings: EngQueueSettings;
  intake: IntakeConfig;
  stageLabel: string;
  tierOrder: string[];
}

/**
 * B-10 engineering queue and Engineering Review (F-04, CR-14/15/19, DEC-26). Rules are the domain's
 * (`engineering/`): who may assign, accept and edit, the capacity-evidence merge, queue order and
 * aging. G2 itself goes through the generic gate route.
 */
export class EngineeringService {
  private readonly now: () => Date;

  constructor(private readonly opts: EngineeringServiceOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  private async queueContext(tx: Tx, actor: Actor, now: Date): Promise<QueueContext> {
    const [ctx, intake, workflow] = await Promise.all([
      this.opts.quotes.context(tx, actor, now),
      loadIntakeConfig(tx),
      loadWorkflowConfigInput(tx).then(parseWorkflowConfig),
    ]);
    const tierOrder = [...(ctx.model?.tiers ?? [])].sort((a, b) => b.min - a.min).map((t) => t.key);
    return {
      ctx,
      settings: ctx.engQueue,
      intake,
      stageLabel:
        workflow.stages.find((s) => s.key === ENG_QUEUE_STAGE_KEY)?.label ?? ENG_QUEUE_STAGE_KEY,
      tierOrder,
    };
  }

  private item(
    row: EngQueueRow,
    qc: QueueContext,
    holds: { startedAt: Date; endedAt: Date | null }[],
    now: Date,
  ): EngQueueItem & { entry: EngQueueEntry } {
    const q = row.quote;
    const summary = summaryDto(row, qc.ctx);
    const entered = row.enteredQueueAt ?? q.submittedAt ?? q.createdAt;
    const days = businessDaysBetween(entered, now);
    const bucket = agingBucket(days, qc.settings.agingDays);
    const [stageTime] = computeTimeInStage(
      [{ stageKey: q.stageKey, enteredAt: entered, exitedAt: null }],
      holds,
      now,
    );
    const structured = (q.structuredDescription ?? {}) as { standard?: string; size?: string };
    const completeness = engineeringCompleteness(
      {
        sf_opportunity_id: q.sfOpportunityId,
        customer: { name: row.customerName },
        ship_to: q.shipTo,
        ship_to_default: q.shipToOriginal,
        ship_to_override_reason: q.shipToOverrideReason,
        request_class: q.requestClass,
        product_family: q.productFamily,
        components: q.components,
        market: q.market,
        resin: q.resin,
        neck_finish: q.neckFinish,
        packaging_type: q.packagingType,
        packaging_notes: q.packagingNotes,
        est_annual_volume: q.estAnnualVolume,
        est_annual_volume_confirmed: q.estAnnualVolumeConfirmed,
        est_annual_revenue: q.estAnnualRevenue,
        expected_close_date: q.expectedCloseDate,
        container_size: structured.size ?? null,
        standard_description: structured.standard ?? null,
        description: q.description,
        drawing_status: q.drawingStatus,
        comments_for_engineering: q.commentsForEngineering,
      },
      qc.intake,
    );
    const pinned = q.queuePositionOverridden && q.queuePosition !== null;
    const state = {
      stageKey: q.stageKey,
      status: q.status as QuoteState['status'],
      kamUserId: asUserId(q.kamUserId),
      assignedEngineerId: q.assignedEngineerId ? asUserId(q.assignedEngineerId) : null,
      ...(q.region ? { region: q.region } : {}),
    };
    return {
      ...summary,
      enteredQueueAt: iso(entered),
      businessDaysInQueue: days,
      agingBucket: bucket,
      activeMsInStage: stageTime?.activeMs ?? 0,
      assignedEngineerId: q.assignedEngineerId,
      assignedEngineerName: row.assignedEngineerName ?? null,
      assignedAt: iso(q.assignedAt),
      acceptedAt: iso(row.acceptedAt),
      queueStatus: !q.assignedEngineerId ? 'unassigned' : row.acceptedAt ? 'accepted' : 'assigned',
      pinned,
      queuePosition: pinned ? q.queuePosition : null,
      drawingStatus: q.drawingStatus,
      sfCloseDate: row.sfCloseDate ?? null,
      completeness,
      canEdit: canEditEngReview(qc.ctx.actor, state),
      entry: {
        quoteNumber: q.quoteNumber,
        tier: summary.priority.tier,
        score: summary.priority.score,
        enteredQueueAt: entered,
        businessDaysInQueue: days,
        agingBucket: bucket,
        pinnedPosition: pinned ? q.queuePosition : null,
        assignedEngineerId: q.assignedEngineerId,
        productFamily: q.productFamily,
        searchText: [
          q.quoteNumber,
          q.sfOpportunityId,
          row.customerName,
          row.opportunityName,
          row.kamName,
          row.assignedEngineerName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
      },
    };
  }

  /** GET /queue/engineering: the whole queue in scope (RLS), aged, ordered and filtered. */
  async queue(withTx: EngWithTx, actor: Actor, query: EngQueueFilters): Promise<EngQueueResponse> {
    const now = this.now();
    return withTx(async (tx) => {
      const qc = await this.queueContext(tx, actor, now);
      const rows = await listEngQueueRows(tx, ENG_QUEUE_STAGE_KEY);
      const holds = await listHoldsForQuotes(
        tx,
        rows.map((r) => r.quote.id),
      );
      const byQuote = new Map<string, { startedAt: Date; endedAt: Date | null }[]>();
      for (const h of holds) byQuote.set(h.quoteId, [...(byQuote.get(h.quoteId) ?? []), h]);

      const all = rows.map((r) => this.item(r, qc, byQuote.get(r.quote.id) ?? [], now));
      const sorted = sortEngQueue(
        all.map((i) => ({ ...i.entry, item: i })),
        qc.tierOrder,
      ).map((e) => e.item);
      const entryOf = (i: (typeof all)[number]) => ({ ...i.entry, item: i });
      const engineer = query.engineer === 'me' ? actor.userId : query.engineer;
      const filtered = filterEngQueue(sorted.map(entryOf), {
        ...(query.tier ? { tiers: query.tier } : {}),
        ...(engineer ? { engineer } : {}),
        ...(query.agedOver !== undefined ? { agedOverDays: query.agedOver } : {}),
        ...(query.bucket ? { agingBuckets: query.bucket } : {}),
        ...(query.productFamily ? { productFamilies: query.productFamily } : {}),
        ...(query.q ? { q: query.q } : {}),
      }).map((e) => e.item);

      const strip = ({ entry: _e, ...item }: (typeof all)[number]): EngQueueItem => item;
      const canAssign = canAssignEngQueue(actor, qc.settings);
      const pinField = qc.ctx.overrides.fields.find((f) => f.field === 'queue_position');
      return {
        stage: { key: ENG_QUEUE_STAGE_KEY, label: qc.stageLabel },
        aging: {
          edges: qc.settings.agingDays,
          labels: agingBucketLabels(qc.settings.agingDays),
          counts: countByAgingBucket(all.map((i) => i.entry)),
        },
        total: all.length,
        canAssign,
        canDecide: can(actor, 'gate.G2.decide'),
        canPin:
          !!pinField &&
          holdsPermission(actor, 'override.request') &&
          actor.roles.some((r) => pinField.requestRoles.includes(r)),
        engineers: canAssign
          ? (await listAssignableEngineers(tx, ASSIGNABLE_ROLES, ENG_QUEUE_STAGE_KEY)).map((e) => ({
              ...e,
            }))
          : [],
        mine: sorted.filter((i) => i.assignedEngineerId === actor.userId).map(strip),
        items: filtered.map(strip),
      };
    });
  }

  private async loadQuote(tx: Tx, quoteNumber: string): Promise<{ q: Quote; state: QuoteState }> {
    const q = await getQuoteByNumber(tx, quoteNumber);
    if (!q) throw notFound(quoteNumber);
    const state = (await loadQuoteState(tx, q.id))!;
    return { q, state };
  }

  private async detail(tx: Tx, actor: Actor, quoteNumber: string): Promise<EngineeringDetail> {
    const { q, state } = await this.loadQuote(tx, quoteNumber);
    return engineeringView(tx, actor, await loadEngQueueSettings(tx), q, state);
  }

  /** POST /quotes/:qn/assignment: assign or reassign; recorded, audited and the engineer is told. */
  async assign(
    withTx: EngWithTx,
    actor: Actor,
    quoteNumber: string,
    engineerId: string,
    meta: AuditMeta,
  ): Promise<AssignmentResponse> {
    const now = this.now();
    return withTx(async (tx) => {
      const { q, state } = await this.loadQuote(tx, quoteNumber);
      const settings = await loadEngQueueSettings(tx);
      const user = await getUserWithRoles(tx, engineerId);
      const plan = planAssignment(
        actor,
        settings,
        state,
        user ? { id: user.id, roles: user.roles as Role[], active: user.active } : undefined,
      );
      if (!plan.ok) fail(plan.errors);
      if (!plan.changed) {
        return {
          quoteNumber,
          assignedEngineerId: plan.to,
          assignedEngineerName: user!.displayName,
          assignedAt: iso(q.assignedAt),
          changed: false,
        };
      }
      const names = await listUsersByIds(
        tx,
        [plan.from, plan.to].filter((x): x is string => !!x),
      );
      const nameOf = (id: string | null) => names.find((u) => u.id === id)?.displayName ?? null;

      await updateQuote(tx, q.id, { assignedEngineerId: plan.to, assignedAt: now });
      // A new engineer starts their own review: acceptance is per assignee.
      if (plan.from) await resetEngReviewAcceptance(tx, q.id);
      await insertActivityEvent(tx, {
        quoteId: q.id,
        type: 'engineer_assigned',
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
        before: { assignedEngineerId: plan.from, assignedAt: iso(q.assignedAt) },
        after: { assignedEngineerId: plan.to, assignedAt: now.toISOString() },
        at: now,
      });
      await persistNotifications(
        tx,
        [{ type: 'quote.assigned', recipient: { kind: 'user', userId: asUserId(plan.to) } }],
        {
          quoteId: q.id,
          title: `${quoteNumber} is assigned to you`,
          body: plan.from
            ? 'The engineering review was reassigned to you.'
            : 'You have a new engineering review.',
          excludeUserId: actor.userId,
          payload: { reassigned: plan.from ? 'yes' : 'no' },
        },
        this.opts.log,
      );
      return {
        quoteNumber,
        assignedEngineerId: plan.to,
        assignedEngineerName: nameOf(plan.to),
        assignedAt: now.toISOString(),
        changed: true,
      };
    });
  }

  /** POST /quotes/:qn/eng-review/accept: start the review. */
  async accept(
    withTx: EngWithTx,
    actor: Actor,
    quoteNumber: string,
    meta: AuditMeta,
  ): Promise<EngineeringDetail> {
    const now = this.now();
    return withTx(async (tx) => {
      const { q, state } = await this.loadQuote(tx, quoteNumber);
      const eng = await getEngReview(tx, q.id);
      const plan = planAccept(actor, state, eng?.acceptedAt ?? null);
      if (!plan.ok) fail(plan.errors);
      await upsertEngReview(tx, {
        ...reviewColumns(eng),
        quoteId: q.id,
        acceptedAt: now,
        acceptedBy: actor.userId,
        createdBy: eng?.createdBy ?? actor.userId,
      });
      await insertActivityEvent(tx, {
        quoteId: q.id,
        type: 'eng_review_accepted',
        actorId: actor.userId,
        at: now,
        payload: {},
        createdBy: actor.userId,
      });
      await recordAudit(tx, actor, meta, {
        action: 'update',
        entity: 'eng_review',
        entityId: eng?.id ?? null,
        quoteId: q.id,
        before: { acceptedAt: null },
        after: { acceptedAt: now.toISOString(), acceptedBy: actor.userId },
        at: now,
      });
      return this.detail(tx, actor, quoteNumber);
    });
  }

  private async assertEditable(tx: Tx, actor: Actor, quoteNumber: string) {
    const loaded = await this.loadQuote(tx, quoteNumber);
    const { state } = loaded;
    if (!canEditEngReview(actor, state)) {
      if (can(actor, 'engReview.edit', state) && state.stageKey !== ENG_QUEUE_STAGE_KEY) {
        throw new EngineeringError(
          409,
          ENGINEERING_PROBLEM_CODES.conflict,
          `${quoteNumber} is not in Engineering Review`,
        );
      }
      if (can(actor, 'engReview.edit', state) && state.status === 'closed') {
        throw new EngineeringError(409, ENGINEERING_PROBLEM_CODES.conflict, 'The quote is closed');
      }
      throw new EngineeringError(
        403,
        ENGINEERING_PROBLEM_CODES.notPermitted,
        'Only the EngLead or the assigned engineer can edit this review',
      );
    }
    return loaded;
  }

  /** Codes not in the active value list, as 422 errors. */
  private async checkCodes(
    tx: Tx,
    checks: {
      listKey: 'process_type' | 'machine_type' | 'plant';
      code: string | null | undefined;
      path: string;
    }[],
  ): Promise<DomainErrorLike[]> {
    const errors: DomainErrorLike[] = [];
    const cache = new Map<string, Set<string>>();
    for (const c of checks) {
      if (c.code === null || c.code === undefined) continue;
      let codes = cache.get(c.listKey);
      if (!codes) {
        codes = new Set((await listValueList(tx, c.listKey)).map((v) => v.code));
        cache.set(c.listKey, codes);
      }
      if (!codes.has(c.code)) {
        errors.push({
          path: c.path,
          code: 'INVALID_VALUE',
          message: `"${c.code}" is not an active ${c.listKey.replace('_', ' ')} code`,
        });
      }
    }
    return errors;
  }

  /** PUT /quotes/:qn/eng-review: the solution fields. A capital change rescores the quote. */
  async updateReview(
    withTx: EngWithTx,
    actor: Actor,
    quoteNumber: string,
    body: EngReviewBody,
    meta: AuditMeta,
  ): Promise<EngineeringDetail> {
    const now = this.now();
    return withTx(async (tx) => {
      const { q } = await this.assertEditable(tx, actor, quoteNumber);
      const invalid = await this.checkCodes(tx, [
        { listKey: 'process_type', code: body.processType, path: '/processType' },
        { listKey: 'machine_type', code: body.machineType, path: '/machineType' },
        { listKey: 'plant', code: body.plantCode, path: '/plantCode' },
      ]);
      if (invalid.length > 0) {
        throw new EngineeringError(
          422,
          ENGINEERING_PROBLEM_CODES.rejected,
          'The change was not accepted',
          {
            errors: invalid,
          },
        );
      }
      const eng = await getEngReview(tx, q.id);
      const current = reviewColumns(eng);
      const changed = (Object.keys(body) as (keyof EngReviewBody)[]).filter(
        (k) => body[k] !== undefined && (body[k] ?? null) !== (current[k] ?? null),
      );
      if (changed.length === 0) return this.detail(tx, actor, quoteNumber);

      const next = { ...current };
      for (const k of changed) (next as Record<string, unknown>)[k] = body[k] ?? null;
      await upsertEngReview(tx, {
        ...next,
        quoteId: q.id,
        createdBy: eng?.createdBy ?? actor.userId,
      });
      // Timeline payloads are shown to every reader: field names only, never values.
      await insertActivityEvent(tx, {
        quoteId: q.id,
        type: 'eng_review_updated',
        actorId: actor.userId,
        at: now,
        payload: { fields: changed },
        createdBy: actor.userId,
      });
      await recordAudit(tx, actor, meta, {
        action: 'update',
        entity: 'eng_review',
        entityId: eng?.id ?? null,
        quoteId: q.id,
        before: Object.fromEntries(changed.map((k) => [k, current[k] ?? null])),
        after: Object.fromEntries(changed.map((k) => [k, next[k] ?? null])),
        at: now,
      });
      if (changed.includes('prelimCapitalUsd')) {
        await this.opts.scoring.recalculate(tx, q.id, actor.userId, now, 'input_change');
      }
      return this.detail(tx, actor, quoteNumber);
    });
  }

  /** PUT /quotes/:qn/capacity-evidence: replaces the set (CR-19). */
  async updateCapacity(
    withTx: EngWithTx,
    actor: Actor,
    quoteNumber: string,
    body: CapacityEvidenceBody,
    meta: AuditMeta,
  ): Promise<EngineeringDetail> {
    const now = this.now();
    return withTx(async (tx) => {
      const { q } = await this.assertEditable(tx, actor, quoteNumber);
      const stored = await listCapacityEvidence(tx, q.id);
      const errors = await this.checkCodes(
        tx,
        body.rows.map((r, i) => ({
          listKey: 'plant' as const,
          code: r.site,
          path: `/rows/${i}/site`,
        })),
      );
      const analysts = new Set(
        (await listUsersByIds(tx, [...new Set(body.rows.map((r) => r.analystId))])).map(
          (u) => u.id,
        ),
      );
      body.rows.forEach((r, i) => {
        if (!analysts.has(r.analystId)) {
          errors.push({
            path: `/rows/${i}/analystId`,
            code: 'INVALID_VALUE',
            message: 'Unknown analyst',
          });
        }
      });
      const plan = planCapacityEvidence(
        actor,
        body.rows,
        stored.map((r) => ({
          id: r.id,
          assumedEffectivenessPct: r.assumedEffectivenessPct,
          cycleTimeS: r.cycleTimeS,
          utilizationPct: r.utilizationPct,
          bufferPct: r.bufferPct,
        })),
      );
      if (!plan.ok) {
        errors.push(
          ...plan.errors.map((e) => ({
            path: e.field ? `/${e.field}` : '/',
            code: e.code,
            message: e.message,
          })),
        );
      }
      if (errors.length > 0 || !plan.ok) {
        throw new EngineeringError(
          422,
          ENGINEERING_PROBLEM_CODES.rejected,
          'The change was not accepted',
          {
            errors,
          },
        );
      }

      await deleteCapacityEvidence(tx, q.id, plan.deleteIds);
      let added = 0;
      let updated = 0;
      for (const { id, ...row } of plan.upsert) {
        if (id) {
          await updateCapacityEvidence(tx, id, row);
          updated += 1;
        } else {
          await insertCapacityEvidence(tx, { ...row, quoteId: q.id, createdBy: actor.userId });
          added += 1;
        }
      }
      const removed = plan.deleteIds.length;
      await insertActivityEvent(tx, {
        quoteId: q.id,
        type: 'capacity_evidence_updated',
        actorId: actor.userId,
        at: now,
        payload: { added, updated, removed, rows: plan.upsert.length },
        createdBy: actor.userId,
      });
      await recordAudit(tx, actor, meta, {
        action: 'update',
        entity: 'capacity_evidence',
        entityId: null,
        quoteId: q.id,
        before: stored.map(({ createdAt: _c, updatedAt: _u, createdBy: _b, ...r }) => r),
        after: plan.upsert,
        at: now,
      });
      return this.detail(tx, actor, quoteNumber);
    });
  }

  /** GET /quotes/:qn/stage-times: per-stage durations excluding holds (`computeTimeInStage`). */
  async stageTimes(withTx: EngWithTx, quoteNumber: string): Promise<StageTimesResponse> {
    const now = this.now();
    return withTx(async (tx) => {
      const q = await getQuoteByNumber(tx, quoteNumber);
      if (!q) throw notFound(quoteNumber);
      const [history, holds, workflow] = await Promise.all([
        listStageHistory(tx, q.id),
        listHolds(tx, q.id),
        loadWorkflowConfigInput(tx).then(parseWorkflowConfig),
      ]);
      const visits = computeTimeInStage(history, holds, now);
      const label = (key: string) => workflow.stages.find((s) => s.key === key)?.label ?? key;
      return {
        quoteNumber,
        asOf: now.toISOString(),
        stages: summarizeStageTimes(visits).map((s) => ({ ...s, label: label(s.stageKey) })),
        visits: visits.map((v) => ({
          stageKey: v.stageKey,
          enteredAt: v.enteredAt.toISOString(),
          exitedAt: iso(v.exitedAt),
          elapsedMs: v.elapsedMs,
          heldMs: v.heldMs,
          activeMs: v.activeMs,
        })),
      };
    });
  }
}

interface DomainErrorLike {
  path: string;
  code: string;
  message: string;
}

/** The editable eng_review columns of a row (or all null), in the DTO's camelCase. */
function reviewColumns(eng: Awaited<ReturnType<typeof getEngReview>>) {
  return {
    processType: eng?.processType ?? null,
    machineType: eng?.machineType ?? null,
    plantCode: eng?.plantCode ?? null,
    cavitation: eng?.cavitation ?? null,
    cycleTimeS: eng?.cycleTimeS ?? null,
    toolingNotes: eng?.toolingNotes ?? null,
    downstreamEquipmentNotes: eng?.downstreamEquipmentNotes ?? null,
    prelimCapitalUsd: eng?.prelimCapitalUsd ?? null,
    technicalConceptNotes: eng?.technicalConceptNotes ?? null,
    acceptedAt: eng?.acceptedAt ?? null,
    acceptedBy: eng?.acceptedBy ?? null,
    returnedReason: eng?.returnedReason ?? null,
  };
}
