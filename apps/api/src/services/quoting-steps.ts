import type { ModelFileView, QuotingStepsView } from '@ccq/contracts';
import type { DbOrTx } from '@ccq/db';
import { listAttachments, listUsersByIds, listValueList } from '@ccq/db/repos';
import {
  PRICING_QUEUE_STAGE_KEY,
  QUOTING_MODEL_KINDS,
  ROI_NOT_REQUIRED_TEXT,
  derivedDecisionFields,
  planModelUpload,
  quotingSteps,
  roiReasonText,
  sectionLock,
  type Actor,
  type ModelFileRef,
  type PricingRecordValues,
  type QuoteState,
  type QuotingModelKind,
  type WorkflowConfig,
} from '@ccq/domain';

import { loadCommercialSettings } from './commercial';

/**
 * FB-07 (D-001): the Quoting steps as the Quoting tab and Final Review show them: costing, then ROI,
 * then price approved, each with who and when. The rules are the domain's (`quoting-steps`); this loads
 * the current model versions, the ROI requirement and the names, and says what the caller may upload.
 */

/** The current version of each Quoting model on a quote, with its version count, as views. */
export async function currentModels(
  db: DbOrTx,
  quoteId: string,
): Promise<Record<QuotingModelKind, ModelFileView | null>> {
  const rows = (await listAttachments(db, quoteId)).filter((r) =>
    (QUOTING_MODEL_KINDS as readonly string[]).includes(r.kind),
  );
  const names = new Map(
    (await listUsersByIds(db, [...new Set(rows.map((r) => r.uploadedBy))])).map((u) => [
      u.id,
      u.displayName,
    ]),
  );
  const view = (kind: QuotingModelKind): ModelFileView | null => {
    const ofKind = rows.filter((r) => r.kind === kind);
    const current = ofKind.find((r) => r.version !== null && r.supersededAt === null);
    if (!current) return null;
    return {
      id: current.id,
      kind,
      version: current.version!,
      fileName: current.fileName,
      uploadedById: current.uploadedBy,
      uploadedByName: names.get(current.uploadedBy) ?? null,
      uploadedAt: current.createdAt.toISOString(),
      available: current.storage !== null && current.storageItemId !== null,
      versions: ofKind.length,
    };
  };
  return {
    cost_model: view('cost_model'),
    roi_model: view('roi_model'),
    price_table: view('price_table'),
  };
}

const ref = (v: ModelFileView | null): ModelFileRef | null =>
  v
    ? {
        id: v.id,
        version: v.version,
        fileName: v.fileName,
        uploadedById: v.uploadedById,
        uploadedAt: new Date(v.uploadedAt),
      }
    : null;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function quotingStepsView(
  db: DbOrTx,
  actor: Actor,
  workflow: WorkflowConfig,
  q: { id: string; stageKey: string; status: string },
  state: QuoteState,
  record: PricingRecordValues | null,
): Promise<QuotingStepsView> {
  const [models, settings, funding] = await Promise.all([
    currentModels(db, q.id),
    loadCommercialSettings(db),
    listValueList(db, 'tooling_funding_model', { activeOnly: false }),
  ]);
  const derived = derivedDecisionFields(state.fields, settings.derived);
  const roi = { required: derived.roi_required, reasons: derived.roi_required_reasons };
  const grandfathered = record?.costModelRequirement === 'grandfathered';
  // Price approved = the pricing section's lock: G3 decided with an advancing outcome on this stay.
  const lock = sectionLock('pricing', workflow, state);
  const steps = quotingSteps({
    costModel: ref(models.cost_model),
    roiModel: ref(models.roi_model),
    priceTable: ref(models.price_table),
    costingCompleted: record?.costingCompleted ?? false,
    costingAttestedBy: record?.costingAttestedBy ?? null,
    costingAttestedAt: record?.costingAttestedAt ?? null,
    costModelGrandfathered: grandfathered,
    roi,
    priceConfirmed: lock.locked ? { by: lock.decidedBy, at: lock.decidedAt } : null,
  });

  const people = new Map(
    (
      await listUsersByIds(
        db,
        [record?.costingAttestedBy, lock.decidedBy].filter((id): id is string => !!id),
      )
    ).map((u) => [u.id, u.displayName]),
  );
  const name = (id: string | null) => (id ? (people.get(id) ?? null) : null);

  const inQuoting = q.stageKey === PRICING_QUEUE_STAGE_KEY && q.status !== 'closed';
  const ctx = {
    costModelOnFile: models.cost_model !== null,
    costModelGrandfathered: grandfathered,
    roiRequired: roi.required,
  };
  const mayUpload = (kind: QuotingModelKind) =>
    inQuoting && !lock.locked && planModelUpload(kind, actor, state, ctx).ok;

  const g2Label = (key: string) =>
    workflow.outcomes.find((o) => o.gateKey === 'G2' && o.key === key)?.label ?? key;
  const fundingLabel = (code: string) => funding.find((v) => v.code === code)?.label ?? code;

  return {
    current: steps.current,
    costing: {
      status: steps.costing.status,
      model: models.cost_model,
      attested: steps.costing.attested,
      attestedByName: name(steps.costing.attestedBy),
      attestedAt: iso(steps.costing.attestedAt),
      noModelOnFile: steps.costing.noModelOnFile,
      canUpload: mayUpload('cost_model'),
    },
    roi: {
      status: steps.roi.status,
      required: steps.roi.required,
      reasons: steps.roi.reasons.map((r) =>
        roiReasonText(r, { g2Outcome: g2Label, fundingModel: fundingLabel }),
      ),
      notRequiredText: steps.roi.required ? null : ROI_NOT_REQUIRED_TEXT,
      model: models.roi_model,
      olderThanCostModel: steps.roi.olderThanCostModel,
      canUpload: mayUpload('roi_model'),
    },
    price: {
      status: steps.price.status,
      confirmedByName: name(steps.price.confirmedBy),
      confirmedAt: iso(steps.price.confirmedAt),
      priceTable: models.price_table,
      canUploadPriceTable: mayUpload('price_table'),
    },
  };
}
