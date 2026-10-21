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
  insertActivityEvent,
  listGateQueue,
  listUsersByIds,
  loadQuoteState,
  loadWorkflowConfigInput,
  persistTransition,
  updateQuote,
  upsertPricingRecord,
} from '@ccq/db/repos';
import {
  CUSTOMER_DECISION_STAGE_KEY,
  DomainError as DomainErrorClass,
  ENG_QUEUE_STAGE_KEY,
  asUserId,
  awardDetailErrors,
  isValidityLapsed,
  validityStatus,
  PRICING_QUEUE_STAGE_KEY,
  RECOST_OUTCOME,
  RELEASE_GATE_KEY,
  can,
  evaluateTransition,
  exceptionNoteErrors,
  parseWorkflowConfig,
  planProposalRelease,
  quotingWarnings,
  releasesProposal,
  reviewWarnings,
  withDerivedFields,
  type Actor,
  type DomainError,
  type ProposalReleasePlan,
  type PlannedNotification,
  type PricingRecordValues,
  type QuoteState,
  type TransitionEffects,
  type TransitionRequest,
  type WorkflowConfig,
} from '@ccq/domain';

import { onEngQueueArrival } from './engineering-arrival';
import { onFinalReviewDecided } from './final-review';
import type { AuditMeta } from './intake';
import { onCustomerOutcome } from './outcome';
import {
  onFinalReviewArrival,
  onPricingArrival,
  recordColumns,
  recordValues,
} from './pricing-view';
import { summaryDto, type QuoteReadService, type QuoteViewContext } from './quotes';
import { onReturnedToKam } from './returned-to-kam';
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
const FORBIDDEN_CODES = new Set(['NOT_PERMITTED', 'SEGREGATION', 'TIER_APPROVER_REQUIRED']);

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
      const ctx = await this.opts.quotes.context(tx, actor, now);
      // B-26: the rules also read the server-derived fields (Legal review required, pass-through).
      const state = withDerivedFields(
        (await loadQuoteState(tx, row.quote.id))!,
        ctx.commercial.derived,
      );
      const before = summaryDto(row, ctx);

      const request: TransitionRequest = {
        gateKey,
        outcomeKey: body.outcomeKey,
        ...(body.note !== undefined ? { note: body.note } : {}),
        ...(body.reasonCode !== undefined ? { reasonCode: body.reasonCode } : {}),
        ...(body.targetStageKey !== undefined ? { targetStageKey: body.targetStageKey } : {}),
        ...(body.holdUntil !== undefined || body.holdOwnerId !== undefined
          ? {
              payload: {
                ...(body.holdUntil !== undefined ? { review_date: body.holdUntil } : {}),
                // B-26: every hold names its owner.
                ...(body.holdOwnerId !== undefined ? { hold_owner_id: body.holdOwnerId } : {}),
              },
            }
          : {}),
        ...(body.closureOwnerId !== undefined
          ? { closureOwnerId: asUserId(body.closureOwnerId) }
          : {}),
      };

      // B-12: Approve releases the proposition: it sets proposal_issued_at (default now, editable to
      // the actual send date) and validity_until (issued + validity_days_default, config, D-12).
      const extraErrors: DomainError[] = [];
      let proposal: Extract<ProposalReleasePlan, { ok: true }> | null = null;
      if (releasesProposal(workflow, gateKey, body.outcomeKey)) {
        if (ctx.release.validityDays === null) {
          extraErrors.push(
            new DomainErrorClass('INVALID_CONFIG', ctx.release.validityError ?? 'Invalid validity'),
          );
        } else {
          const plan = planProposalRelease({
            now,
            issuedAt: body.proposalIssuedAt ? new Date(body.proposalIssuedAt) : null,
            validityDays: ctx.release.validityDays,
          });
          if (plan.ok) proposal = plan;
          else extraErrors.push(...plan.errors);
        }
      } else if (body.proposalIssuedAt !== undefined) {
        extraErrors.push(
          new DomainErrorClass(
            'INVALID_PROPOSAL_DATE',
            'A proposal date applies only to the decision that releases the proposition',
            'proposalIssuedAt',
          ),
        );
      }
      // B-13: the Customer Decision (G5) fields. The server works out whether the validity has passed
      // ("No response / Expired" needs that, or a note); an award brings its acceptance date and link,
      // a loss may name the competitor. They are kept on the decision (payload) as evidence.
      const atCustomer = gate.stageKey === CUSTOMER_DECISION_STAGE_KEY;
      const customerFields = {
        accepted_at: body.acceptedAt,
        acceptance_document_url: body.acceptanceDocumentUrl?.trim() || undefined,
        competitor: body.competitor?.trim() || undefined,
      };
      if (atCustomer) {
        request.payload = {
          ...request.payload,
          validity_lapsed: isValidityLapsed(row.quote.validityUntil, now),
          ...Object.fromEntries(Object.entries(customerFields).filter(([, v]) => v !== undefined)),
        };
        extraErrors.push(
          ...awardDetailErrors(
            {
              acceptedAt: body.acceptedAt ?? null,
              acceptanceDocumentUrl: customerFields.acceptance_document_url ?? null,
            },
            now,
          ),
        );
      } else {
        for (const [key, value] of Object.entries({
          acceptedAt: body.acceptedAt,
          acceptanceDocumentUrl: body.acceptanceDocumentUrl,
          competitor: body.competitor,
        })) {
          if (value !== undefined) {
            extraErrors.push(
              new DomainErrorClass(
                'INVALID_VALUE',
                `${key} applies only to the customer's outcome (Customer Decision)`,
                key,
              ),
            );
          }
        }
      }
      // B-26: a named hold owner must be an active user.
      if (body.holdOwnerId !== undefined) {
        const [owner] = await listUsersByIds(tx, [body.holdOwnerId]);
        if (!owner?.active) {
          extraErrors.push(
            new DomainErrorClass(
              'INVALID_VALUE',
              'The hold owner must be an active CCQ user',
              'holdOwnerId',
            ),
          );
        }
      }
      // B-13 (CR-39): a named closure owner must be an active user.
      if (body.closureOwnerId !== undefined) {
        const [owner] = await listUsersByIds(tx, [body.closureOwnerId]);
        if (!owner?.active) {
          extraErrors.push(
            new DomainErrorClass(
              'INVALID_CLOSURE_OWNER',
              'The closure owner must be an active CCQ user',
              'closureOwnerId',
            ),
          );
        }
      }
      // A malformed approver-tier setting must not silently switch the control off: refuse G4.
      if (gateKey === RELEASE_GATE_KEY && ctx.release.tiersError) {
        extraErrors.push(new DomainErrorClass('INVALID_CONFIG', ctx.release.tiersError));
      }
      if (proposal) {
        request.payload = {
          ...request.payload,
          proposal_issued_at: proposal.proposalIssuedAt.toISOString(),
          validity_until: proposal.validityUntil,
          validity_days: proposal.validityDays,
        };
      }

      const result = evaluateTransition(workflow, state, actor, request, now, {
        approverTiers: ctx.release.approverTiers,
      });
      const errors = [
        ...(result.ok ? [] : result.errors),
        ...exceptionNoteErrors(ctx.qualification, before.warnings, request),
        ...extraErrors,
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
          // Who decided, in which role (the audit row keeps the roles too; this keeps them with the decision).
          decidedByRoles: [...actor.roles],
          // B-12: what an approval set, and what the approver was told to weigh.
          ...(proposal
            ? {
                release: {
                  proposalIssuedAt: proposal.proposalIssuedAt.toISOString(),
                  validityUntil: proposal.validityUntil,
                  validityDays: proposal.validityDays,
                },
              }
            : {}),
          ...(gateKey === RELEASE_GATE_KEY
            ? { review: { warnings: finalReviewWarnings(state, before.warnings) } }
            : {}),
          // B-13: what the KAM saw at the customer's decision (validity countdown, proposal date).
          ...(atCustomer
            ? {
                customer: {
                  proposalIssuedAt: row.quote.proposalIssuedAt?.toISOString() ?? null,
                  validity: validityStatus(row.quote.validityUntil, now, ctx.outcome.warningDays),
                  sfStage: row.sfStage ?? null,
                },
              }
            : {}),
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
      // B-26 (slide 12): "Rework (re-cost)" keeps the quote in Quoting and clears the costing
      // attestation, so the cost sheet is redone before the price can advance.
      if (gateKey === 'G3' && body.outcomeKey === RECOST_OUTCOME) {
        const pricing = await getPricingRecord(tx, row.quote.id);
        const current = recordValues(pricing);
        if (current?.costingCompleted) {
          await upsertPricingRecord(tx, {
            ...recordColumns({
              ...current,
              costingCompleted: false,
              costingAttestedBy: null,
              costingAttestedAt: null,
            }),
            quoteId: row.quote.id,
            quoteVersion: effects.nextVersion,
            createdBy: pricing?.createdBy ?? actor.userId,
          });
        }
      }
      if (proposal) {
        await updateQuote(tx, row.quote.id, {
          proposalIssuedAt: proposal.proposalIssuedAt,
          validityUntil: proposal.validityUntil,
          // B-13: a new validity date is a fresh countdown for the expiry job.
          validityExpiredFlaggedAt: null,
        });
        await insertActivityEvent(tx, {
          quoteId: row.quote.id,
          type: 'proposal_released',
          actorId: actor.userId,
          at: now,
          payload: {
            issuedAt: proposal.proposalIssuedAt.toISOString(),
            validityUntil: proposal.validityUntil,
            validityDays: proposal.validityDays,
          },
          createdBy: actor.userId,
        });
      }
      // B-12: notices for the Final Review decisions (in-app + email, B-18). A Return is announced
      // by the arrival alert of the stage it goes back to.
      if (gateKey === RELEASE_GATE_KEY) {
        await onFinalReviewDecided(tx, {
          quote: { id: row.quote.id, quoteNumber },
          actorId: actor.userId,
          effects,
          workflow,
          proposal,
        });
      }
      // B-13: an award opens the hand-off record (evidence, acceptance date, document link).
      if (atCustomer) {
        await onCustomerOutcome(tx, {
          quoteId: row.quote.id,
          actorId: actor.userId,
          effects,
          acceptedAt: body.acceptedAt ?? null,
          acceptanceDocumentUrl: customerFields.acceptance_document_url ?? null,
          now,
        });
      }
      // B-18: a quote returned to its KAM (G1 / G2 rework) tells the KAM, in-app and by email.
      await onReturnedToKam(tx, {
        quote: { id: row.quote.id, quoteNumber },
        actorId: actor.userId,
        effects,
        workflow,
      });
      // B-10: the EngLead's arrival alert (in-app + email, B-18) whenever a quote enters the queue.
      if (effects.stageHistory.enter?.stageKey === ENG_QUEUE_STAGE_KEY) {
        await onEngQueueArrival(tx, row.quote, actor.userId, undefined, returnedFrom(gateKey));
      }
      // B-11: entering Quoting starts this version's pricing record (references carried forward) and
      // tells Pricing; G3 Submit tells the Approver group (in-app + email, B-18).
      const entered = effects.stageHistory.enter?.stageKey;
      if (entered === PRICING_QUEUE_STAGE_KEY) {
        await onPricingArrival(
          tx,
          { id: row.quote.id, quoteNumber, version: effects.nextVersion },
          actor.userId,
          undefined,
          returnedFrom(gateKey),
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

/**
 * A G4 decision that re-enters Engineering or Quoting is a Return, a G5 one a customer Re-quote: the
 * arrival alert says so.
 */
const returnedFrom = (gateKey: string): 'final_review' | 'customer_requote' | undefined =>
  gateKey === RELEASE_GATE_KEY ? 'final_review' : gateKey === 'G5' ? 'customer_requote' : undefined;

/** What the approver was told to weigh, as it stood at the G4 decision. */
function finalReviewWarnings(
  state: QuoteState,
  qualification: readonly { code: string; message: string }[],
) {
  const pricing = pricingEvidence(state);
  const capacity = state.fields.capacity_evidence;
  return reviewWarnings({
    qualification,
    quoting: quotingWarnings(pricing),
    g2Outcome: (state.fields.g2_outcome as string | null | undefined) ?? null,
    g2Note: null,
    priceApproved: !!pricing?.priceApprovedBy && !!pricing.priceApprovedAt,
    capacityEvidenceRows: Array.isArray(capacity) ? capacity.length : 0,
    requirement: null,
  });
}

/** The current version's pricing record as the G3 rules saw it (snake_case fields → domain values). */
function pricingEvidence(state: QuoteState): PricingRecordValues | null {
  const r = state.fields.pricing_record as Record<string, unknown> | null | undefined;
  if (!r) return null;
  const text = (key: string) => (typeof r[key] === 'string' ? r[key] : null);
  const date = (key: string) => (r[key] instanceof Date ? r[key] : null);
  const refs = (r.pricing_refs ?? {}) as { erf?: unknown };
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  return {
    priceApprovedBy: text('price_approved_by'),
    priceApprovedAt: date('price_approved_at'),
    pricingBasisNote: text('pricing_basis_note'),
    approvedRangeNote: text('approved_range_note'),
    erfRefs: list(refs.erf),
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
