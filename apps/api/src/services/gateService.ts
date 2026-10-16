import type {
  GateDecisionBody,
  GateDecisionResponse,
  GateQueueResponse,
  QuoteDetail,
} from '@ccq/contracts';
import { GATE_PROBLEM_CODES } from '@ccq/contracts';
import type { Tx } from '@ccq/db';
import {
  getPricingRecord,
  getQuoteSummaryByNumber,
  getSetting,
  listGateQueue,
  loadQuoteState,
  loadWorkflowConfigInput,
  persistTransition,
  updateQuote,
  upsertPricingRecord,
} from '@ccq/db/repos';
import {
  ENG_QUEUE_STAGE_KEY,
  PRICING_QUEUE_STAGE_KEY,
  can,
  evaluateTransition,
  exceptionNoteErrors,
  parseWorkflowConfig,
  quotingWarnings,
  type Actor,
  type DomainError,
  type PlannedNotification,
  type PricingRecordValues,
  type QuoteState,
  type TransitionEffects,
  type TransitionRequest,
  type WorkflowConfig,
} from '@ccq/domain';

import { onEngQueueArrival } from './engineering-arrival';
import type { AuditMeta } from './intake';
import {
  onFinalReviewArrival,
  onPricingArrival,
  recordColumns,
  recordValues,
} from './pricing-view';
import { summaryDto, type QuoteReadService, type QuoteViewContext } from './quotes';
import type { ScoringService } from './scoring';

export type GateWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

/** A failure the route turns into problem+json. `errors` carries every domain error, not just the first. */
export class GateError extends Error {
  constructor(
    readonly status: 403 | 404 | 422,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'GateError';
  }
}

/**
 * Where planned notifications go. B-18 replaces the default (log only) with in-app + email delivery.
 * Called after the decision's transaction commits, so a failed send never undoes a decision.
 */
export type NotificationHook = (
  notifications: readonly PlannedNotification[],
  context: { quoteId: string; quoteNumber: string; gateKey: string; outcomeKey: string },
) => Promise<void> | void;

export interface GateServiceOptions {
  scoring: ScoringService;
  quotes: QuoteReadService;
  notify?: NotificationHook;
  now?: () => Date;
}

/** Codes that mean "you may not", reported as 403 rather than 422. */
const FORBIDDEN_CODES = new Set(['NOT_PERMITTED', 'SEGREGATION']);

const problemErrors = (errors: readonly DomainError[]) =>
  errors.map((e) => ({
    path: e.field ? `/${e.field}` : '/',
    message: e.message,
    code: e.code,
  }));

/**
 * The generic gate-decision service (B-08), used for G1 and reused unchanged by G2–G5:
 *
 *   load quote (RLS) → domain `evaluateTransition` (+ qualification exception note) → in ONE transaction:
 *   gate_decision (evidence: score breakdown, warnings, key intake fields) · hold interval · stage_history ·
 *   quote row · activity_event · audit_event · review_date for holds → rescore → commit → notification hook.
 *
 * The service decides nothing itself: every rule (stage, decider permission, segregation, required fields,
 * note / reason / review date) is the domain's, driven by the workflow config tables.
 */
export class GateService {
  private readonly now: () => Date;
  private readonly notify: NotificationHook;

  constructor(private readonly opts: GateServiceOptions) {
    this.now = opts.now ?? (() => new Date());
    this.notify = opts.notify ?? (() => undefined);
  }

  private static async workflow(tx: Tx): Promise<WorkflowConfig> {
    return parseWorkflowConfig(await loadWorkflowConfigInput(tx));
  }

  async decide(
    withTx: GateWithTx,
    actor: Actor,
    quoteNumber: string,
    gateKey: string,
    body: GateDecisionBody,
    meta: AuditMeta,
  ): Promise<GateDecisionResponse> {
    const now = this.now();
    const { response, effects } = await withTx(async (tx) => {
      const workflow = await GateService.workflow(tx);
      const gate = workflow.gates.find((g) => g.key === gateKey);
      if (!gate) {
        throw new GateError(404, GATE_PROBLEM_CODES.unknownGate, `No gate ${gateKey}`);
      }
      const row = await getQuoteSummaryByNumber(tx, quoteNumber);
      if (!row) throw new GateError(404, GATE_PROBLEM_CODES.notFound, `No quote ${quoteNumber}`);
      const state = (await loadQuoteState(tx, row.quote.id))!;
      const ctx = await this.opts.quotes.context(tx, actor, now);
      const before = summaryDto(row, ctx);

      const request: TransitionRequest = {
        gateKey,
        outcomeKey: body.outcomeKey,
        ...(body.note !== undefined ? { note: body.note } : {}),
        ...(body.reasonCode !== undefined ? { reasonCode: body.reasonCode } : {}),
        ...(body.targetStageKey !== undefined ? { targetStageKey: body.targetStageKey } : {}),
        ...(body.holdUntil !== undefined ? { payload: { review_date: body.holdUntil } } : {}),
      };
      const result = evaluateTransition(workflow, state, actor, request, now);
      const errors = [
        ...(result.ok ? [] : result.errors),
        ...exceptionNoteErrors(ctx.qualification, before.warnings, request),
      ];
      if (errors.length > 0) {
        if (errors.some((e) => FORBIDDEN_CODES.has(e.code))) {
          throw new GateError(
            403,
            GATE_PROBLEM_CODES.notPermitted,
            errors
              .filter((e) => FORBIDDEN_CODES.has(e.code))
              .map((e) => e.message)
              .join('; '),
          );
        }
        throw new GateError(422, GATE_PROBLEM_CODES.rejected, 'The decision was not accepted', {
          errors: problemErrors(errors),
        });
      }
      const planned = (result as { ok: true; effects: TransitionEffects }).effects;

      // Evidence snapshot: what the decider saw (the domain records the rule fields; we add context).
      const decisionRecord = {
        ...planned.gateDecisionRecord,
        evidence: {
          ...planned.gateDecisionRecord.evidence,
          priority: before.priority.visible
            ? {
                score: before.priority.score,
                tier: before.priority.tier,
                computedTier: before.priority.computedTier,
                modelVersion: before.priority.modelVersion,
                breakdown: before.priority.breakdown,
                unknowns: before.priority.unknowns,
              }
            : null,
          warnings: before.warnings,
          // B-10: G2 keeps the engineering solution and capacity rows exactly as the decider saw them.
          ...(gate.stageKey === ENG_QUEUE_STAGE_KEY
            ? { engineering: engineeringEvidence(state) }
            : {}),
          // B-11: G3 keeps what Pricing was warned about (pending capital, costing not attested…).
          ...(gate.stageKey === PRICING_QUEUE_STAGE_KEY
            ? { quoting: { warnings: quotingWarnings(pricingEvidence(state)) } }
            : {}),
          intake: {
            quoteNumber: before.quoteNumber,
            customerName: before.customerName,
            customerStatus: before.customerStatus,
            requestClass: before.requestClass,
            productFamily: before.productFamily,
            market: before.market,
            resin: before.resin,
            estAnnualVolume: before.estAnnualVolume,
            estAnnualRevenue: before.estAnnualRevenue,
            expectedCloseDate: before.expectedCloseDate,
          },
        },
      };
      const effects: TransitionEffects = { ...planned, gateDecisionRecord: decisionRecord };

      await persistTransition(tx, effects, {
        actorRoles: actor.roles,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        requestId: meta.requestId ?? null,
      });
      if (body.holdUntil && effects.nextStatus === 'on_hold') {
        await updateQuote(tx, row.quote.id, { reviewDate: body.holdUntil });
      }
      // B-10: the EngLead's arrival alert (in-app; email is B-18) whenever a quote enters the queue.
      if (effects.stageHistory.enter?.stageKey === ENG_QUEUE_STAGE_KEY) {
        await onEngQueueArrival(tx, row.quote, actor.userId);
      }
      // B-11: entering Quoting starts this version's pricing record (references carried forward) and
      // tells Pricing; G3 Submit tells the Approver group (in-app; email is B-18).
      const entered = effects.stageHistory.enter?.stageKey;
      if (entered === PRICING_QUEUE_STAGE_KEY) {
        await onPricingArrival(
          tx,
          { id: row.quote.id, quoteNumber, version: effects.nextVersion },
          actor.userId,
        );
      }
      if (entered === 'FINAL_REVIEW' && gateKey === 'G3') {
        await onFinalReviewArrival(tx, row.quote, actor.userId);
      }
      // B-10: e.g. G2 "Capital required" starts Pricing's capital readiness on pending (config).
      const readiness = ((await getSetting<Record<string, string>>(
        tx,
        'capital_readiness_on_outcome',
      )) ?? {})[`${gateKey}:${body.outcomeKey}`];
      if (readiness) {
        const pricing = await getPricingRecord(tx, row.quote.id);
        const current = recordValues(pricing);
        await upsertPricingRecord(tx, {
          ...(current ? recordColumns(current) : {}),
          quoteId: row.quote.id,
          quoteVersion: effects.nextVersion,
          capitalReadiness: readiness,
          createdBy: pricing?.createdBy ?? actor.userId,
        });
      }
      if (effects.nextStatus !== 'closed') {
        await this.opts.scoring.recalculate(tx, row.quote.id, actor.userId, now, `gate:${gateKey}`);
      }

      const quote = (await this.opts.quotes.detail(tx, workflow, ctx, quoteNumber))!;
      const decision = quote.decisions[0]!;
      return { response: { decision, quote }, effects };
    });

    await this.notify(effects.notifications, {
      quoteId: response.quote.id,
      quoteNumber,
      gateKey,
      outcomeKey: body.outcomeKey,
    });
    return response;
  }

  /**
   * Quotes waiting for a gate, highest priority first: open quotes in the gate's stage that are not back
   * with the KAM for rework. Anyone who can read quotes may look; `canDecide` says whether they decide.
   */
  async queue(withTx: GateWithTx, actor: Actor, gateKey: string): Promise<GateQueueResponse> {
    const now = this.now();
    return withTx(async (tx) => {
      const workflow = await GateService.workflow(tx);
      const gate = workflow.gates.find((g) => g.key === gateKey);
      if (!gate) throw new GateError(404, GATE_PROBLEM_CODES.unknownGate, `No gate ${gateKey}`);
      const ctx: QuoteViewContext = await this.opts.quotes.context(tx, actor, now);
      const rows = gate.enabled
        ? await listGateQueue(tx, { stageKey: gate.stageKey, submittedOnly: true })
        : [];
      return {
        gate: { key: gate.key, label: gate.label, stageKey: gate.stageKey, enabled: gate.enabled },
        canDecide: gate.enabled && can(actor, gate.deciderPermission),
        items: rows.map((r) => summaryDto(r, ctx)),
      };
    });
  }

  /** One quote's detail. The route marks the request so the audit plugin records the view. */
  async detail(withTx: GateWithTx, actor: Actor, quoteNumber: string): Promise<QuoteDetail> {
    const now = this.now();
    return withTx(async (tx) => {
      const workflow = await GateService.workflow(tx);
      const ctx = await this.opts.quotes.context(tx, actor, now);
      const dto = await this.opts.quotes.detail(tx, workflow, ctx, quoteNumber);
      if (!dto) throw new GateError(404, GATE_PROBLEM_CODES.notFound, `No quote ${quoteNumber}`);
      return dto;
    });
  }
}

/** The current version's pricing record as the G3 rules saw it (snake_case fields → domain values). */
function pricingEvidence(state: QuoteState): PricingRecordValues | null {
  const r = state.fields.pricing_record as Record<string, unknown> | null | undefined;
  if (!r) return null;
  const text = (key: string) => (typeof r[key] === 'string' ? r[key] : null);
  const date = (key: string) => (r[key] instanceof Date ? r[key] : null);
  const refs = (r.pricing_refs ?? {}) as { erf?: unknown; bpr?: unknown };
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  return {
    priceApprovedBy: text('price_approved_by'),
    priceApprovedAt: date('price_approved_at'),
    pricingBasisNote: text('pricing_basis_note'),
    approvedRangeNote: text('approved_range_note'),
    erfRefs: list(refs.erf),
    bprRefs: list(refs.bpr),
    noPricingAppRecordNote: text('no_pricing_app_record_note'),
    costingCompleted: r.costing_completed === true,
    costingAttestedBy: text('costing_attested_by'),
    costingAttestedAt: date('costing_attested_at'),
    capitalReadiness: text('capital_readiness') as PricingRecordValues['capitalReadiness'],
    cerReference: text('cer_reference'),
    capitalNotes: text('capital_notes'),
    capitalPendingJustification: text('capital_pending_justification'),
  };
}

/** The Engineering Review as it stood at a G2 decision: solution fields and every capacity row. */
function engineeringEvidence(state: QuoteState) {
  const f = state.fields;
  return {
    solution: {
      processType: f.process_type ?? null,
      machineType: f.machine_type ?? null,
      plantCode: f.plant_code ?? null,
      cavitation: f.cavitation ?? null,
      cycleTimeS: f.cycle_time_s ?? null,
      toolingNotes: f.tooling_notes ?? null,
      downstreamEquipmentNotes: f.downstream_equipment_notes ?? null,
      prelimCapitalUsd: f.prelim_capital_usd ?? null,
      technicalConceptNotes: f.technical_concept_notes ?? null,
      acceptedAt: f.accepted_at ?? null,
    },
    capacityEvidence: f.capacity_evidence ?? [],
    assignedEngineerId: state.assignedEngineerId ?? null,
  };
}
