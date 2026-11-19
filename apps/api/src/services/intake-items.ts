import {
  draftItems,
  INTAKE_ITEM_FIELDS,
  INTAKE_PROBLEM_CODES,
  intakeItemValues,
  itemFromFlat,
  normalizeDraftData,
  type IntakeDraftData,
  type IntakeItemData,
} from '@ccq/contracts';
import type { DbOrTx, Tx } from '@ccq/db';
import { schema, uuidv7 } from '@ccq/db';
import {
  deleteQuoteItem,
  getEngReviewForItem,
  insertActivityEvent,
  insertQuoteItem,
  listAttachments,
  listDraftAttachments,
  listItemDrawingLinks,
  listQuoteItems,
  rekeyItemAttachments,
  renumberQuoteItems,
  setItemDrawingLinks,
  updateQuoteItem,
  upsertEngReview,
  type NewQuoteItem,
  type QuoteDraftRow,
  type QuoteItem,
} from '@ccq/db/repos';
import {
  DRAWING_ATTACHMENT_KINDS,
  inapplicableIntakeFields,
  INTAKE_LIST_FIELDS,
  ITEM_LABEL_MAX_LENGTH,
  itemName,
  type Actor,
  type IntakeConfig,
} from '@ccq/domain';
import { eq } from 'drizzle-orm';

import { recordAudit, type AuditMeta } from '../plugins/audit';

/**
 * FB-19 (W13-32 to W13-34): the intake's items on the server: drafts are stored with their product
 * fields in `items`; at submit the quote's `quote_item` rows are made to match the draft (added,
 * changed, renumbered, removed), each change audited.
 */

const blankToNull = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
/** numeric(10,2): stored to the cent. */
const round2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

const isDrawing = (kind: string) => (DRAWING_ATTACHMENT_KINDS as readonly string[]).includes(kind);

/** FB-24 (N17-03): the file kinds that count as a concept's render or photo. */
export const RENDER_ATTACHMENT_KINDS = ['sample_photo'] as const;

/** An intake problem the route turns into problem+json (the shape `IntakeError` takes). */
export interface ItemsProblem {
  status: 422;
  code: string;
  message: string;
  extra: Record<string, unknown>;
}

/**
 * The live drawings of a draft (and, for a rework, of its quote), and which item each counts for: its
 * own (`attachment.quote_item_id` = the item's key), one it links to (`linkedDrawingIds`), and a drawing
 * with no item (uploaded before FB-19) for item 1.
 */
export async function drawingCheck(
  db: DbOrTx,
  draft: Pick<QuoteDraftRow, 'id' | 'reworkOfQuoteId'> &
    Partial<Pick<QuoteDraftRow, 'requoteOfQuoteId'>>,
): Promise<{
  has: (item: IntakeItemData, index: number) => boolean;
  ids: Set<string>;
  /** FB-24 (N17-03): a sample photo / render is on file (any item: a concept's render is the request's). */
  hasRender: boolean;
}> {
  const all = [
    ...(await listDraftAttachments(db, draft.id)),
    ...(draft.reworkOfQuoteId ? await listAttachments(db, draft.reworkOfQuoteId) : []),
    // FB-26 (N17-30): a linked re-quote links to the old quote's drawings (and its render counts).
    ...(draft.requoteOfQuoteId ? await listAttachments(db, draft.requoteOfQuoteId) : []),
  ];
  const files = all.filter((f) => isDrawing(f.kind));
  const ids = new Set(files.map((f) => f.id));
  return {
    ids,
    hasRender: all.some((f) => (RENDER_ATTACHMENT_KINDS as readonly string[]).includes(f.kind)),
    has: (item, index) =>
      files.some((f) => f.quoteItemId === item.key || (f.quoteItemId === null && index === 0)) ||
      (item.linkedDrawingIds ?? []).some((id) => ids.has(id)),
  };
}

/**
 * FB-19: the item-count and key checks a save and a submit both make: at most `itemsMax` items (the
 * domain also reports it as blocking), and no two items with one key.
 */
export function itemsProblem(data: IntakeDraftData, config: IntakeConfig): ItemsProblem | null {
  const items = data.items ?? [];
  if (items.length > config.itemsMax) {
    return {
      status: 422,
      code: INTAKE_PROBLEM_CODES.invalidItems,
      message: `A quote can hold up to ${config.itemsMax} items. Put the rest in a separate quote.`,
      extra: { errors: [{ path: '/data/items', message: `At most ${config.itemsMax} items` }] },
    };
  }
  const keys = items.map((i) => i.key.toLowerCase());
  if (new Set(keys).size !== keys.length) {
    return {
      status: 422,
      code: INTAKE_PROBLEM_CODES.invalidItems,
      message: 'Two items have the same key. Reload the draft and try again.',
      extra: { errors: [{ path: '/data/items', message: 'Item keys must be unique' }] },
    };
  }
  return null;
}

/**
 * Autosave's merge: top-level keys replace the stored ones (as before). FB-19: `items` is replaced as a
 * whole; an older client that sends a top-level product field (no `items`) changes item 1. The result
 * is stored normalised (product fields only inside `items`).
 */
export function mergeDraftPatch(
  before: IntakeDraftData,
  incoming: IntakeDraftData,
): IntakeDraftData {
  const merged: IntakeDraftData = { ...before, ...incoming };
  const flat = Object.fromEntries(
    INTAKE_ITEM_FIELDS.filter((f) => incoming[f] !== undefined).map((f) => [f, incoming[f]]),
  ) as Partial<IntakeItemData>;
  if (Object.keys(flat).length > 0 && incoming.items === undefined) {
    const items = draftItems(before);
    merged.items =
      items.length > 0
        ? [{ ...items[0]!, ...flat }, ...items.slice(1)]
        : [{ ...itemFromFlat(flat, uuidv7()) }];
  }
  return normalizeDraftData(merged, uuidv7);
}

/**
 * DR-cross-cutting-02 on a save: only what this save changes is a new write. FB-19: per item, only the
 * fields that differ from the stored item with the same key (a new item: all of it). The items keep
 * their position so an issue can name the right item.
 */
export function changedDraftData(
  before: IntakeDraftData,
  after: IntakeDraftData,
  incoming: IntakeDraftData,
): { changed: IntakeDraftData; itemNumbers: number[] } {
  const request = Object.fromEntries(
    Object.entries(incoming).filter(
      ([k, v]) =>
        k !== 'items' &&
        !(INTAKE_ITEM_FIELDS as readonly string[]).includes(k) &&
        JSON.stringify(v) !== JSON.stringify((before as Record<string, unknown>)[k]),
    ),
  ) as IntakeDraftData;
  const old = new Map(draftItems(before).map((i) => [i.key, i]));
  const items: IntakeItemData[] = [];
  const itemNumbers: number[] = [];
  draftItems(after).forEach((item, index) => {
    const prev = old.get(item.key);
    const diff: Record<string, unknown> = { key: item.key };
    let any = false;
    for (const [k, v] of Object.entries(item)) {
      if (k === 'key') continue;
      if (!prev || JSON.stringify(v) !== JSON.stringify((prev as Record<string, unknown>)[k])) {
        diff[k] = v;
        any = true;
      }
    }
    if (any) {
      items.push(diff as IntakeItemData);
      itemNumbers.push(index + 1);
    }
  });
  return { changed: { ...request, items }, itemNumbers };
}

/**
 * DR-cross-cutting-02 for a rework: the list codes the quote already holds are kept, on the quote and on
 * every item (a list field maps to all the codes the items hold).
 */
export function keptFromValues(values: {
  items: Record<string, unknown>[];
  [k: string]: unknown;
}): Record<string, unknown> {
  const { items, ...request } = values;
  const out: Record<string, unknown> = { ...request };
  const asList = (v: unknown): unknown[] =>
    Array.isArray(v) ? v : v === null || v === undefined ? [] : [v];
  for (const item of items) {
    for (const [k, v] of Object.entries(item)) {
      if (!(k in INTAKE_LIST_FIELDS)) continue;
      out[k] = [...new Set([...asList(out[k]), ...asList(v)])];
    }
  }
  return out;
}

/** A quote's items as draft items (the rework draft), with their drawing links. */
export async function draftItemsFromQuote(db: DbOrTx, quoteId: string): Promise<IntakeItemData[]> {
  const [items, links] = await Promise.all([
    listQuoteItems(db, quoteId),
    listItemDrawingLinks(db, quoteId),
  ]);
  return items.map((i) =>
    itemToDraft(
      i,
      links.filter((l) => l.quoteItemId === i.id).map((l) => l.attachmentId),
    ),
  );
}

function itemToDraft(i: QuoteItem, linked: string[]): IntakeItemData {
  return {
    key: i.id,
    label: i.label,
    sfProductSpecId: i.sfProductSpecId,
    ...(linked.length > 0 ? { linkedDrawingIds: linked } : {}),
    productFamily: i.productFamily,
    productFamilyOther: i.productFamilyOther,
    components: i.components,
    componentOther: i.componentOther,
    linerSpec: i.linerSpec,
    labelsPurchasedBy: i.labelsPurchasedBy,
    decorationTypes: i.decorationTypes,
    decorationTypeOther: i.decorationTypeOther,
    decorationPrintColors: i.decorationPrintColors,
    resin: i.resin,
    resinCustomerSpecified: i.resinCustomerSpecified,
    resinGrade: i.resinGrade,
    pcrLevel: i.pcrLevel,
    pcrLevelOther: i.pcrLevelOther,
    additive: i.additive,
    colorType: i.colorType,
    colorDescription: i.colorDescription,
    additives: i.additives,
    neckDiameter: i.neckDiameter,
    neckDiameterCustom: i.neckDiameterCustom,
    neckFinishType: i.neckFinishType,
    neckFinishTypeCustom: i.neckFinishTypeCustom,
    neckSpecialFeature: i.neckSpecialFeature,
    neckSpecialFeatureCustom: i.neckSpecialFeatureCustom,
    containerSize: i.containerSize,
    heightMm: i.heightMm,
    widthOrDiameterMm: i.widthOrDiameterMm,
    depthMm: i.depthMm,
    gramWeightG: i.gramWeightG,
    modifyExistingMold: i.modifyExistingMold,
    existingMoldRef: i.existingMoldRef,
    moldChangeDescription: i.moldChangeDescription,
    packagingType: i.packagingType,
    packagingNotes: i.packagingNotes,
    drawingStatus: i.drawingStatus,
    estAnnualVolume: i.estAnnualVolume,
    estAnnualVolumeConfirmed: i.estAnnualVolumeConfirmed,
    productNeededBy: i.productNeededBy,
    standardDescription: i.standardDescription,
  };
}

/** What a `quote_item` row stores for one item, from its values (request + item), cleared as at submit. */
export type StoredItem = Omit<NewQuoteItem, 'id' | 'quoteId' | 'itemNo' | 'createdBy'>;

export function storedItemColumns(
  item: IntakeItemData,
  requestValues: Record<string, unknown>,
  config: IntakeConfig,
): StoredItem {
  const v = { ...requestValues, ...intakeItemValues(item) };
  const cleared = new Set(inapplicableIntakeFields(v, config));
  const keep = <T>(field: string, value: T): T | null => (cleared.has(field) ? null : value);
  const label = blankToNull(item.label);
  return {
    label: label ? label.slice(0, ITEM_LABEL_MAX_LENGTH) : null,
    sfProductSpecId: item.sfProductSpecId ?? null,
    productFamily: v.product_family,
    productFamilyOther: keep('product_family_other', v.product_family_other),
    components: v.components,
    componentOther: keep('component_other', v.component_other),
    linerSpec: keep('liner_spec', v.liner_spec),
    labelsPurchasedBy: keep('labels_purchased_by', v.labels_purchased_by),
    // FB-24 (N17-02): several at once; the deprecated single code is no longer written.
    decorationTypes: keep('decoration_types', v.decoration_types) ?? [],
    decorationTypeOther: keep('decoration_type_other', v.decoration_type_other),
    decorationPrintColors: keep('decoration_print_colors', v.decoration_print_colors),
    resin: v.resin,
    resinCustomerSpecified: v.resin_customer_specified,
    resinGrade: keep('resin_grade', v.resin_grade),
    pcrLevel: v.pcr_level,
    pcrLevelOther: keep('pcr_level_other', v.pcr_level_other),
    additive: v.additive,
    additives: v.additives,
    colorType: v.color_type,
    colorDescription: keep('color_description', v.color_description),
    neckDiameter: v.neck_diameter,
    neckDiameterCustom: keep('neck_diameter_custom', v.neck_diameter_custom),
    neckFinishType: v.neck_finish_type,
    neckFinishTypeCustom: keep('neck_finish_type_custom', v.neck_finish_type_custom),
    neckSpecialFeature: v.neck_special_feature,
    neckSpecialFeatureCustom: keep('neck_special_feature_custom', v.neck_special_feature_custom),
    containerSize: blankToNull(v.container_size),
    heightMm: round2(v.height_mm),
    widthOrDiameterMm: round2(v.width_or_diameter_mm),
    depthMm: round2(v.depth_mm),
    gramWeightG: round2(v.gram_weight_g),
    modifyExistingMold: v.modify_existing_mold,
    existingMoldRef: keep('existing_mold_ref', v.existing_mold_ref),
    moldChangeDescription: keep('mold_change_description', v.mold_change_description),
    packagingType: v.packaging_type,
    packagingNotes: blankToNull(v.packaging_notes),
    drawingStatus: v.drawing_status,
    estAnnualVolume: v.est_annual_volume,
    estAnnualVolumeConfirmed: v.est_annual_volume_confirmed,
    productNeededBy: v.product_needed_by,
    standardDescription: blankToNull(v.standard_description),
  };
}

/**
 * Decision 6: the quote's product columns from item 1's stored values, the volume summed over every
 * item and confirmed only when every item's is. `structured_description` keeps its shape.
 */
export function quoteMirrorColumns(rows: readonly StoredItem[]) {
  const first = rows[0]!;
  const volumes = rows
    .map((r) => r.estAnnualVolume)
    .filter((v): v is number => typeof v === 'number');
  return {
    structuredDescription: {
      standard: first.standardDescription ?? null,
      containerType: first.productFamily ?? null,
      size: first.containerSize ?? null,
      resin: first.resin ?? null,
      components: first.components ?? [],
    },
    productFamily: first.productFamily ?? null,
    productFamilyOther: first.productFamilyOther ?? null,
    resin: first.resin ?? null,
    components: first.components ?? [],
    componentOther: first.componentOther ?? null,
    estAnnualVolume: volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) : null,
    estAnnualVolumeConfirmed: rows.every((r) => r.estAnnualVolumeConfirmed === true),
    productNeededBy: first.productNeededBy ?? null,
    drawingStatus: first.drawingStatus ?? null,
    neckDiameter: first.neckDiameter ?? null,
    neckDiameterCustom: first.neckDiameterCustom ?? null,
    neckFinishType: first.neckFinishType ?? null,
    neckFinishTypeCustom: first.neckFinishTypeCustom ?? null,
    neckSpecialFeature: first.neckSpecialFeature ?? null,
    neckSpecialFeatureCustom: first.neckSpecialFeatureCustom ?? null,
    resinCustomerSpecified: first.resinCustomerSpecified ?? false,
    resinGrade: first.resinGrade ?? null,
    pcrLevel: first.pcrLevel ?? null,
    pcrLevelOther: first.pcrLevelOther ?? null,
    additive: first.additive ?? null,
    colorType: first.colorType ?? null,
    colorDescription: first.colorDescription ?? null,
    additives: first.additives ?? null,
    linerSpec: first.linerSpec ?? null,
    labelsPurchasedBy: first.labelsPurchasedBy ?? null,
    decorationTypes: first.decorationTypes ?? [],
    decorationTypeOther: first.decorationTypeOther ?? null,
    decorationPrintColors: first.decorationPrintColors ?? null,
    heightMm: first.heightMm ?? null,
    widthOrDiameterMm: first.widthOrDiameterMm ?? null,
    depthMm: first.depthMm ?? null,
    gramWeightG: first.gramWeightG ?? null,
    modifyExistingMold: first.modifyExistingMold ?? false,
    existingMoldRef: first.existingMoldRef ?? null,
    moldChangeDescription: first.moldChangeDescription ?? null,
    packagingType: first.packagingType ?? null,
    packagingNotes: first.packagingNotes ?? null,
  };
}

/** The quote-level engineering fields, kept on the primary item's review row (FB-19). */
const QUOTE_LEVEL_REVIEW = [
  'acceptedAt',
  'acceptedBy',
  'returnedReason',
  'capacitySignoffStatus',
  'capacitySignoffBy',
  'capacitySignoffAt',
  'capacitySignoffNote',
  'capacityReadyAt',
] as const;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v);
const jsonable = (row: Record<string, unknown> | null | undefined) =>
  row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, iso(v)])) : null;

/**
 * Makes the quote's `quote_item` rows match the submitted draft, in the submit transaction: changed
 * items are updated, new ones added (server ids; the draft's drawings are re-keyed to them), missing
 * ones removed with their engineering work, all renumbered in the draft's order, the drawing links set,
 * and the quote-level engineering fields moved when item 1 changes. Every add, change, duplicate and
 * removal is audited (`quote_item`), a removal with its engineering work in `before`. Returns the draft
 * key → item id map.
 */
export async function syncQuoteItems(
  tx: Tx,
  actor: Actor,
  meta: AuditMeta,
  input: {
    quoteId: string;
    draftId: string;
    items: readonly IntakeItemData[];
    rows: readonly StoredItem[];
    now: Date;
    /**
     * FB-26 (N17-30): a linked re-quote's old quote. Its drawings may be linked too (the new items use
     * the drawings the old ones held, FB-19's way; nothing is copied).
     */
    linkedFromQuoteId?: string | null;
  },
): Promise<Map<string, string>> {
  const { quoteId, draftId, items, rows, now } = input;
  const existing = await listQuoteItems(tx, quoteId);
  const byId = new Map(existing.map((i) => [i.id, i]));
  const wanted = new Set(items.map((i) => i.key));
  const oldPrimary = existing.find((i) => i.itemNo === 1) ?? null;
  const oldPrimaryReview = oldPrimary ? await getEngReviewForItem(tx, oldPrimary.id) : undefined;
  const audit = (entityId: string, before: unknown, after: unknown) =>
    recordAudit(tx, actor, meta, {
      at: now,
      action: before === null ? 'create' : 'update',
      entity: 'quote_item',
      entityId,
      quoteId,
      before: before,
      after: after,
    });

  // 1. Removed items, with the engineering work done on them (kept in the audit).
  for (const old of existing) {
    if (wanted.has(old.id)) continue;
    const removed = await deleteQuoteItem(tx, quoteId, old.id);
    const workDiscarded = removed.review !== null || removed.capacity.length > 0;
    await audit(
      old.id,
      {
        item: jsonable(removed.item),
        engReview: jsonable(removed.review),
        capacityEvidence: removed.capacity.map((c) => jsonable(c as Record<string, unknown>)),
        drawingLinks: removed.links.map((l) => l.attachmentId),
      },
      { removed: true, itemNo: old.itemNo, workDiscarded },
    );
    await insertActivityEvent(tx, {
      quoteId,
      type: 'quote_item_removed',
      actorId: actor.userId,
      at: now,
      payload: { itemNo: old.itemNo, label: old.label, workDiscarded },
      createdBy: actor.userId,
    });
  }

  // 2. Changed and new items. New items start above any existing number; step 3 renumbers.
  const keyToId = new Map<string, string>();
  const ordered: string[] = [];
  for (const [index, item] of items.entries()) {
    const values = rows[index]!;
    const prev = byId.get(item.key);
    if (prev) {
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        const was = (prev as Record<string, unknown>)[k];
        if (JSON.stringify(v ?? null) !== JSON.stringify(was ?? null)) {
          before[k] = was ?? null;
          after[k] = v ?? null;
        }
      }
      if (Object.keys(after).length > 0) {
        await updateQuoteItem(tx, prev.id, values);
        await audit(prev.id, before, after);
      }
      keyToId.set(item.key, prev.id);
      ordered.push(prev.id);
    } else {
      const created = await insertQuoteItem(tx, {
        ...values,
        quoteId,
        itemNo: 1000 + index,
        createdAt: now,
        createdBy: actor.userId,
      });
      const from = item.duplicatedFrom
        ? (keyToId.get(item.duplicatedFrom) ?? item.duplicatedFrom)
        : null;
      await audit(created.id, null, {
        ...jsonable(values),
        itemNo: index + 1,
        ...(from ? { duplicatedFrom: from } : {}),
      });
      keyToId.set(item.key, created.id);
      ordered.push(created.id);
    }
  }
  await renumberQuoteItems(tx, quoteId, ordered);

  // 3. The draft's drawings (and, for a rework, the quote's) now carry the item ids.
  for (const [key, id] of keyToId) {
    if (key === id) continue;
    await rekeyItemAttachments(tx, { draftId }, key, id);
    await rekeyItemAttachments(tx, { quoteId }, key, id);
  }

  // 4. Drawing links (Duplicate): only to live drawings on this quote that the item does not hold.
  // FB-26: or, on a linked re-quote, to the old quote's live drawings.
  const drawings = [
    ...(await listAttachments(tx, quoteId)),
    ...(input.linkedFromQuoteId ? await listAttachments(tx, input.linkedFromQuoteId) : []),
  ].filter((f) => isDrawing(f.kind));
  for (const item of items) {
    const id = keyToId.get(item.key)!;
    const linked = (item.linkedDrawingIds ?? []).filter((a) =>
      drawings.some((d) => d.id === a && d.quoteItemId !== id),
    );
    const change = await setItemDrawingLinks(tx, quoteId, id, linked, actor.userId);
    if (change.added.length > 0 || change.removed.length > 0) {
      await audit(id, { drawingLinks: change.removed }, { drawingLinks: change.added });
    }
  }

  // 5. Item 1 changed (reordered or removed): the quote-level engineering fields follow it.
  const newPrimary = ordered[0];
  if (oldPrimaryReview && newPrimary && oldPrimary && newPrimary !== oldPrimary.id) {
    const moved = Object.fromEntries(QUOTE_LEVEL_REVIEW.map((k) => [k, oldPrimaryReview[k]]));
    if (Object.values(moved).some((v) => v !== null && v !== undefined)) {
      const target = await getEngReviewForItem(tx, newPrimary);
      await upsertEngReview(tx, {
        ...(target ?? {}),
        quoteId,
        quoteItemId: newPrimary,
        ...moved,
        createdBy: target?.createdBy ?? actor.userId,
      });
      if (wanted.has(oldPrimary.id)) {
        await upsertEngReview(tx, {
          ...oldPrimaryReview,
          ...Object.fromEntries(QUOTE_LEVEL_REVIEW.map((k) => [k, null])),
        });
      }
      // capacity_ready_at is not in the upsert's column set (only markCapacityReady writes it).
      await tx
        .update(schema.engReview)
        .set({ capacityReadyAt: oldPrimaryReview.capacityReadyAt, updatedAt: now })
        .where(eq(schema.engReview.quoteItemId, newPrimary));
      if (wanted.has(oldPrimary.id)) {
        await tx
          .update(schema.engReview)
          .set({ capacityReadyAt: null, updatedAt: now })
          .where(eq(schema.engReview.quoteItemId, oldPrimary.id));
      }
      await audit(
        newPrimary,
        { quoteLevelEngineeringOn: oldPrimary.id },
        { quoteLevelEngineeringOn: newPrimary, fields: Object.keys(moved) },
      );
    }
  }
  return keyToId;
}

/** "Item 2 (16 oz bottle)" for the item with this key in the draft, for messages. */
export function draftItemName(data: IntakeDraftData, key: string): string {
  const items = draftItems(data);
  const index = items.findIndex((i) => i.key === key);
  return itemName(index + 1, items[index]?.label);
}
