import type { EngineeringDetail } from '@ccq/contracts';
import type { DbOrTx } from '@ccq/db';
import {
  getEngReview,
  getSetting,
  listCapacityEvidenceWithNames,
  listUsersByIds,
  type Quote,
} from '@ccq/db/repos';
import {
  ENG_QUEUE_SETTINGS_SEED,
  ENG_QUEUE_STAGE_KEY,
  canAssignEngQueue,
  canEditEngReview,
  canSeeCommercialFields,
  parseEngQueueSettings,
  planAccept,
  redact,
  type Actor,
  type EngQueueSettings,
  type QuoteState,
} from '@ccq/domain';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** `eng_queue_aging_days` + `eng_queue_backup_assigner_user_ids`, falling back to the seed. */
export async function loadEngQueueSettings(db: DbOrTx): Promise<EngQueueSettings> {
  const [agingDays, backup] = await Promise.all([
    getSetting(db, 'eng_queue_aging_days'),
    getSetting(db, 'eng_queue_backup_assigner_user_ids'),
  ]);
  return parseEngQueueSettings({
    agingDays: agingDays ?? ENG_QUEUE_SETTINGS_SEED.agingDays,
    backupAssignerUserIds: backup ?? ENG_QUEUE_SETTINGS_SEED.backupAssignerUserIds,
  });
}

/**
 * The quote's Engineering tab: assignment, acceptance, review fields and capacity evidence, with the
 * commercial numbers (prelim capital, capacity figures) stripped by the domain's `redact` for roles
 * without `quote.read.commercialFields` (architecture §3.3). Every quote reader gets it read-only;
 * `canEdit` / `canAccept` / `canAssign` say what the caller may change.
 */
export async function engineeringView(
  db: DbOrTx,
  actor: Actor,
  settings: EngQueueSettings,
  q: Quote,
  state: QuoteState,
): Promise<EngineeringDetail> {
  const [eng, capacity] = await Promise.all([
    getEngReview(db, q.id),
    listCapacityEvidenceWithNames(db, q.id),
  ]);
  const people = await listUsersByIds(
    db,
    [q.assignedEngineerId, eng?.acceptedBy].filter((id): id is string => !!id),
  );
  const name = (id: string | null | undefined) =>
    (id && people.find((p) => p.id === id)?.displayName) ?? null;

  const visible = redact(
    {
      review: {
        processType: eng?.processType ?? null,
        machineType: eng?.machineType ?? null,
        plantCode: eng?.plantCode ?? null,
        cavitation: eng?.cavitation ?? null,
        cycleTimeS: eng?.cycleTimeS ?? null,
        toolingNotes: eng?.toolingNotes ?? null,
        downstreamEquipmentNotes: eng?.downstreamEquipmentNotes ?? null,
        prelimCapitalUsd: eng?.prelimCapitalUsd ?? null,
        technicalConceptNotes: eng?.technicalConceptNotes ?? null,
        updatedAt: iso(eng?.updatedAt),
      },
      capacityEvidence: capacity.map(({ row, analystName }) => ({
        id: row.id,
        site: row.site,
        lineAsset: row.lineAsset,
        assumedEffectivenessPct: row.assumedEffectivenessPct,
        cycleTimeS: row.cycleTimeS,
        utilizationPct: row.utilizationPct,
        bufferPct: row.bufferPct,
        analysisDate: row.analysisDate,
        analystId: row.analystId,
        analystName: analystName ?? null,
        notes: row.notes,
      })),
    },
    actor,
  );

  const inQueue = q.stageKey === ENG_QUEUE_STAGE_KEY && q.status !== 'closed';
  return {
    inQueue,
    assignedEngineerId: q.assignedEngineerId,
    assignedEngineerName: name(q.assignedEngineerId),
    assignedAt: iso(q.assignedAt),
    acceptedAt: iso(eng?.acceptedAt),
    acceptedByName: name(eng?.acceptedBy),
    review: visible.review,
    capacityEvidence: visible.capacityEvidence,
    commercialRedacted: !canSeeCommercialFields(actor),
    canEdit: canEditEngReview(actor, state),
    canAccept: planAccept(actor, state, eng?.acceptedAt ?? null).ok,
    canAssign: inQueue && canAssignEngQueue(actor, settings, state),
  };
}
