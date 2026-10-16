import { asQuoteId, asUserId, computeHoldMs, toSnakeCase } from '@ccq/domain';
import type { HoldInterval, QuoteState, Role, TransitionEffects } from '@ccq/domain';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { first } from './_util';
import type { Quote } from './quotes';
import { listHolds } from './records';
import {
  activityEvent,
  auditEvent,
  capacityEvidence,
  customer,
  engReview,
  gateDecision,
  pricingRecord,
  quote,
  quoteHold,
  stageHistory,
} from '../schema/index';

/** The stage a KAM's intake lives in (B-07 creates quotes there). */
export const INTAKE_STAGE_KEY = 'INTAKE';

const snake = (row: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [toSnakeCase(key), value]));

/**
 * Assemble the domain's `QuoteState` for a quote: its columns plus the related records the
 * required-field rules look at (eng review fields flattened, `capacity_evidence[]`, `pricing_record{}`).
 * Pure data assembly; the domain decides what is required.
 */
export async function loadQuoteState(db: DbOrTx, quoteId: string): Promise<QuoteState | undefined> {
  return (await loadQuoteStates(db, [quoteId])).get(quoteId);
}

/**
 * `loadQuoteState` for many quotes with one query per table (B-14: the board asks the domain for each
 * card's available actions). Quotes outside the caller's scope (RLS) are simply absent from the map.
 */
export async function loadQuoteStates(
  db: DbOrTx,
  quoteIds: readonly string[],
): Promise<Map<string, QuoteState>> {
  const states = new Map<string, QuoteState>();
  const ids = [...new Set(quoteIds)];
  if (ids.length === 0) return states;
  const rows = await db.select().from(quote).where(inArray(quote.id, ids));
  if (rows.length === 0) return states;
  const found = rows.map((r) => r.id);
  const customerIds = [
    ...new Set(rows.map((r) => r.customerId).filter((id): id is string => !!id)),
  ];
  const [engs, capacity, pricing, holds, decisions, customers] = await Promise.all([
    db.select().from(engReview).where(inArray(engReview.quoteId, found)),
    db
      .select()
      .from(capacityEvidence)
      .where(inArray(capacityEvidence.quoteId, found))
      .orderBy(asc(capacityEvidence.analysisDate)),
    db
      .select({ record: pricingRecord })
      .from(pricingRecord)
      .innerJoin(quote, eq(quote.id, pricingRecord.quoteId))
      .where(
        and(inArray(pricingRecord.quoteId, found), eq(pricingRecord.quoteVersion, quote.version)),
      ),
    db
      .select({
        quoteId: quoteHold.quoteId,
        startedAt: quoteHold.startedAt,
        endedAt: quoteHold.endedAt,
      })
      .from(quoteHold)
      .where(inArray(quoteHold.quoteId, found))
      .orderBy(asc(quoteHold.startedAt)),
    db
      .select({
        quoteId: gateDecision.quoteId,
        gateKey: gateDecision.gateKey,
        outcomeKey: gateDecision.outcomeKey,
        decidedBy: gateDecision.decidedBy,
        quoteVersion: gateDecision.quoteVersion,
      })
      .from(gateDecision)
      .where(inArray(gateDecision.quoteId, found))
      .orderBy(desc(gateDecision.decidedAt), desc(gateDecision.id)),
    customerIds.length
      ? db
          .select({ id: customer.id, sfAccountId: customer.sfAccountId })
          .from(customer)
          .where(inArray(customer.id, customerIds))
      : Promise.resolve([]),
  ]);
  const byQuote = <T extends { quoteId: string }>(list: T[]) => {
    const map = new Map<string, T[]>();
    for (const item of list) {
      const bucket = map.get(item.quoteId);
      if (bucket) bucket.push(item);
      else map.set(item.quoteId, [item]);
    }
    return map;
  };
  const engBy = new Map(engs.map((e) => [e.quoteId, e]));
  const capacityBy = byQuote(capacity);
  const pricingBy = new Map(pricing.map((p) => [p.record.quoteId, p.record]));
  const holdsBy = byQuote(holds);
  const decisionsBy = byQuote(decisions);
  const accountBy = new Map(customers.map((c) => [c.id, c.sfAccountId]));

  for (const row of rows) {
    const {
      id: _e,
      quoteId: _q,
      createdAt: _c,
      updatedAt: _u,
      createdBy: _b,
      ...engFields
    } = engBy.get(row.id) ?? {};
    const pricingRow = pricingBy.get(row.id);
    const quoteDecisions = decisionsBy.get(row.id) ?? [];
    const fields: Record<string, unknown> = {
      ...snake(row),
      ...snake(engFields),
      capacity_evidence: (capacityBy.get(row.id) ?? []).map(snake),
      pricing_record: pricingRow ? snake(pricingRow) : null,
      // B-11: Engineering's latest feasibility outcome (e.g. capital_required) for the Quoting rules.
      g2_outcome: quoteDecisions.find((d) => d.gateKey === 'G2')?.outcomeKey ?? null,
    };
    // B-11: who acted as Pricing on this version (segregation `actor_is_price_approver`).
    const priceApproverIds = [
      ...new Set(
        [
          pricingRow?.priceApprovedBy,
          ...quoteDecisions
            .filter((d) => d.gateKey === 'G3' && d.quoteVersion === row.version)
            .map((d) => d.decidedBy),
        ].filter((id): id is string => !!id),
      ),
    ].map(asUserId);
    const accountId = row.customerId ? accountBy.get(row.customerId) : undefined;
    states.set(row.id, {
      id: asQuoteId(row.id),
      stageKey: row.stageKey,
      status: row.status as QuoteState['status'],
      version: row.version,
      kamUserId: asUserId(row.kamUserId),
      assignedEngineerId: row.assignedEngineerId ? asUserId(row.assignedEngineerId) : null,
      ...(row.region ? { region: row.region } : {}),
      ...(accountId ? { accountId } : {}),
      fields,
      holds: (holdsBy.get(row.id) ?? []).map((h): HoldInterval => ({
        startedAt: h.startedAt,
        endedAt: h.endedAt,
      })),
      priceApproverIds,
    });
  }
  return states;
}

export interface PersistTransitionAudit {
  actorRoles: readonly Role[];
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * Persist what `evaluateTransition` decided, inside the caller's transaction: gate_decision,
 * hold interval, stage_history exit/enter, the quote row, activity events and the audit row.
 * Notifications are returned in `effects.notifications` for the caller (B-18) to deliver.
 */
export async function persistTransition(
  db: DbOrTx,
  effects: TransitionEffects,
  audit: PersistTransitionAudit,
): Promise<Quote> {
  const record = effects.gateDecisionRecord;
  const quoteId = record.quoteId;
  const at = record.decidedAt;

  await db.insert(gateDecision).values({
    quoteId,
    gateKey: record.gateKey,
    outcomeKey: record.outcomeKey,
    decidedBy: record.decidedBy,
    decidedAt: at,
    note: record.note,
    reasonCode: record.reasonCode,
    targetStageKey: record.targetStageKey,
    quoteVersion: record.quoteVersion,
    evidence: record.evidence,
    payload: record.payload,
    createdBy: record.decidedBy,
  });

  if (effects.hold.action === 'start') {
    await db.insert(quoteHold).values({
      quoteId,
      stageKey: effects.fromStageKey,
      startedAt: effects.hold.at,
      reasonCode: record.reasonCode,
      createdBy: record.decidedBy,
    });
  } else if (effects.hold.action === 'end') {
    await db
      .update(quoteHold)
      .set({ endedAt: effects.hold.at })
      .where(and(eq(quoteHold.quoteId, quoteId), isNull(quoteHold.endedAt)));
  }

  if (effects.stageHistory.exit) {
    const open = first(
      await db
        .select()
        .from(stageHistory)
        .where(and(eq(stageHistory.quoteId, quoteId), isNull(stageHistory.exitedAt))),
    );
    if (open) {
      const holds = await listHolds(db, quoteId);
      const exitedAt = effects.stageHistory.exit.exitedAt;
      const onHoldMs = computeHoldMs(holds, open.enteredAt, exitedAt, exitedAt);
      await db.update(stageHistory).set({ exitedAt, onHoldMs }).where(eq(stageHistory.id, open.id));
    }
  }
  if (effects.stageHistory.enter) {
    await db.insert(stageHistory).values({
      quoteId,
      stageKey: effects.stageHistory.enter.stageKey,
      enteredAt: effects.stageHistory.enter.enteredAt,
      enteredBy: record.decidedBy,
      quoteVersion: effects.nextVersion,
      createdBy: record.decidedBy,
    });
  }

  const closing = effects.nextStatus === 'closed';
  if (closing && !effects.closure) {
    throw new Error('A closing transition must carry its closure (CR-39): use evaluateTransition');
  }
  // Re-entering INTAKE (a G1/G2 Rework) hands the quote back to the KAM: it is no longer submitted
  // until they resubmit it from a rework draft (B-08). The original submit stays in stage_history.
  const backToKam = effects.stageHistory.enter?.stageKey === INTAKE_STAGE_KEY;
  const [updated] = await db
    .update(quote)
    .set({
      stageKey: effects.nextStageKey,
      status: effects.nextStatus,
      version: effects.nextVersion,
      ...(backToKam ? { submittedAt: null } : {}),
      // B-13 (CR-39): the domain planned every closure field; the CHECK constraint repeats the rule.
      ...(closing && effects.closure
        ? {
            outcome: effects.closure.outcome,
            outcomeReasonCode: effects.closure.outcomeReasonCode,
            closureOwnerId: effects.closure.closureOwnerId,
            closedAt: effects.closure.closedAt,
          }
        : {}),
    })
    .where(eq(quote.id, quoteId))
    .returning();

  if (effects.activityEvents.length > 0) {
    await db.insert(activityEvent).values(
      effects.activityEvents.map((e) => ({
        quoteId,
        type: e.type,
        actorId: e.actorId,
        at: e.at,
        payload: e.payload,
        createdBy: e.actorId,
      })),
    );
  }

  await db.insert(auditEvent).values({
    at,
    actorId: record.decidedBy,
    actorRoles: [...audit.actorRoles],
    action: effects.stageHistory.enter ? 'stage_change' : 'gate_decision',
    entity: 'quote',
    entityId: quoteId,
    quoteId,
    before: { stageKey: effects.fromStageKey, version: record.quoteVersion },
    after: {
      stageKey: effects.nextStageKey,
      status: effects.nextStatus,
      version: effects.nextVersion,
      gateKey: record.gateKey,
      outcomeKey: record.outcomeKey,
    },
    ip: audit.ip ?? null,
    userAgent: audit.userAgent ?? null,
    requestId: audit.requestId ?? null,
    createdBy: record.decidedBy,
  });

  return updated!;
}
