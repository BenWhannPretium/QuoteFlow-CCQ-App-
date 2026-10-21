import type {
  AvailableGateAction,
  GateDecisionSummary,
  QualificationWarning,
  QuoteDetail,
  QuotePriority,
  QuoteSummary,
  ReworkRequest,
} from '@ccq/contracts';
import type { DbOrTx } from '@ccq/db';
import {
  getQuoteSummaryByNumber,
  listGateDecisionsWithNames,
  loadQuoteState,
  type QuoteSummaryRow,
  type StoredPriority,
} from '@ccq/db/repos';
import {
  availableActions,
  canSeePriorityScore,
  evaluateRules,
  fieldsReferenced,
  isSupersededDecision,
  isValidityLapsed,
  qualificationWarnings,
  redactScore,
  withDerivedFields,
  type Actor,
  type EngQueueSettings,
  type OverrideSettings,
  type QualificationSettings,
  type QuoteState,
  type ScoreResult,
  type ScoringModel,
  type WorkflowConfig,
} from '@ccq/domain';

import { commercialView, loadCommercialSettings, type CommercialSettings } from './commercial';
import { engineeringView, loadEngQueueSettings } from './engineering-view';
import { loadReleaseSettings, type ReleaseSettings } from './final-review-view';
import { customerDecisionView, loadOutcomeSettings, type OutcomeSettings } from './outcome-view';
import { loadOverrideSettings, quoteOverridableFields } from './overrides-view';
import { quotingView } from './pricing-view';
import type { ScoringService } from './scoring';

/** Request-scoped inputs for building quote DTOs (loaded once per request). */
export interface QuoteViewContext {
  actor: Actor;
  model: ScoringModel | null;
  qualification: QualificationSettings;
  kamCanSeePeerScores: boolean;
  /** B-09 `overridable_fields`: which fields the quote page offers an override for. */
  overrides: OverrideSettings;
  /** B-10 engineering queue settings (aging buckets, backup assigners). */
  engQueue: EngQueueSettings;
  /** B-12 Final Review settings: validity days and the (disabled by default) approver tiers. */
  release: ReleaseSettings;
  /** B-13: validity warning window, hand-off receiving roles, the SF stage map. */
  outcome: OutcomeSettings;
  /** B-26: Legal triggers, pricing pass-through, notices, escalation routes, the Process Owner. */
  commercial: CommercialSettings;
  /** The request's clock (validity countdowns are relative to it). */
  now: Date;
}

/**
 * Fields a decision supplies itself (the dialog asks for them, or the server derives them at decision
 * time), so they never count as "missing": the review date, B-13's acceptance date, the decision's own
 * note and whether the validity has lapsed.
 */
const DECISION_FIELDS = new Set([
  'review_date',
  'accepted_at',
  'decision_note',
  'validity_lapsed',
  // B-26: the hold owner is picked in the dialog.
  'hold_owner_id',
]);

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function tierLabel(model: ScoringModel | null, key: string | null): string | null {
  if (!key) return null;
  return model?.tiers.find((t) => t.key === key)?.label ?? key;
}

const HIDDEN_PRIORITY: QuotePriority = {
  visible: false,
  score: null,
  tier: null,
  tierLabel: null,
  computedTier: null,
  computedTierLabel: null,
  tierOverridden: false,
  modelVersion: null,
  breakdown: [],
  unknowns: [],
};

/** The stored priority, with `kam_can_see_peer_scores` and commercial-input redaction applied. */
export function priorityDto(q: QuoteSummaryRow['quote'], ctx: QuoteViewContext): QuotePriority {
  if (!canSeePriorityScore(ctx.actor, q.kamUserId, ctx.kamCanSeePeerScores)) return HIDDEN_PRIORITY;
  const stored = q.priorityBreakdown as StoredPriority | null;
  const computedTier = stored?.computedTier ?? (q.priorityTierOverridden ? null : q.priorityTier);
  const asResult: ScoreResult = {
    total: q.priorityScore ?? 0,
    tier: computedTier ?? '',
    tierLabel: '',
    modelVersion: q.scoringModelVersion ?? 0,
    breakdown: stored?.breakdown ?? [],
    unknowns: stored?.unknowns ?? [],
  };
  const safe = redactScore(asResult, ctx.actor);
  return {
    visible: true,
    score: q.priorityScore,
    tier: q.priorityTier,
    tierLabel: tierLabel(ctx.model, q.priorityTier),
    computedTier,
    computedTierLabel: stored?.computedTierLabel ?? tierLabel(ctx.model, computedTier),
    tierOverridden: q.priorityTierOverridden,
    modelVersion: q.scoringModelVersion,
    breakdown: safe.breakdown,
    unknowns: safe.unknowns,
  };
}

export function warningsFor(row: QuoteSummaryRow, ctx: QuoteViewContext): QualificationWarning[] {
  return qualificationWarnings(ctx.qualification, {
    quote: {
      est_annual_revenue: row.quote.estAnnualRevenue,
      est_annual_volume: row.quote.estAnnualVolume,
    },
    eng_review: { process_type: row.processType },
  });
}

export function summaryDto(row: QuoteSummaryRow, ctx: QuoteViewContext): QuoteSummary {
  const q = row.quote;
  return {
    id: q.id,
    quoteNumber: q.quoteNumber,
    stageKey: q.stageKey,
    status: q.status,
    version: q.version,
    sfOpportunityId: q.sfOpportunityId,
    opportunityName: row.opportunityName ?? null,
    customerName: row.customerName ?? null,
    customerStatus: row.customerStatus ?? null,
    kamUserId: q.kamUserId,
    kamName: row.kamName ?? null,
    requestClass: q.requestClass,
    productFamily: q.productFamily,
    market: q.market,
    resin: q.resin,
    estAnnualVolume: q.estAnnualVolume,
    estAnnualRevenue: q.estAnnualRevenue,
    expectedCloseDate: q.expectedCloseDate,
    submittedAt: iso(q.submittedAt),
    reviewDate: q.reviewDate,
    priority: priorityDto(q, ctx),
    warnings: warningsFor(row, ctx),
  };
}

/** The domain's available actions, plus what the decision dialog needs to guide the user. */
export function gateActionsFor(
  workflow: WorkflowConfig,
  state: QuoteState,
  ctx: QuoteViewContext,
  warnings: readonly QualificationWarning[],
): AvailableGateAction[] {
  const lapsed = isValidityLapsed(state.fields.validity_until as string | null, ctx.now);
  // B-26: the server-derived fields (Legal review required, pricing pass-through) count as present.
  const derived = withDerivedFields(state, ctx.commercial.derived);
  return availableActions(workflow, derived, ctx.actor, {
    approverTiers: ctx.release.approverTiers,
  }).map((a) => {
    const referenced = a.requiredFields.flatMap(fieldsReferenced);
    const transition = workflow.transitions.find(
      (t) => t.gateKey === a.gateKey && t.outcomeKey === a.outcomeKey,
    );
    // B-13: a rule a note would satisfy that still fails with the validity as it stands (Expired).
    const noteBeforeValidity =
      referenced.includes('decision_note') &&
      evaluateRules(a.requiredFields, { ...derived.fields, validity_lapsed: lapsed }).length > 0;
    const missing = evaluateRules(
      a.requiredFields.filter((r) => !fieldsReferenced(r).some((f) => DECISION_FIELDS.has(f))),
      derived.fields,
    ).map((e) => ({ field: e.field ?? '', message: e.message }));
    return {
      gateKey: a.gateKey,
      gateLabel: a.gateLabel,
      outcomeKey: a.outcomeKey,
      outcomeLabel: a.outcomeLabel,
      requiresNote: a.requiresNote,
      requiresReasonCode: a.requiresReasonCode,
      reasonCodes: a.reasonCodes.map((r) => ({
        ...r,
        requiresNote:
          workflow.reasonCodes.find(
            (c) =>
              c.code === r.code &&
              c.context ===
                workflow.outcomes.find((o) => o.gateKey === a.gateKey && o.key === a.outcomeKey)
                  ?.reasonContext,
          )?.requiresNote ?? false,
      })),
      targetStageKeys: a.targetStageKeys,
      nextStatus: a.nextStatus,
      requiresReviewDate: referenced.includes('review_date'),
      requiresExceptionNote:
        warnings.length > 0 &&
        ctx.qualification.exceptionNoteOutcomes.includes(`${a.gateKey}:${a.outcomeKey}`),
      missing,
      releasesProposal: a.releasesProposal,
      validityDays: a.releasesProposal ? ctx.release.validityDays : null,
      closesAs: a.nextStatus === 'closed' ? (transition?.closeAs ?? null) : null,
      closureOwnerDefault:
        a.nextStatus === 'closed' ? (transition?.closureOwner ?? 'decider') : null,
      requiresAcceptanceDate: referenced.includes('accepted_at'),
      requiresNoteBeforeValidity: noteBeforeValidity,
      requiresHoldOwner: referenced.includes('hold_owner_id'),
      helpText: a.helpText,
    };
  });
}

/** One decision as shown. `quoteVersion` is the quote's current version (for "superseded", CR-38). */
export function decisionDto(
  d: Awaited<ReturnType<typeof listGateDecisionsWithNames>>[number],
  quoteVersion: number,
): GateDecisionSummary {
  return {
    id: d.decision.id,
    gateKey: d.decision.gateKey,
    outcomeKey: d.decision.outcomeKey,
    decidedBy: d.decision.decidedBy,
    decidedByName: d.decidedByName ?? null,
    decidedAt: d.decision.decidedAt.toISOString(),
    note: d.decision.note,
    reasonCode: d.decision.reasonCode,
    quoteVersion: d.decision.quoteVersion,
    superseded: isSupersededDecision(d.decision.quoteVersion, quoteVersion),
  };
}

/** The decision that sent a quote back to the KAM, while it waits for a resubmit. */
export function reworkRequestFor(
  workflow: WorkflowConfig,
  q: QuoteSummaryRow['quote'],
  decisions: readonly GateDecisionSummary[],
  rawDecisions: Awaited<ReturnType<typeof listGateDecisionsWithNames>>,
): ReworkRequest | null {
  if (q.stageKey !== 'INTAKE' || q.submittedAt || q.status === 'closed') return null;
  const idx = rawDecisions.findIndex((d) => d.decision.targetStageKey === 'INTAKE');
  const d = decisions[idx];
  if (!d) return null;
  const context = workflow.outcomes.find(
    (o) => o.gateKey === d.gateKey && o.key === d.outcomeKey,
  )?.reasonContext;
  const reason = workflow.reasonCodes.find((r) => r.code === d.reasonCode && r.context === context);
  return {
    gateKey: d.gateKey,
    reasonCode: d.reasonCode,
    reasonLabel: reason?.label ?? d.reasonCode,
    note: d.note,
    decidedAt: d.decidedAt,
    decidedByName: d.decidedByName,
  };
}

export class QuoteReadService {
  constructor(private readonly scoring: ScoringService) {}

  async context(db: DbOrTx, actor: Actor, now: Date): Promise<QuoteViewContext> {
    const [
      model,
      qualification,
      kamCanSeePeerScores,
      overrides,
      engQueue,
      release,
      outcome,
      commercial,
    ] = await Promise.all([
      this.scoring.model(db, now),
      this.scoring.qualificationSettings(db),
      this.scoring.kamCanSeePeerScores(db),
      loadOverrideSettings(db),
      loadEngQueueSettings(db),
      loadReleaseSettings(db),
      loadOutcomeSettings(db),
      loadCommercialSettings(db),
    ]);
    return {
      actor,
      model,
      qualification,
      kamCanSeePeerScores,
      overrides,
      engQueue,
      release,
      outcome,
      commercial,
      now,
    };
  }

  /** The quote's detail DTO, or undefined when it does not exist or is out of the caller's scope (RLS). */
  async detail(
    db: DbOrTx,
    workflow: WorkflowConfig,
    ctx: QuoteViewContext,
    quoteNumber: string,
  ): Promise<QuoteDetail | undefined> {
    const row = await getQuoteSummaryByNumber(db, quoteNumber);
    if (!row) return undefined;
    const q = row.quote;
    const [state, raw] = await Promise.all([
      loadQuoteState(db, q.id),
      listGateDecisionsWithNames(db, q.id),
    ]);
    const summary = summaryDto(row, ctx);
    const decisions = raw.map((d) => decisionDto(d, q.version));
    const structured = (q.structuredDescription ?? {}) as { standard?: string | null };
    const shipTo = q.shipTo as QuoteDetail['shipTo'];
    return {
      ...summary,
      description: q.description,
      standardDescription: structured.standard ?? null,
      components: q.components,
      drawingStatus: q.drawingStatus,
      neckFinish: q.neckFinish,
      packagingType: q.packagingType,
      packagingNotes: q.packagingNotes,
      commentsForEngineering: q.commentsForEngineering,
      shipTo: shipTo ?? null,
      outcome: q.outcome,
      outcomeReasonCode: q.outcomeReasonCode,
      closedAt: iso(q.closedAt),
      proposalIssuedAt: iso(q.proposalIssuedAt),
      validityUntil: q.validityUntil,
      decisions,
      availableActions: gateActionsFor(workflow, state!, ctx, summary.warnings),
      rework: reworkRequestFor(workflow, q, decisions, raw),
      overridableFields: await quoteOverridableFields(
        db,
        { actor: ctx.actor, settings: ctx.overrides, kamCanSeePeerScores: ctx.kamCanSeePeerScores },
        { ...q, accountId: state?.accountId ?? null },
      ),
      engineering: await engineeringView(db, ctx.actor, ctx.engQueue, q, state!),
      quoting: await quotingView(db, ctx.actor, workflow, q, state!),
      customerDecision: await customerDecisionView(db, {
        actor: ctx.actor,
        workflow,
        settings: ctx.outcome,
        now: ctx.now,
        quote: q,
        state: state!,
        sfStage: row.sfStage,
        decisions: raw,
      }),
      commercial: await commercialView(db, ctx.actor, ctx.commercial, q, state!),
    };
  }
}
