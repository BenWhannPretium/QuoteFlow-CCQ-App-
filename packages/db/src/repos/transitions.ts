import { asQuoteId, asUserId, computeHoldMs, toSnakeCase } from '@ccq/domain';
import type { HoldInterval, QuoteState, Role, TransitionEffects } from '@ccq/domain';
import { and, eq, isNull } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { first } from './_util';
import { getQuoteById } from './quotes';
import type { Quote } from './quotes';
import { getEngReview, getPricingRecord, listCapacityEvidence, listHolds } from './records';
import {
  activityEvent,
  auditEvent,
  customer,
  gateDecision,
  quote,
  quoteHold,
  stageHistory,
} from '../schema/index';

const snake = (row: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [toSnakeCase(key), value]));

/**
 * Assemble the domain's `QuoteState` for a quote: its columns plus the related records the
 * required-field rules look at (eng review fields flattened, `capacity_evidence[]`, `pricing_record{}`).
 * Pure data assembly; the domain decides what is required.
 */
export async function loadQuoteState(db: DbOrTx, quoteId: string): Promise<QuoteState | undefined> {
  const row = await getQuoteById(db, quoteId);
  if (!row) return undefined;
  const [eng, capacity, pricing, holds, cust] = await Promise.all([
    getEngReview(db, quoteId),
    listCapacityEvidence(db, quoteId),
    getPricingRecord(db, quoteId),
    listHolds(db, quoteId),
    row.customerId
      ? db
          .select({ sfAccountId: customer.sfAccountId })
          .from(customer)
          .where(eq(customer.id, row.customerId))
      : Promise.resolve([]),
  ]);
  const {
    id: _e,
    quoteId: _q,
    createdAt: _c,
    updatedAt: _u,
    createdBy: _b,
    ...engFields
  } = eng ?? {};
  const fields: Record<string, unknown> = {
    ...snake(row),
    ...snake(engFields),
    capacity_evidence: capacity.map(snake),
    pricing_record: pricing ? snake(pricing) : null,
  };
  const accountId = first(cust)?.sfAccountId;
  return {
    id: asQuoteId(row.id),
    stageKey: row.stageKey,
    status: row.status as QuoteState['status'],
    version: row.version,
    kamUserId: asUserId(row.kamUserId),
    assignedEngineerId: row.assignedEngineerId ? asUserId(row.assignedEngineerId) : null,
    ...(row.region ? { region: row.region } : {}),
    ...(accountId ? { accountId } : {}),
    fields,
    holds: holds.map((h): HoldInterval => ({ startedAt: h.startedAt, endedAt: h.endedAt })),
  };
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
  const [updated] = await db
    .update(quote)
    .set({
      stageKey: effects.nextStageKey,
      status: effects.nextStatus,
      version: effects.nextVersion,
      ...(closing
        ? {
            outcome: effects.closeAs ?? null,
            outcomeReasonCode: record.reasonCode,
            closureOwnerId: record.decidedBy,
            closedAt: at,
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
