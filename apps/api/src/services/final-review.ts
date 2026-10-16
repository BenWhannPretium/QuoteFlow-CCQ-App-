import {
  FINAL_REVIEW_PROBLEM_CODES,
  type FinalReviewItem,
  type FinalReviewQueueFilters,
  type FinalReviewQueueResponse,
  type ReviewSummary,
} from '@ccq/contracts';
import type { DbOrTx, Tx } from '@ccq/db';
import {
  getPricingRecord,
  getQuoteSummaryByNumber,
  listAttachments,
  listGateDecidersForQuotes,
  listGateDecisionsWithNames,
  listHoldsForQuotes,
  listPricingQueueRows,
  listUsersByIds,
  loadQuoteState,
  loadWorkflowConfigInput,
  type PricingQueueRow,
} from '@ccq/db/repos';
import {
  FINAL_REVIEW_FLAGGED_G2,
  FINAL_REVIEW_STAGE_KEY,
  RELEASE_GATE_KEY,
  approverRequirement,
  asQuoteId,
  asUserId,
  can,
  canSeeCommercialFields,
  computeTimeInStage,
  filterFinalReviewQueue,
  finalReviewAvailability,
  parseWorkflowConfig,
  priceApprovalStatus,
  quotingWarnings,
  redact,
  reviewWarnings,
  sortFinalReviewQueue,
  type Actor,
  type FinalReviewEntry,
  type ProposalReleasePlan,
  type QuoteState,
  type TransitionEffects,
  type WorkflowConfig,
} from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

import { engineeringView } from './engineering-view';
import { persistNotifications } from './notifications';
import { quotingView, recordValues } from './pricing-view';
import { ServiceProblem } from './problem';
import { decisionDto, gateActionsFor, summaryDto, type QuoteReadService } from './quotes';

export type FinalReviewWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export class FinalReviewError extends ServiceProblem {
  override name = 'FinalReviewError';
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export interface FinalReviewServiceOptions {
  quotes: QuoteReadService;
  now?: () => Date;
}

/** "Product summary" for the queue: the standard description, else the free text, truncated. */
export function productSummary(
  q: Pick<PricingQueueRow['quote'], 'structuredDescription' | 'description'>,
): string | null {
  const structured = (q.structuredDescription ?? {}) as { standard?: string | null };
  const text = structured.standard?.trim() || q.description?.trim() || null;
  return text && text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

/**
 * B-12 Final Review: the approvals queue (`GET /approvals?gate=G4`) and the one-page review summary.
 * Both only READ. The G4 decision itself goes through the generic gate route (`GateService.decide`),
 * and every rule (segregation, approver tier, note + reason, proposal dates) is the domain's.
 */
export class FinalReviewService {
  private readonly now: () => Date;

  constructor(private readonly opts: FinalReviewServiceOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  private static async workflow(tx: DbOrTx): Promise<WorkflowConfig> {
    return parseWorkflowConfig(await loadWorkflowConfigInput(tx));
  }

  /** Quotes waiting for the G4 decision (in scope, RLS), highest tier first, then the longest waiting. */
  async queue(
    withTx: FinalReviewWithTx,
    actor: Actor,
    query: FinalReviewQueueFilters,
  ): Promise<FinalReviewQueueResponse> {
    const now = this.now();
    return withTx(async (tx) => {
      const [ctx, workflow] = await Promise.all([
        this.opts.quotes.context(tx, actor, now),
        FinalReviewService.workflow(tx),
      ]);
      const gate = workflow.gates.find((g) => g.key === RELEASE_GATE_KEY);
      if (!gate) {
        throw new FinalReviewError(404, FINAL_REVIEW_PROBLEM_CODES.notFound, 'No gate G4');
      }
      const tierOrder = [...(ctx.model?.tiers ?? [])]
        .sort((a, b) => b.min - a.min)
        .map((t) => t.key);
      const rows = gate.enabled ? await listPricingQueueRows(tx, gate.stageKey) : [];
      const ids = rows.map((r) => r.quote.id);
      const [holds, g3, people] = await Promise.all([
        listHoldsForQuotes(tx, ids),
        listGateDecidersForQuotes(tx, ids, 'G3'),
        listUsersByIds(
          tx,
          rows.map((r) => r.pricing?.priceApprovedBy).filter((id): id is string => !!id),
        ),
      ]);
      const g2Label = (key: string | null) =>
        key
          ? (workflow.outcomes.find((o) => o.gateKey === 'G2' && o.key === key)?.label ?? key)
          : null;

      const all = rows.map((row) => {
        const q = row.quote;
        const summary = summaryDto(row, ctx);
        const entered = row.enteredStageAt ?? q.updatedAt;
        const [stay] = computeTimeInStage(
          [{ stageKey: q.stageKey, enteredAt: entered, exitedAt: null }],
          holds.filter((h) => h.quoteId === q.id),
          now,
        );
        const record = recordValues(row.pricing);
        const status = priceApprovalStatus(record);
        const approverName =
          (status.approvedById && people.find((p) => p.id === status.approvedById)?.displayName) ||
          null;
        // The domain's view of this quote for the segregation + tier checks (same inputs as G4).
        const state: QuoteState = {
          id: asQuoteId(q.id),
          stageKey: q.stageKey,
          status: q.status as QuoteState['status'],
          version: q.version,
          kamUserId: asUserId(q.kamUserId),
          assignedEngineerId: q.assignedEngineerId ? asUserId(q.assignedEngineerId) : null,
          ...(q.region ? { region: q.region } : {}),
          ...(row.accountId ? { accountId: row.accountId } : {}),
          fields: {
            prelim_capital_usd: row.prelimCapitalUsd,
            est_annual_revenue: q.estAnnualRevenue,
          },
          holds: [],
          priceApproverIds: [
            ...new Set(
              [
                status.approvedById,
                ...g3
                  .filter((d) => d.quoteId === q.id && d.quoteVersion === q.version)
                  .map((d) => d.decidedBy),
              ].filter((id): id is string => !!id),
            ),
          ].map(asUserId),
        };
        const availability = finalReviewAvailability(workflow, state, actor, {
          approverTiers: ctx.release.approverTiers,
        });
        const item: FinalReviewItem = {
          ...summary,
          enteredStageAt: iso(entered),
          waitingMs: stay?.activeMs ?? 0,
          productSummary: productSummary(q),
          g2Outcome: row.g2Outcome,
          g2OutcomeLabel: g2Label(row.g2Outcome),
          g2Flag: (FINAL_REVIEW_FLAGGED_G2 as readonly string[]).includes(row.g2Outcome ?? ''),
          capitalReadiness: record?.capitalReadiness ?? null,
          priceApproved: status.approved,
          priceApprovedAt: iso(status.approvedAt),
          priceApproverId: status.approvedById,
          priceApproverName: approverName,
          canDecide: availability.canDecide,
          blockedBy: availability.blockedBy,
        };
        const entry: FinalReviewEntry = {
          quoteNumber: q.quoteNumber,
          tier: summary.priority.tier,
          score: summary.priority.score,
          waitingMs: item.waitingMs,
          g2Outcome: row.g2Outcome,
          capitalReadiness: item.capitalReadiness ?? null,
          kamUserId: q.kamUserId,
          searchText: [
            q.quoteNumber,
            q.sfOpportunityId,
            row.customerName,
            row.opportunityName,
            row.kamName,
            approverName,
            ...(record?.erfRefs ?? []),
            ...(record?.bprRefs ?? []),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase(),
        };
        return { ...entry, item };
      });

      const sorted = sortFinalReviewQueue(all, tierOrder);
      const filtered = filterFinalReviewQueue(sorted, {
        ...(query.tier ? { tiers: query.tier } : {}),
        ...(query.g2 ? { g2Outcomes: query.g2 } : {}),
        ...(query.capital ? { capitalReadiness: query.capital } : {}),
        ...(query.kam ? { kamUserId: query.kam === 'me' ? actor.userId : query.kam } : {}),
        ...(query.q ? { q: query.q } : {}),
      });
      return {
        gate: { key: gate.key, label: gate.label, stageKey: gate.stageKey, enabled: gate.enabled },
        stage: {
          key: gate.stageKey,
          label: workflow.stages.find((s) => s.key === gate.stageKey)?.label ?? gate.stageKey,
        },
        total: all.length,
        counts: {
          flagged: all.filter((e) => e.item.g2Flag).length,
          capitalPending: all.filter((e) => e.capitalReadiness === 'pending').length,
          decidable: all.filter((e) => e.item.canDecide).length,
        },
        canDecide: can(actor, gate.deciderPermission),
        g2Outcomes: workflow.outcomes
          .filter((o) => o.gateKey === 'G2')
          .map((o) => ({ key: o.key, label: o.label })),
        // Belt and braces: every role on this route reads commercial fields, but redact anyway.
        items: filtered.map((e) => redact(e.item, actor)),
      };
    });
  }

  /**
   * The one-page snapshot an approver decides from: intake, score breakdown, engineering solution and
   * capacity evidence, price approval with basis and range note, capital readiness, attachments, open
   * warnings and the decisions so far. Commercial parts are redacted per role (architecture §3.3).
   */
  async reviewSummary(
    withTx: FinalReviewWithTx,
    actor: Actor,
    quoteNumber: string,
  ): Promise<ReviewSummary> {
    const now = this.now();
    return withTx(async (tx) => {
      const [ctx, workflow] = await Promise.all([
        this.opts.quotes.context(tx, actor, now),
        FinalReviewService.workflow(tx),
      ]);
      const row = await getQuoteSummaryByNumber(tx, quoteNumber);
      if (!row) {
        throw new FinalReviewError(
          404,
          FINAL_REVIEW_PROBLEM_CODES.notFound,
          `No quote ${quoteNumber}`,
        );
      }
      const q = row.quote;
      const [state, raw, attachments, pricing] = await Promise.all([
        loadQuoteState(tx, q.id),
        listGateDecisionsWithNames(tx, q.id),
        listAttachments(tx, q.id),
        getPricingRecord(tx, q.id),
      ]);
      const quoteState = state!;
      const summary = summaryDto(row, ctx);
      const commercial = canSeeCommercialFields(actor);
      const [engineering, quoting] = await Promise.all([
        engineeringView(tx, actor, ctx.engQueue, q, quoteState),
        quotingView(tx, actor, workflow, q, quoteState),
      ]);
      const uploaders = await listUsersByIds(tx, [
        ...new Set(attachments.map((a) => a.uploadedBy)),
      ]);

      const decisions = raw.map((d) => decisionDto(d, q.version));
      const g2 = decisions.find((d) => d.gateKey === 'G2');
      const record = recordValues(pricing);
      const requirement = commercial
        ? approverRequirement(ctx.release.approverTiers, quoteState.fields, actor)
        : null;
      const availability = finalReviewAvailability(workflow, quoteState, actor, {
        approverTiers: ctx.release.approverTiers,
      });
      const warnings = reviewWarnings({
        qualification: summary.warnings,
        // The quoting warnings read the pricing record, which is commercial.
        quoting: commercial ? quotingWarnings(record) : [],
        g2Outcome: g2?.outcomeKey ?? null,
        g2Note: g2?.note ?? null,
        priceApproved: priceApprovalStatus(record).approved,
        capacityEvidenceRows: engineering.capacityEvidence.length,
        requirement,
      });

      const structured = (q.structuredDescription ?? {}) as { standard?: string | null };
      const result: ReviewSummary = {
        quote: summary,
        intake: {
          description: q.description,
          standardDescription: structured.standard ?? null,
          components: q.components,
          drawingStatus: q.drawingStatus,
          neckFinish: q.neckFinish,
          packagingType: q.packagingType,
          packagingNotes: q.packagingNotes,
          commentsForEngineering: q.commentsForEngineering,
          shipTo: (q.shipTo as ReviewSummary['intake']['shipTo']) ?? null,
        },
        engineering,
        quoting,
        attachments: attachments.map((a) => ({
          id: a.id,
          kind: a.kind,
          fileName: a.fileName,
          size: a.size,
          mime: a.mime,
          uploadedByName: uploaders.find((u) => u.id === a.uploadedBy)?.displayName ?? null,
          uploadedAt: a.createdAt.toISOString(),
          webUrl: a.spWebUrl,
        })),
        warnings,
        decisions,
        proposal: {
          issuedAt: iso(q.proposalIssuedAt),
          validityUntil: q.validityUntil,
          validityDaysDefault: ctx.release.validityDays,
        },
        inFinalReview: q.stageKey === FINAL_REVIEW_STAGE_KEY && q.status !== 'closed',
        availableActions: gateActionsFor(workflow, quoteState, ctx, summary.warnings).filter(
          (a) => a.gateKey === RELEASE_GATE_KEY,
        ),
        canDecide: availability.canDecide,
        blockedBy: availability.blockedBy,
        requirement,
        commercialRedacted: !commercial,
      };
      return result;
    });
  }
}

/**
 * In-app notices for a Final Review decision (email is B-18), written in the decision's transaction:
 * - Approve → the KAM: "Approved; issue the proposal." with the validity date.
 * - Decline → the KAM and Pricing, with the decline reason (the note stays on the decision).
 * A Return is announced by the arrival alert of the stage it goes back to.
 */
export async function onFinalReviewDecided(
  tx: DbOrTx,
  input: {
    quote: { id: string; quoteNumber: string };
    actorId: string;
    effects: TransitionEffects;
    workflow: WorkflowConfig;
    proposal: Extract<ProposalReleasePlan, { ok: true }> | null;
  },
  log?: FastifyBaseLogger,
): Promise<number> {
  const { quote, effects, workflow, proposal } = input;
  if (proposal) {
    return persistNotifications(
      tx,
      effects.notifications,
      {
        quoteId: quote.id,
        title: `${quote.quoteNumber} is approved: issue the proposal`,
        body: `Approved; issue the proposal. It is valid until ${proposal.validityUntil}.`,
        excludeUserId: input.actorId,
      },
      log,
    );
  }
  if (effects.nextStatus === 'closed') {
    const record = effects.gateDecisionRecord;
    const outcome = workflow.outcomes.find(
      (o) => o.gateKey === record.gateKey && o.key === record.outcomeKey,
    );
    const reason = workflow.reasonCodes.find(
      (r) => r.code === record.reasonCode && r.context === outcome?.reasonContext,
    );
    return persistNotifications(
      tx,
      effects.notifications,
      {
        quoteId: quote.id,
        title: `${quote.quoteNumber} was declined at Final Review`,
        body: `Reason: ${reason?.label ?? record.reasonCode ?? 'not given'}. Open the quote for the approver's note.`,
        excludeUserId: input.actorId,
      },
      log,
    );
  }
  return 0;
}
