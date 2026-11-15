import type { Tx } from '@ccq/db';
import {
  getEngReview,
  getQuoteForUpdate,
  insertActivityEvent,
  listUsersByIds,
  setLeadReview,
  upsertEngReview,
  type Quote,
} from '@ccq/db/repos';
import {
  capacityBlockedNote,
  planCapacityBlocked,
  type Actor,
  type CapacitySignoffStatus,
  type QuoteState,
} from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

import { deliverPlanned, endSentence } from './handoff-notifications';
import { recordAudit, type AuditMeta } from '../plugins/audit';

/**
 * The capacity sign-off as it is written (B-26; FB-16, W13-17 and W13-18). One place for the three ways
 * it is recorded, so each leaves the same trail (the `eng_review` columns, a timeline entry and an audit
 * row, all in the caller's transaction):
 *
 * - the Capacity sign-off card (PUT /quotes/:qn/capacity-signoff): approve, block or undo;
 * - a block, which also returns the work to the engineer at once (`returnForCapacityBlock`);
 * - the engineering lead's "Capacity approved (I'm signing it off)" inside the G2 decision.
 */

/** The editable eng_review columns of a row (or all null), in the DTO's camelCase. */
export function reviewColumns(eng: Awaited<ReturnType<typeof getEngReview>>) {
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
    equipmentBomNotes: eng?.equipmentBomNotes ?? null,
    supplyChainNotes: eng?.supplyChainNotes ?? null,
    twoStep: eng?.twoStep ?? false,
    preformPlantCode: eng?.preformPlantCode ?? null,
    blowPlantCode: eng?.blowPlantCode ?? null,
    preformNumber: eng?.preformNumber ?? null,
    twoStepFreightNote: eng?.twoStepFreightNote ?? null,
    unitsPerBag: eng?.unitsPerBag ?? null,
    unitsPerTray: eng?.unitsPerTray ?? null,
    unitsPerCase: eng?.unitsPerCase ?? null,
    unitsPerPallet: eng?.unitsPerPallet ?? null,
    acceptedAt: eng?.acceptedAt ?? null,
    acceptedBy: eng?.acceptedBy ?? null,
    returnedReason: eng?.returnedReason ?? null,
    capacitySignoffStatus: eng?.capacitySignoffStatus ?? null,
    capacitySignoffBy: eng?.capacitySignoffBy ?? null,
    capacitySignoffAt: eng?.capacitySignoffAt ?? null,
    capacitySignoffNote: eng?.capacitySignoffNote ?? null,
  };
}

/**
 * Write the sign-off (or clear it, `status: null`) with its timeline entry and audit row. The caller has
 * already checked the permission and the rules (`planCapacitySignoff`, or `canApproveCapacityInDecision`
 * for the G2 decision).
 */
export async function writeCapacitySignoff(
  tx: Tx,
  actor: Actor,
  meta: AuditMeta,
  quoteId: string,
  input: { status: CapacitySignoffStatus | null; note: string | null },
  now: Date,
  /** FB-16 (W13-18): recorded as part of the G2 decision (the timeline says so). */
  { inDecision = false }: { inDecision?: boolean } = {},
): Promise<void> {
  const eng = await getEngReview(tx, quoteId);
  const before = {
    status: eng?.capacitySignoffStatus ?? null,
    note: eng?.capacitySignoffNote ?? null,
  };
  await upsertEngReview(tx, {
    ...reviewColumns(eng),
    quoteId,
    capacitySignoffStatus: input.status,
    capacitySignoffBy: input.status ? actor.userId : null,
    capacitySignoffAt: input.status ? now : null,
    capacitySignoffNote: input.note,
    createdBy: eng?.createdBy ?? actor.userId,
  });
  const [me] = await listUsersByIds(tx, [actor.userId]);
  await insertActivityEvent(tx, {
    quoteId,
    type: 'capacity_signoff',
    actorId: actor.userId,
    at: now,
    payload: {
      status: input.status,
      note: input.note,
      byName: me?.displayName ?? null,
      ...(inDecision ? { inDecision: true } : {}),
    },
    createdBy: actor.userId,
  });
  await recordAudit(tx, actor, meta, {
    action: 'update',
    entity: 'eng_review',
    entityId: eng?.id ?? null,
    quoteId,
    before,
    after: { status: input.status, note: input.note, ...(inDecision ? { inDecision: true } : {}) },
    at: now,
  });
}

/**
 * FB-16 (W13-17): a capacity block sends the work straight back to the engineer, in the block's own
 * transaction. It ends any submitted-to-lead state and records the return with the blocker's note (the
 * same columns and lock rules as a lead's send-back, reason "Capacity blocked"), then tells the engineer
 * (in-app and email), the engineering lead when someone else blocked, and the KAM (in-app only). The
 * quote stays in Engineering and active; no gate decision is recorded.
 */
export async function returnForCapacityBlock(
  tx: Tx,
  actor: Actor,
  meta: AuditMeta,
  q: Quote,
  state: Pick<QuoteState, 'kamUserId' | 'assignedEngineerId' | 'assignedSchedulerId'>,
  note: string,
  now: Date,
  log?: FastifyBaseLogger,
): Promise<void> {
  // The same row lock as submit and send-back: a block and a submit never interleave.
  await getQuoteForUpdate(tx, q.id);
  const returnNote = capacityBlockedNote(note);
  await setLeadReview(tx, q.id, 'engineering', {
    submittedAt: null,
    submittedBy: null,
    returnedAt: now,
    returnedBy: actor.userId,
    returnNote,
    returnedTo: q.assignedEngineerId,
  });
  await recordAudit(tx, actor, meta, {
    action: 'update',
    entity: 'quote',
    entityId: q.id,
    quoteId: q.id,
    before: {
      engineeringSubmittedAt: q.engSubmittedAt ? q.engSubmittedAt.toISOString() : null,
      engineeringSubmittedBy: q.engSubmittedBy,
    },
    after: {
      engineeringSubmittedAt: null,
      engineeringReturnedAt: now.toISOString(),
      engineeringReturnNote: returnNote,
      engineeringReturnedTo: q.assignedEngineerId,
    },
    changeReason: 'Capacity blocked: the work returns to the engineer',
    at: now,
  });
  const [me] = await listUsersByIds(tx, [actor.userId]);
  const blocker = me?.displayName ?? null;
  const n = q.quoteNumber;
  await deliverPlanned(
    tx,
    planCapacityBlocked({
      kamUserId: state.kamUserId,
      assignedEngineerId: state.assignedEngineerId ?? null,
      assignedSchedulerId: state.assignedSchedulerId ?? null,
    }),
    actor.userId,
    (d) =>
      d.type === 'quote.capacity_blocked'
        ? {
            title: d.asAssignee
              ? `${n}: capacity is blocked and the work is back with you`
              : `${n}: capacity is blocked`,
            // The note is in the in-app body only; the email carries the facts and a link.
            body: [
              `${blocker ?? 'The capacity owner'} blocked capacity: ${endSentence(note)}`,
              ...(d.asAssignee ? ['Rework the solution, then submit it again.'] : []),
            ].join(' '),
            payload: {
              ...(blocker ? { actor: blocker } : {}),
              ...(d.asAssignee ? { assignee: 'yes' } : {}),
            },
          }
        : {
            title: `Capacity is blocked on ${n}; Engineering is reworking it`,
            body: `${blocker ?? 'The capacity owner'} blocked capacity. The quote stays in Engineering while the engineer reworks it.`,
            payload: { kind: 'engineering', ...(blocker ? { actor: blocker } : {}) },
          },
    q.id,
    { log, at: now },
  );
}
