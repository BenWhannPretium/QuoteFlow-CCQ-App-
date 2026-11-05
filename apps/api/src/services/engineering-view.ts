import type { CapacityBasisDto, EngineeringDetail, ProductFact } from '@ccq/contracts';
import type { DbOrTx } from '@ccq/db';
import {
  getEngReview,
  getSetting,
  listCapacityEvidenceWithNames,
  listUsersByIds,
  listValueList,
  type Quote,
} from '@ccq/db/repos';
import {
  CAPACITY_BASIS_SEED,
  ENG_QUEUE_SETTINGS_SEED,
  ENG_QUEUE_STAGE_KEY,
  can,
  canAssignEngQueue,
  canEditEngReview,
  canSeeCommercialFields,
  allocationCheck,
  parseCapacityBasis,
  parseEngQueueSettings,
  planAccept,
  redact,
  utilizationLevel,
  type CapacityBasis,
  sectionLock,
  type Actor,
  type EngQueueSettings,
  type LockConfig,
  type QuoteState,
} from '@ccq/domain';

import { leadReviewView } from './lead-review';
import { sectionLockView } from './locks';

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

/** `app_setting.capacity_basis` (provisional, D-021), falling back to the seed when unset or malformed. */
export async function loadCapacityBasis(db: DbOrTx): Promise<CapacityBasis> {
  const value = await getSetting(db, 'capacity_basis');
  try {
    return parseCapacityBasis(value);
  } catch {
    return { ...CAPACITY_BASIS_SEED };
  }
}

/**
 * F-023: what the intake says about the product, for the Engineering review header. Today only the resin
 * exists on the quote; FB-02 adds the customer-specified grade, PCR %, colour, additives and the variants
 * note, and each becomes one more entry here (the tab renders whatever list it is given).
 */
async function productFacts(db: DbOrTx, q: Quote): Promise<ProductFact[]> {
  const facts: ProductFact[] = [];
  if (q.resin) {
    const resins = await listValueList(db, 'resin', { activeOnly: false });
    facts.push({
      key: 'resin',
      label: 'Resin',
      value: resins.find((r) => r.code === q.resin)?.label ?? q.resin,
    });
  }
  return facts;
}

/** The label of each stored code on the review, retired entries included (the pickers list active ones only). */
async function selectedLabels(
  db: DbOrTx,
  eng:
    | { processType: string | null; machineType: string | null; plantCode: string | null }
    | undefined,
): Promise<EngineeringDetail['selectedLabels']> {
  const label = async (
    list: 'process_type' | 'machine_type' | 'plant',
    code: string | null | undefined,
  ) =>
    code
      ? ((await listValueList(db, list, { activeOnly: false })).find((v) => v.code === code)
          ?.label ?? code)
      : null;
  const [processType, machineType, plantCode] = await Promise.all([
    label('process_type', eng?.processType),
    label('machine_type', eng?.machineType),
    label('plant', eng?.plantCode),
  ]);
  return { processType, machineType, plantCode };
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
  /** FB-01 (F-001): the workflow config the section lock reads. */
  workflow: LockConfig,
): Promise<EngineeringDetail> {
  const [eng, capacity, basis, facts] = await Promise.all([
    getEngReview(db, q.id),
    listCapacityEvidenceWithNames(db, q.id),
    loadCapacityBasis(db),
    productFacts(db, q),
  ]);
  const labels = await selectedLabels(db, eng);
  const people = await listUsersByIds(
    db,
    [q.assignedEngineerId, eng?.acceptedBy, eng?.capacitySignoffBy].filter(
      (id): id is string => !!id,
    ),
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
        equipmentBomNotes: eng?.equipmentBomNotes ?? null,
        supplyChainNotes: eng?.supplyChainNotes ?? null,
        updatedAt: iso(eng?.updatedAt),
      },
      capacityEvidence: capacity.map(({ row, analystName }) => ({
        id: row.id,
        site: row.site,
        lineAsset: row.lineAsset,
        assumedEffectivenessPct: row.assumedEffectivenessPct,
        cycleTimeS: row.cycleTimeS,
        utilizationBeforePct: row.utilizationBeforePct,
        allocatedAnnualVolume: row.allocatedAnnualVolume,
        scheduledRunDaysPerYear: row.scheduledRunDaysPerYear,
        utilizationAfterPct: row.utilizationAfterPct,
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
    capacityEvidence: visible.capacityEvidence.map((row) => ({
      ...row,
      utilizationLevel:
        typeof row.utilizationAfterPct === 'number'
          ? utilizationLevel(row.utilizationAfterPct, basis)
          : null,
    })),
    quoteAnnualVolume: q.estAnnualVolume ?? null,
    capacityBasis: basis satisfies CapacityBasisDto,
    allocationWarning:
      allocationCheck(
        capacity.map(({ row }) => ({ allocatedAnnualVolume: row.allocatedAnnualVolume })),
        q.estAnnualVolume,
      )?.message ?? null,
    productFacts: facts,
    selectedLabels: labels,
    capacitySignoff: {
      status: (eng?.capacitySignoffStatus as 'approved' | 'blocked' | null | undefined) ?? null,
      byName: name(eng?.capacitySignoffBy),
      at: iso(eng?.capacitySignoffAt),
      note: eng?.capacitySignoffNote ?? null,
    },
    canSignOffCapacity:
      inQueue &&
      can(actor, 'capacity.signoff', state) &&
      !sectionLock('engineering', workflow, state).locked,
    commercialRedacted: !canSeeCommercialFields(actor),
    canEdit: canEditEngReview(actor, state, workflow),
    lock: await sectionLockView(db, workflow, 'engineering', state),
    canAccept: planAccept(actor, state, eng?.acceptedAt ?? null).ok,
    canAssign: inQueue && canAssignEngQueue(actor, settings, state),
    leadReview: await leadReviewView(db, actor, 'engineering', q, state),
  };
}
