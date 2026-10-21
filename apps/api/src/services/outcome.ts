import {
  OUTCOME_PROBLEM_CODES,
  type HandoffBody,
  type HandoffResponse,
  type MyProposalsResponse,
  type OpenProposal,
  type OutcomesReport,
} from '@ccq/contracts';
import type { DbOrTx, Tx } from '@ccq/db';
import {
  getHandoffRecord,
  getQuoteSummaryByNumber,
  insertActivityEvent,
  listGateDecisionsWithNames,
  listOpenProposals,
  listOutcomeReportRows,
  loadQuoteState,
  loadWorkflowConfigInput,
  updateQuote,
  upsertHandoffRecord,
} from '@ccq/db/repos';
import {
  COMMIT_STAGE_KEY,
  CUSTOMER_DECISION_STAGE_KEY,
  assertCan,
  handoffFromAward,
  parseWorkflowConfig,
  planHandoff,
  sortOpenProposals,
  summarizeOutcomes,
  type Actor,
  type HandoffValues,
  type TransitionEffects,
  type WorkflowConfig,
} from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

import { customerDecisionView, handoffValues, sfStageDto, validityDto } from './outcome-view';
import { ServiceProblem, problemErrors } from './problem';
import { summaryDto, type QuoteReadService } from './quotes';
import { recordAudit, type AuditMeta } from '../plugins/audit';

export type OutcomeWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export class OutcomeError extends ServiceProblem {
  override name = 'OutcomeError';
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export interface OutcomeServiceOptions {
  quotes: QuoteReadService;
  log?: FastifyBaseLogger;
  now?: () => Date;
}

/** The hand-off values as columns (the `handoff_record` row shape). */
function handoffColumns(v: HandoffValues) {
  return {
    acceptanceEvidence: v.acceptanceEvidence,
    acceptanceDate: v.acceptanceDate,
    acceptanceDocumentUrl: v.acceptanceDocumentUrl,
    cerId: v.cerId,
    cerStatus: v.cerStatus,
    cerApprovedOn: v.cerApprovedOn,
    receivingRole: v.receivingRole,
    receivingRoleOther: v.receivingRoleOther,
    receivingContactName: v.receivingContactName,
    acceptedOn: v.acceptedOn,
    notes: v.notes,
    completedAt: v.completedAt,
    completedBy: v.completedBy,
  };
}

/**
 * B-13 customer decision: "My open proposals", the Awarded hand-off record and the outcomes report.
 * The G5 decision itself goes through the generic gate route; `onCustomerOutcome` runs inside that
 * decision's transaction for what follows it (an award opens the hand-off record).
 */
export class OutcomeService {
  private readonly now: () => Date;

  constructor(private readonly opts: OutcomeServiceOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  private static async workflow(tx: DbOrTx): Promise<WorkflowConfig> {
    return parseWorkflowConfig(await loadWorkflowConfigInput(tx));
  }

  /** The caller's quotes waiting for the customer (Customer Decision, on hold included), soonest validity end first. */
  async myProposals(withTx: OutcomeWithTx, actor: Actor): Promise<MyProposalsResponse> {
    const now = this.now();
    return withTx(async (tx) => {
      const [ctx, workflow] = await Promise.all([
        this.opts.quotes.context(tx, actor, now),
        OutcomeService.workflow(tx),
      ]);
      const rows = await listOpenProposals(tx, actor.userId, CUSTOMER_DECISION_STAGE_KEY);
      const items: OpenProposal[] = sortOpenProposals(
        rows.map((row) => ({
          ...summaryDto(row, ctx),
          proposalIssuedAt: iso(row.quote.proposalIssuedAt),
          validityUntil: row.quote.validityUntil,
          validity: validityDto(row.quote.validityUntil, now, ctx.outcome),
          validityExpiredFlaggedAt: iso(row.quote.validityExpiredFlaggedAt),
          sf: sfStageDto(workflow, ctx.outcome, row.quote, row.sfStage),
        })),
      ).map(({ validityUntil: _v, ...item }) => item);
      return {
        items,
        counts: {
          total: items.length,
          expiring: items.filter((i) => i.validity.state === 'expiring').length,
          expired: items.filter((i) => i.validity.state === 'expired').length,
          onHold: items.filter((i) => i.status === 'on_hold').length,
          sfMismatch: items.filter((i) => i.sf.mismatch).length,
        },
      };
    });
  }

  /**
   * PUT /quotes/:qn/handoff: edit the Awarded hand-off record. Only on AWARDED quotes; `handoff.edit`
   * on the quote (the KAM on their own, SalesLeader, Admin). Only the keys sent change. The timeline
   * gets the field names (never values); the audit row keeps before/after.
   */
  async putHandoff(
    withTx: OutcomeWithTx,
    actor: Actor,
    quoteNumber: string,
    body: HandoffBody,
    meta: AuditMeta,
  ): Promise<HandoffResponse> {
    const now = this.now();
    return withTx(async (tx) => {
      const [ctx, workflow] = await Promise.all([
        this.opts.quotes.context(tx, actor, now),
        OutcomeService.workflow(tx),
      ]);
      const row = await getQuoteSummaryByNumber(tx, quoteNumber);
      if (!row) {
        throw new OutcomeError(404, OUTCOME_PROBLEM_CODES.notFound, `No quote ${quoteNumber}`);
      }
      const q = row.quote;
      const state = (await loadQuoteState(tx, q.id))!;
      try {
        assertCan(actor, 'handoff.edit', state);
      } catch {
        throw new OutcomeError(
          403,
          OUTCOME_PROBLEM_CODES.notPermitted,
          'Only the quote’s KAM, a sales leader or an admin can edit the hand-off (handoff.edit)',
        );
      }
      if (ctx.outcome.receivingRolesError && body.receivingRole !== undefined) {
        throw new OutcomeError(
          422,
          OUTCOME_PROBLEM_CODES.rejected,
          ctx.outcome.receivingRolesError,
        );
      }
      const current = await getHandoffRecord(tx, q.id);
      const plan = planHandoff({
        stageKey: q.stageKey,
        current: handoffValues(current),
        edit: body,
        actorId: actor.userId,
        now,
        receivingRoles: ctx.outcome.receivingRoles,
      });
      if (!plan.ok) {
        const status = plan.errors.some((e) => e.code === 'NOT_AWARDED') ? 409 : 422;
        throw new OutcomeError(
          status,
          OUTCOME_PROBLEM_CODES.rejected,
          'The hand-off was not saved',
          {
            errors: problemErrors(plan.errors),
          },
        );
      }

      const saved = await upsertHandoffRecord(tx, {
        quoteId: q.id,
        ...handoffColumns(plan.values),
        updatedBy: actor.userId,
        updatedAt: now,
        createdBy: current?.createdBy ?? actor.userId,
      });
      // The quote carries the CER reference too (architecture §5 "Links"), so lists can show it.
      if (plan.changed.includes('cerId')) {
        await updateQuote(tx, q.id, { cerId: plan.values.cerId });
      }
      if (plan.changed.length > 0 || plan.completion) {
        await insertActivityEvent(tx, {
          quoteId: q.id,
          type: plan.completion === 'completed' ? 'handoff_completed' : 'handoff_updated',
          actorId: actor.userId,
          at: now,
          payload: {
            fields: plan.changed,
            ...(plan.completion ? { completion: plan.completion } : {}),
          },
          createdBy: actor.userId,
        });
        await recordAudit(tx, actor, meta, {
          at: now,
          action: 'update',
          entity: 'handoff_record',
          entityId: saved.id,
          quoteId: q.id,
          before: current ? { ...handoffValues(current) } : null,
          after: { ...plan.values },
        });
      }

      const raw = await listGateDecisionsWithNames(tx, q.id);
      return {
        customerDecision: await customerDecisionView(tx, {
          actor,
          workflow,
          settings: ctx.outcome,
          now,
          quote: q,
          state,
          sfStage: row.sfStage,
          decisions: raw,
        }),
      };
    });
  }

  /** GET /admin/reports/outcomes: counts by outcome and reason, win rate (expired excluded), capture rate. */
  async report(withTx: OutcomeWithTx): Promise<OutcomesReport> {
    const now = this.now();
    return withTx(async (tx) => {
      const workflow = await OutcomeService.workflow(tx);
      const rows = await listOutcomeReportRows(tx);
      const summary = summarizeOutcomes(rows, workflow, now);
      // D-15: the taxonomy is provisional until approved (reason rows carry `provisional`).
      const closingContexts = new Set(
        workflow.transitions
          .filter((t) => t.nextStatus === 'closed')
          .map(
            (t) =>
              workflow.outcomes.find((o) => o.gateKey === t.gateKey && o.key === t.outcomeKey)
                ?.reasonContext,
          ),
      );
      return {
        generatedAt: now.toISOString(),
        ...summary,
        taxonomyProvisional: workflow.reasonCodes.some(
          (r) => closingContexts.has(r.context) && r.provisional,
        ),
      };
    });
  }
}

/**
 * After a Customer Decision (G5), in the decision's transaction: an award opens the hand-off record
 * with the evidence (the reason code), the acceptance date and the document link, so the KAM only adds
 * the CER and who receives it. B-26: the award moves the quote to Commit & Hand Off (it no longer
 * closes it); G6 closes it Won. Returns whether a record was opened.
 */
export async function onCustomerOutcome(
  tx: DbOrTx,
  input: {
    quoteId: string;
    actorId: string;
    effects: TransitionEffects;
    acceptedAt: string | null;
    acceptanceDocumentUrl: string | null;
    now: Date;
  },
): Promise<boolean> {
  const { effects } = input;
  if (effects.stageHistory.enter?.stageKey !== COMMIT_STAGE_KEY) return false;
  const values = handoffFromAward({
    reasonCode: effects.gateDecisionRecord.reasonCode,
    acceptedAt: input.acceptedAt,
    acceptanceDocumentUrl: input.acceptanceDocumentUrl,
  });
  if (!values) return false;
  await upsertHandoffRecord(tx, {
    quoteId: input.quoteId,
    ...handoffColumns(values),
    updatedBy: input.actorId,
    updatedAt: input.now,
    createdAt: input.now,
    createdBy: input.actorId,
  });
  return true;
}
